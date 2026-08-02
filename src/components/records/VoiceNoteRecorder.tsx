import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import PatientSearchSelect from "@/components/PatientSearchSelect";
import { telehealthApi } from "@/lib/telehealthApi";
import { toast } from "sonner";
import { Mic, Square, Pause, Play, Loader2, CheckCircle2, AlertTriangle, Trash2 } from "lucide-react";

interface VoiceNoteRecorderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pré-seleciona o paciente (ex.: dentro do prontuário) */
  patientId?: string;
}

type Phase = "idle" | "recording" | "paused" | "uploading" | "processing" | "done" | "error";

const formatTime = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export default function VoiceNoteRecorder({ open, onOpenChange, patientId }: VoiceNoteRecorderProps) {
  const queryClient = useQueryClient();
  const [selectedPatient, setSelectedPatient] = useState(patientId || "");
  const [motivo, setMotivo] = useState("");
  const [anotacoes, setAnotacoes] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (patientId) setSelectedPatient(patientId);
  }, [patientId]);

  const stopTimers = () => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
  };

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  };

  const resetAll = () => {
    stopTimers();
    releaseStream();
    chunksRef.current = [];
    setBlob(null);
    setSeconds(0);
    setPhase("idle");
    setErrorMsg(null);
    setMotivo("");
    setAnotacoes("");
    if (!patientId) setSelectedPatient("");
  };

  useEffect(() => () => { stopTimers(); releaseStream(); }, []);

  const startRecording = async () => {
    if (!selectedPatient) {
      toast.error("Selecione o paciente antes de gravar");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const finalBlob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        setBlob(finalBlob);
        releaseStream();
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setSeconds(0);
      setPhase("recording");
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (err: any) {
      toast.error("Não foi possível acessar o microfone");
      setErrorMsg(err?.message || "Microfone indisponível");
    }
  };

  const pauseRecording = () => {
    recorderRef.current?.pause();
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    setPhase("paused");
  };

  const resumeRecording = () => {
    recorderRef.current?.resume();
    timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    setPhase("recording");
  };

  const stopRecording = () => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    recorderRef.current?.stop();
    setPhase("idle");
  };

  const sendToRecord = async () => {
    if (!blob || !selectedPatient) return;
    if (blob.size < 2048) {
      toast.error("Gravação muito curta. Grave novamente.");
      return;
    }
    setPhase("uploading");
    setErrorMsg(null);
    try {
      const session = await telehealthApi.create({ patientId: selectedPatient });
      await telehealthApi.uploadAudio(session.id, blob, {
        motivo: motivo || undefined,
        anotacoes: anotacoes || undefined,
        modality: "in_person",
      });
      setPhase("processing");
      toast.success("Áudio enviado. A IA está transcrevendo e montando a evolução.");

      pollRef.current = window.setInterval(async () => {
        try {
          const status = await telehealthApi.getStatus(session.id);
          if (status.processingStatus === "completed") {
            stopTimers();
            setPhase("done");
            queryClient.invalidateQueries({ queryKey: ["records"] });
            queryClient.invalidateQueries({ queryKey: ["prontuarios"] });
            toast.success("Evolução registrada no prontuário do paciente.");
          } else if (status.processingStatus === "error") {
            stopTimers();
            setPhase("error");
            setErrorMsg(status.processingError || "Erro no processamento do áudio");
          }
        } catch { /* segue tentando */ }
      }, 4000);
    } catch (err: any) {
      setPhase("error");
      setErrorMsg(err?.message || "Erro ao enviar áudio");
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      if (phase === "recording" || phase === "paused") {
        toast.error("Finalize ou descarte a gravação antes de fechar.");
        return;
      }
      resetAll();
    }
    onOpenChange(next);
  };

  const isBusy = phase === "uploading" || phase === "processing";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-primary" />
            Nota de voz clínica
          </DialogTitle>
          <DialogDescription>
            Grave um resumo falado da consulta presencial. A IA transcreve e cria a evolução
            estruturada no prontuário do paciente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!patientId && (
            <div className="space-y-2">
              <Label>Paciente *</Label>
              <PatientSearchSelect
                value={selectedPatient}
                onValueChange={setSelectedPatient}
                disabled={phase !== "idle" || !!blob}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Motivo / contexto (opcional)</Label>
            <Input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: Sessão presencial de acompanhamento"
              disabled={isBusy}
            />
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {phase === "recording" && <span className="h-3 w-3 animate-pulse rounded-full bg-destructive" />}
                <span className="font-mono text-2xl tabular-nums">{formatTime(seconds)}</span>
              </div>
              <div className="flex items-center gap-2">
                {phase === "idle" && !blob && (
                  <Button onClick={startRecording} size="sm">
                    <Mic className="mr-2 h-4 w-4" /> Gravar
                  </Button>
                )}
                {phase === "recording" && (
                  <>
                    <Button onClick={pauseRecording} size="sm" variant="outline">
                      <Pause className="h-4 w-4" />
                    </Button>
                    <Button onClick={stopRecording} size="sm" variant="destructive">
                      <Square className="mr-2 h-4 w-4" /> Parar
                    </Button>
                  </>
                )}
                {phase === "paused" && (
                  <>
                    <Button onClick={resumeRecording} size="sm" variant="outline">
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button onClick={stopRecording} size="sm" variant="destructive">
                      <Square className="mr-2 h-4 w-4" /> Parar
                    </Button>
                  </>
                )}
              </div>
            </div>

            {blob && phase === "idle" && (
              <div className="mt-3 space-y-2">
                <audio controls src={URL.createObjectURL(blob)} className="w-full" />
                <Button variant="ghost" size="sm" onClick={() => { setBlob(null); setSeconds(0); }}>
                  <Trash2 className="mr-2 h-4 w-4" /> Descartar e gravar de novo
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Anotações complementares (opcional)</Label>
            <Textarea
              value={anotacoes}
              onChange={(e) => setAnotacoes(e.target.value)}
              placeholder="Informações que a IA deve considerar na evolução"
              rows={3}
              disabled={isBusy}
            />
          </div>

          {phase === "processing" && (
            <Badge variant="secondary" className="gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Transcrevendo e organizando com IA...
            </Badge>
          )}
          {phase === "done" && (
            <Badge className="gap-2 bg-success/10 text-success">
              <CheckCircle2 className="h-3 w-3" /> Evolução criada no prontuário
            </Badge>
          )}
          {(phase === "error" || errorMsg) && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={phase === "uploading"}>
              {phase === "done" ? "Fechar" : "Cancelar"}
            </Button>
            {phase === "done" ? (
              <Button onClick={resetAll}>Nova nota de voz</Button>
            ) : (
              <Button onClick={sendToRecord} disabled={!blob || !selectedPatient || isBusy}>
                {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mic className="mr-2 h-4 w-4" />}
                Enviar para o prontuário
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
