import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { telehealthApi, TelehealthSession } from "@/lib/telehealthApi";
import { pacientesApi, Patient, consultasApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, MicOff, Phone, PhoneOff, Clock, Shield, CheckCircle, AlertCircle,
  Upload, FileText, Brain, Trash2, Video, ExternalLink, Loader2, RefreshCw,
  Eye, Plus, ArrowLeft, Headphones, Monitor, Volume2, Info, Pause, Play,
  Paperclip, X, File, Image as ImageIcon, Copy, MessageSquare, Sparkles, Settings2,
  FileSearch
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StructuredSessionContent from "@/components/telehealth/StructuredSessionContent";
import { useAiAgents, useAnalyzeText } from "@/hooks/useAi";

const STATUS_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  waiting: { label: "Aguardando", color: "bg-muted text-muted-foreground", icon: <Clock className="h-4 w-4" /> },
  capturing: { label: "Capturando", color: "bg-destructive/10 text-destructive", icon: <Mic className="h-4 w-4 animate-pulse" /> },
  uploaded: { label: "Enviado", color: "bg-warning/10 text-warning", icon: <Upload className="h-4 w-4" /> },
  completed: { label: "Concluído", color: "bg-success/10 text-success", icon: <CheckCircle className="h-4 w-4" /> },
};

const PROCESSING_MAP: Record<string, { label: string; icon: React.ReactNode }> = {
  none: { label: "Aguardando", icon: <Clock className="h-4 w-4" /> },
  uploaded: { label: "Áudio enviado", icon: <Upload className="h-4 w-4" /> },
  transcribing: { label: "Transcrevendo...", icon: <Loader2 className="h-4 w-4 animate-spin" /> },
  organizing: { label: "Organizando com IA...", icon: <Brain className="h-4 w-4 animate-pulse" /> },
  completed: { label: "Salvo no prontuário", icon: <CheckCircle className="h-4 w-4" /> },
  error: { label: "Erro no processamento", icon: <AlertCircle className="h-4 w-4" /> },
};

interface AttachedDoc {
  name: string;
  type: string;
  content: string;
  size: number;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function readFileContent(file: File): Promise<AttachedDoc> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1] || "";
      resolve({ name: file.name, type: file.type || "application/octet-stream", content: base64, size: file.size });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Teleatendimento() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeSession, setActiveSession] = useState<TelehealthSession | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const [newSessionData, setNewSessionData] = useState<{ patientId: string; meetingLink: string }>({ patientId: "", meetingLink: "" });
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [showPreflight, setShowPreflight] = useState(false);
  const [preflight, setPreflight] = useState<{ mic: boolean; audio: boolean; loading: boolean; err: string; checked: boolean }>({ mic: false, audio: false, loading: false, err: "", checked: false });
  const [editSession, setEditSession] = useState<TelehealthSession | null>(null);
  const [editData, setEditData] = useState<{ patientId: string; meetingLink: string }>({ patientId: "", meetingLink: "" });
  const [sessionNotes, setSessionNotes] = useState({ motivo: "", anotacoes: "" });
  const [attachedDocs, setAttachedDocs] = useState<AttachedDoc[]>([]);
  const [showRecordingModal, setShowRecordingModal] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("default");
  const [manualAnalysisResult, setManualAnalysisResult] = useState<string | null>(null);

  const { data: agents = [] } = useAiAgents();
  const analyzeTextMutation = useAnalyzeText();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Preflight device check
  const runPreflight = async () => {
    setPreflight(v => ({ ...v, loading: true, err: "" }));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const hasMic = stream.getAudioTracks().length > 0;
      const devs = await navigator.mediaDevices.enumerateDevices();
      stream.getTracks().forEach(t => t.stop());
      const isMobile = /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const hasAudio = isMobile || devs.some(d => d.kind === "audiooutput");
      setPreflight({ mic: hasMic, audio: hasAudio, loading: false, err: "", checked: true });
    } catch (e: any) {
      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      setPreflight({ mic: false, audio: isMobile, loading: false, err: e.message || "Permissão do microfone negada", checked: true });
    }
  };

  // Auto-create session from URL params
  const [autoCreating, setAutoCreating] = useState(false);
  useEffect(() => {
    const patientId = searchParams.get("patientId");
    const appointmentId = searchParams.get("appointmentId");
    if (patientId && !autoCreating) {
      setAutoCreating(true);
      setNewSessionData({ patientId, meetingLink: "" });
      setSearchParams({}, { replace: true });
      telehealthApi.create({ patientId, appointmentId: appointmentId || undefined }).then((session) => {
        setActiveSession(session);
        queryClient.invalidateQueries({ queryKey: ["telehealth-sessions"] });
        toast.success("Sessão criada! Inicie a captura de áudio quando estiver pronto.");
        setAutoCreating(false);
      }).catch((err) => {
        toast.error("Erro ao criar sessão: " + (err?.message || "Erro desconhecido"));
        setAutoCreating(false);
      });
    }
  }, [searchParams]);

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["telehealth-sessions"],
    queryFn: () => telehealthApi.list()
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["patients-list"],
    queryFn: async () => { const r = await pacientesApi.list(); return Array.isArray(r) ? r : (r as any).data || []; }
  });

  const { data: detailSession } = useQuery({
    queryKey: ["telehealth-detail", showDetail],
    queryFn: () => telehealthApi.get(showDetail!),
    enabled: !!showDetail
  });

  const { data: statusData } = useQuery({
    queryKey: ["telehealth-status", activeSession?.id],
    queryFn: () => telehealthApi.getStatus(activeSession!.id),
    enabled: !!activeSession && ["uploaded", "capturing"].includes(activeSession.status),
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (statusData && activeSession) {
      if (statusData.processingStatus === "completed" || statusData.processingStatus === "error") {
        setActiveSession(prev => prev ? { ...prev, ...statusData } : null);
        queryClient.invalidateQueries({ queryKey: ["telehealth-sessions"] });
        if (statusData.processingStatus === "completed") {
          toast.success("Transcrição concluída e salva no prontuário!");
          setShowRecordingModal(false);
        }
      }
    }
  }, [statusData]);

  const createMutation = useMutation({
    mutationFn: telehealthApi.create,
    onSuccess: (session) => {
      setActiveSession(session);
      setShowNewDialog(false);
      setShowConsentDialog(false);
      queryClient.invalidateQueries({ queryKey: ["telehealth-sessions"] });
      toast.success("Sessão criada!");
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const startCapture = async () => {
    if (!activeSession) return;
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      micStreamRef.current = micStream;

      const supportsDisplayCapture = typeof navigator.mediaDevices?.getDisplayMedia === "function";
      let recordingStream: MediaStream;

      if (supportsDisplayCapture) {
        try {
          const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
          displayStreamRef.current = displayStream;

          const audioCtx = new AudioContext();
          const dest = audioCtx.createMediaStreamDestination();
          audioContextRef.current = audioCtx;

          const displayAudioTracks = displayStream.getAudioTracks();
          if (displayAudioTracks.length > 0) {
            const displaySource = audioCtx.createMediaStreamSource(new MediaStream(displayAudioTracks));
            displaySource.connect(dest);
          }

          const clonedMicTrack = micStream.getAudioTracks()[0].clone();
          const micSource = audioCtx.createMediaStreamSource(new MediaStream([clonedMicTrack]));
          micSource.connect(dest);

          recordingStream = dest.stream;

          const displayVideoTrack = displayStream.getVideoTracks()[0];
          if (displayVideoTrack) {
            displayVideoTrack.onended = () => stopCapture();
          }
        } catch {
          // User cancelled display capture, fallback to mic only
          const clonedTrack = micStream.getAudioTracks()[0].clone();
          recordingStream = new MediaStream([clonedTrack]);
          displayStreamRef.current = null;
          toast.info("Captura será feita apenas pelo microfone.");
        }
      } else {
        const clonedTrack = micStream.getAudioTracks()[0].clone();
        recordingStream = new MediaStream([clonedTrack]);
        displayStreamRef.current = null;
        toast.info("No celular, a captura será feita pelo microfone do aparelho.");
      }

      const preferredMimeType = typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : undefined;

      const recorder = preferredMimeType
        ? new MediaRecorder(recordingStream, { mimeType: preferredMimeType })
        : new MediaRecorder(recordingStream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;

      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      setIsCapturing(true);
      setIsPaused(false);
      setShowRecordingModal(true);

      await telehealthApi.start(activeSession.id);
      toast.success("Captura de áudio iniciada!");
    } catch (err: any) {
      toast.error("Erro ao iniciar captura: " + (err.message || "Permissão negada"));
    }
  };

  const pauseCapture = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      if (timerRef.current) clearInterval(timerRef.current);
      setIsPaused(true);
      toast.info("Gravação pausada");
    }
  };

  const resumeCapture = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      setIsPaused(false);
      toast.info("Gravação retomada");
    }
  };

  const stopCapture = useCallback(async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    displayStreamRef.current?.getTracks().forEach(t => t.stop());
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => undefined);
    }
    audioContextRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    setIsCapturing(false);
    setIsPaused(false);

    await new Promise(r => setTimeout(r, 500));

    if (chunksRef.current.length > 0 && activeSession) {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      toast.info("Enviando áudio para processamento seguro...");
      try {
        await telehealthApi.uploadAudio(activeSession.id, blob, {
          motivo: sessionNotes.motivo,
          anotacoes: sessionNotes.anotacoes,
          agentId: selectedAgentId === "default" ? undefined : selectedAgentId,
        });
        
        // If an agent is selected, we could potentially pass it to the processing step
        // For now, the backend uses a default. We'll trigger processing manually if needed
        // or update the backend to support agentId in the next step.
        
        setActiveSession(prev => prev ? { ...prev, status: "uploaded", processingStatus: "uploaded" } : null);
        toast.success("Áudio enviado! Transcrição em andamento...");
      } catch (err: any) {
        toast.error("Erro ao enviar áudio: " + err.message);
      }
    }
  }, [activeSession, sessionNotes]);

  const retryMutation = useMutation({
    mutationFn: (id: string) => telehealthApi.retry(id),
    onSuccess: () => toast.info("Reprocessamento iniciado..."),
    onError: (e: Error) => toast.error(e.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => telehealthApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telehealth-sessions"] });
      toast.success("Sessão excluída!");
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { patientId?: string; meetingLink?: string } }) => telehealthApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telehealth-sessions"] });
      setEditSession(null);
      toast.success("Sessão atualizada!");
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const stopBackendCaptureMutation = useMutation({
    mutationFn: (id: string) => telehealthApi.stop(id),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ["telehealth-sessions"] });
      setActiveSession(prev => prev?.id === session.id ? { ...prev, ...session } : prev);
      toast.success("Captura encerrada.");
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const processMutation = useMutation({
    mutationFn: (id: string) => telehealthApi.process(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telehealth-sessions"] });
      toast.info("Processamento com IA iniciado...");
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const formatDuration = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const handleNewSession = () => setShowConsentDialog(true);
  const handleConsentAccepted = () => { setShowConsentDialog(false); setShowNewDialog(true); };
  const handleCreateSession = () => {
    if (!newSessionData.patientId) return toast.error("Selecione um paciente");
    createMutation.mutate({ patientId: newSessionData.patientId, meetingLink: newSessionData.meetingLink || undefined });
  };

  // Document handling
  const handleDocFiles = async (files: FileList | File[]) => {
    const maxSize = 10 * 1024 * 1024;
    const newDocs: AttachedDoc[] = [];
    for (const file of Array.from(files)) {
      if (file.size > maxSize) {
        toast.error(`${file.name} excede 10MB`);
        continue;
      }
      try {
        newDocs.push(await readFileContent(file));
      } catch {
        toast.error(`Erro ao ler ${file.name}`);
      }
    }
    setAttachedDocs(prev => [...prev, ...newDocs].slice(0, 10));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleDocFiles(e.dataTransfer.files);
  };

  // ============================
  // RECORDING MODAL (fullscreen overlay) - inline JSX to avoid remount on state change
  // ============================
  const recordingModalProc = activeSession ? (PROCESSING_MAP[activeSession.processingStatus] || PROCESSING_MAP.none) : PROCESSING_MAP.none;
  const recordingModalIsProcessing = activeSession ? ["uploaded", "transcribing", "organizing"].includes(activeSession.processingStatus) : false;
  const recordingModalIsCompleted = activeSession?.processingStatus === "completed";
  const recordingModalIsError = activeSession?.processingStatus === "error";

  const recordingModalContent = (showRecordingModal && activeSession) ? (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-y-auto"
      >
        <div className="min-h-screen flex flex-col">
          {/* Top bar */}
          <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {isCapturing && (
                  <div className="flex items-center gap-2 bg-destructive/10 text-destructive px-3 py-1.5 rounded-full">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className={`absolute inline-flex h-full w-full rounded-full bg-destructive ${isPaused ? "" : "animate-ping"} opacity-75`}></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive"></span>
                    </span>
                    <span className="font-mono text-sm font-medium">{formatDuration(duration)}</span>
                  </div>
                )}
                {recordingModalIsProcessing && (
                  <div className="flex items-center gap-2 bg-primary/10 text-primary px-3 py-1.5 rounded-full">
                    {recordingModalProc.icon}
                    <span className="text-sm font-medium">{recordingModalProc.label}</span>
                  </div>
                )}
                {recordingModalIsCompleted && (
                  <div className="flex items-center gap-2 bg-success/10 text-success px-3 py-1.5 rounded-full">
                    <CheckCircle className="h-4 w-4" />
                    <span className="text-sm font-medium">Concluído</span>
                  </div>
                )}
              </div>
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {activeSession.patient?.name || "Sessão"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {isCapturing && (
                <>
                  {isPaused ? (
                    <Button size="sm" variant="outline" onClick={resumeCapture} className="gap-1.5">
                      <Play className="h-4 w-4" /> Continuar
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={pauseCapture} className="gap-1.5">
                      <Pause className="h-4 w-4" /> Pausar
                    </Button>
                  )}
                  <Button size="sm" variant="destructive" onClick={stopCapture} className="gap-1.5">
                    <CheckCircle className="h-4 w-4" /> Finalizar
                  </Button>
                </>
              )}
              {!isCapturing && !recordingModalIsProcessing && !recordingModalIsCompleted && (
                <Button size="sm" variant="ghost" onClick={() => { setShowRecordingModal(false); }}>
                  <X className="h-4 w-4" />
                </Button>
              )}
              {(recordingModalIsCompleted || recordingModalIsError) && (
                <Button size="sm" variant="outline" onClick={() => { setShowRecordingModal(false); setActiveSession(null); }}>
                  Fechar
                </Button>
              )}
            </div>
          </div>

          {/* Waveform bar when recording */}
          {isCapturing && (
            <div className="px-4 py-3 border-b border-border bg-destructive/5">
              <div className="flex items-center justify-center gap-0.5 h-8">
                {Array.from({ length: 40 }).map((_, i) => (
                  <motion.div
                    key={i}
                    className="w-1 bg-destructive/60 rounded-full"
                    animate={isPaused ? { height: 4 } : { height: [4, Math.random() * 28 + 4, 4] }}
                    transition={{ repeat: Infinity, duration: 0.4 + Math.random() * 0.6, delay: i * 0.03 }}
                  />
                ))}
              </div>
              <p className="text-center text-xs text-muted-foreground mt-1">
                {isPaused ? "⏸ Gravação pausada" : "🔴 Gravando áudio da sessão"}
              </p>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 p-4 md:p-6 max-w-4xl mx-auto w-full space-y-4">
            {/* Session notes and prompt selection */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="border-primary/20">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-primary text-primary-foreground text-xs px-2 py-0.5">1</Badge>
                    <span className="text-sm font-semibold text-foreground">Motivo da Consulta</span>
                  </div>
                  <Textarea
                    placeholder="Ex.: Ansiedade, acompanhamento mensal, queixa específica..."
                    value={sessionNotes.motivo}
                    onChange={(e) => setSessionNotes(v => ({ ...v, motivo: e.target.value }))}
                    className="min-h-[100px] resize-none text-sm"
                  />
                </CardContent>
              </Card>
              <Card className="border-primary/20">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-primary text-primary-foreground text-xs px-2 py-0.5">2</Badge>
                    <span className="text-sm font-semibold text-foreground">Anotações Livres</span>
                  </div>
                  <Textarea
                    placeholder="Não se preocupe em organizar, a IA fará isso por você."
                    value={sessionNotes.anotacoes}
                    onChange={(e) => setSessionNotes(v => ({ ...v, anotacoes: e.target.value }))}
                    className="min-h-[100px] resize-none text-sm"
                  />
                </CardContent>
              </Card>
              <Card className="border-primary/20">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-primary text-primary-foreground text-xs px-2 py-0.5">3</Badge>
                    <span className="text-sm font-semibold text-foreground">Prompt Especialista</span>
                  </div>
                  <div className="space-y-3">
                    <p className="text-[10px] text-muted-foreground leading-tight">Escolha qual modelo de análise deve ser usado automaticamente ao finalizar.</p>
                    <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                      <SelectTrigger className="text-xs">
                        <SelectValue placeholder="Selecione o prompt..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Padrão do Sistema</SelectItem>
                        {agents.filter(a => a.isActive).map(agent => (
                          <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="p-2 rounded bg-muted/50 border border-border">
                      <p className="text-[10px] text-muted-foreground italic">
                        {selectedAgentId === "default" 
                          ? "O sistema usará a organização clínica padrão." 
                          : agents.find(a => a.id === selectedAgentId)?.description || "Análise personalizada selecionada."}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Document drop area */}
            <Card className="border-primary/20">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Paperclip className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold text-foreground">Documentos para o Prontuário</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{attachedDocs.length}/10 arquivos</span>
                </div>

                <input
                  ref={docInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt,.csv,.png,.jpg,.jpeg,.webp,.xls,.xlsx"
                  className="hidden"
                  onChange={e => { if (e.target.files) handleDocFiles(e.target.files); e.target.value = ""; }}
                />

                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => docInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                    dragOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-primary/5"
                  }`}
                >
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Clique ou arraste</span> documentos aqui
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, imagens, planilhas, textos (máx. 10MB cada)</p>
                </div>

                {attachedDocs.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachedDocs.map((doc, i) => (
                      <div key={i} className="flex items-center gap-1.5 bg-muted rounded-lg px-2.5 py-1.5 text-xs">
                        {doc.type.startsWith("image/") ? <ImageIcon className="w-3.5 h-3.5 text-muted-foreground" /> : <File className="w-3.5 h-3.5 text-muted-foreground" />}
                        <span className="truncate max-w-[140px]">{doc.name}</span>
                        <span className="text-muted-foreground">({formatFileSize(doc.size)})</span>
                        <button onClick={(e) => { e.stopPropagation(); setAttachedDocs(prev => prev.filter((_, idx) => idx !== i)); }}
                          className="ml-1 hover:text-destructive">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Processing status */}
            {recordingModalIsProcessing && (
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  {recordingModalProc.icon}
                  <div>
                    <p className="text-sm font-medium text-foreground">{recordingModalProc.label}</p>
                    <p className="text-xs text-muted-foreground">Aguarde enquanto processamos o áudio da sessão...</p>
                  </div>
                  <Progress className="flex-1 ml-4" value={activeSession.processingStatus === "transcribing" ? 50 : activeSession.processingStatus === "organizing" ? 80 : 30} />
                </CardContent>
              </Card>
            )}

            {/* Error */}
            {recordingModalIsError && (
              <Card className="border-destructive/20">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm font-medium">Erro no processamento</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{activeSession.processingError || "Erro desconhecido"}</p>
                  <Button size="sm" variant="outline" onClick={() => retryMutation.mutate(activeSession.id)} disabled={retryMutation.isPending}>
                    <RefreshCw className="h-3 w-3 mr-1" /> Tentar novamente
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Completed - structured content and full transcription */}
            {recordingModalIsCompleted && (
              <div className="space-y-6">
                {activeSession.structuredContent && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Brain className="h-4 w-4 text-primary" /> Registro Organizado pela IA
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <StructuredSessionContent data={activeSession.structuredContent} />
                    </CardContent>
                  </Card>
                )}

                {/* Manual Analysis with Specialist Prompt */}
                {activeSession.transcription && (
                  <Card className="border-primary/20 bg-primary/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" /> Análise com Especialista
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex gap-2 items-end">
                        <div className="flex-1 space-y-2">
                          <Label className="text-xs">Selecione um Agente Especialista</Label>
                          <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione o prompt..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="default">Padrão do Sistema</SelectItem>
                              {agents.filter(a => a.isActive).map(agent => (
                                <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button 
                          onClick={async () => {
                            const result = await analyzeTextMutation.mutateAsync({
                              text: activeSession.transcription!,
                              agentId: selectedAgentId === "default" ? undefined : selectedAgentId,
                              type: "sessao"
                            });
                            setManualAnalysisResult(result.analysis);
                          }}
                          disabled={analyzeTextMutation.isPending}
                        >
                          {analyzeTextMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4 mr-2" />}
                          Analisar
                        </Button>
                      </div>

                      {manualAnalysisResult && (
                        <div className="mt-4 p-4 bg-background rounded-lg border border-primary/10 prose prose-sm max-w-none">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-bold text-primary">RESULTADO DA ANÁLISE:</span>
                            <Button variant="ghost" size="sm" onClick={() => setManualAnalysisResult(null)}><X className="h-3 w-3" /></Button>
                          </div>
                          <div className="whitespace-pre-wrap text-sm">{manualAnalysisResult}</div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {activeSession.transcription && (
                  <Card>
                    <CardHeader className="pb-2 flex flex-row items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-primary" /> Transcrição Completa
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5"
                        onClick={() => {
                          navigator.clipboard.writeText(activeSession.transcription!);
                          toast.success("Transcrição copiada!");
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" /> Copiar Tudo
                      </Button>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[300px] w-full rounded-md border p-4">
                        <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                          {activeSession.transcription}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}

                <div className="flex justify-center gap-4 pt-4">
                  <Button variant="outline" className="gap-2" onClick={() => setShowRecordingModal(false)}>
                    <CheckCircle className="h-4 w-4" /> Concluir e Fechar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
  ) : null;

  // ============================
  // Active session view (pre-recording)
  // ============================
  if (activeSession && !showRecordingModal) {
    const proc = PROCESSING_MAP[activeSession.processingStatus] || PROCESSING_MAP.none;
    const stat = STATUS_MAP[activeSession.status] || STATUS_MAP.waiting;

    return (
      <div className="p-3 md:p-6 space-y-4 md:space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-2 md:gap-4 flex-wrap">
          <Button variant="ghost" size="icon" onClick={() => setActiveSession(null)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg md:text-2xl font-bold text-foreground">Sessão de Teleatendimento</h1>
          <Badge className={stat.color}>{stat.icon}<span className="ml-1">{stat.label}</span></Badge>
        </div>

        {activeSession.status === "waiting" && (
          <Card className="border-primary/20">
            <CardContent className="p-4 md:p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-muted-foreground">Paciente</p>
                  <p className="text-lg md:text-xl font-semibold text-foreground">{activeSession.patient?.name || "—"}</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-sm text-muted-foreground">Data/Hora</p>
                  <p className="text-foreground text-sm">{format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                </div>
              </div>

              {activeSession.meetingLink && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted">
                  <Video className="h-4 w-4 text-primary shrink-0" />
                  <a href={activeSession.meetingLink} target="_blank" rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1 text-sm truncate">
                    {activeSession.meetingLink} <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </div>
              )}

              {/* Mini Tutorial */}
              <div className="space-y-3">
                <h3 className="font-semibold text-foreground flex items-center gap-2"><Info className="h-4 w-4 text-primary" /> Como funciona</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { icon: <Headphones className="h-5 w-5 text-primary" />, title: "1. Use fones de ouvido", desc: "Para melhor qualidade de áudio e evitar eco." },
                    { icon: <Monitor className="h-5 w-5 text-primary" />, title: "2. Abra o Google Meet/Zoom", desc: "Em outra aba ou janela do navegador." },
                    { icon: <Mic className="h-5 w-5 text-primary" />, title: "3. Permita o microfone", desc: "O sistema pedirá acesso ao microfone e áudio da aba." },
                    { icon: <Shield className="h-5 w-5 text-primary" />, title: "4. Áudio seguro", desc: "Capturado apenas para transcrição e excluído após." },
                  ].map((step, i) => (
                    <div key={i} className="flex gap-3 p-3 rounded-lg bg-muted/50 border border-border/50">
                      <div className="shrink-0 mt-0.5">{step.icon}</div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{step.title}</p>
                        <p className="text-xs text-muted-foreground">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Device Check */}
              <div className="space-y-3">
                <h3 className="font-semibold text-foreground flex items-center gap-2"><Volume2 className="h-4 w-4 text-primary" /> Verificação de Dispositivos</h3>
                {!preflight.checked ? (
                  <Button onClick={runPreflight} disabled={preflight.loading} variant="outline" className="w-full gap-2">
                    {preflight.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                    {preflight.loading ? "Verificando..." : "Verificar Microfone e Áudio"}
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <div className={`flex items-center gap-3 p-3 rounded-lg border ${preflight.mic ? "bg-success/5 border-success/20" : "bg-destructive/5 border-destructive/20"}`}>
                      {preflight.mic ? <CheckCircle className="h-4 w-4 text-success shrink-0" /> : <AlertCircle className="h-4 w-4 text-destructive shrink-0" />}
                      <span className={`text-sm ${preflight.mic ? "text-success" : "text-destructive"}`}>Microfone {preflight.mic ? "detectado ✓" : "não detectado"}</span>
                    </div>
                    <div className={`flex items-center gap-3 p-3 rounded-lg border ${preflight.audio ? "bg-success/5 border-success/20" : "bg-destructive/5 border-destructive/20"}`}>
                      {preflight.audio ? <CheckCircle className="h-4 w-4 text-success shrink-0" /> : <AlertCircle className="h-4 w-4 text-destructive shrink-0" />}
                      <span className={`text-sm ${preflight.audio ? "text-success" : "text-destructive"}`}>Saída de áudio {preflight.audio ? "detectada ✓" : "não detectada"}</span>
                    </div>
                    {preflight.err && <p className="text-sm text-destructive">{preflight.err}</p>}
                    <Button onClick={runPreflight} variant="ghost" size="sm" className="gap-1">
                      <RefreshCw className="h-3 w-3" /> Verificar novamente
                    </Button>
                  </div>
                )}
              </div>

              <Button
                size="lg"
                className="w-full gap-2"
                disabled={preflight.checked && !preflight.mic}
                onClick={startCapture}
              >
                <Phone className="h-5 w-5" /> Iniciar Gravação
              </Button>
            </CardContent>
          </Card>
        )}

        {/* If status is capturing but not local (page was refreshed or stuck) */}
        {(activeSession.status === "capturing" || (activeSession.status !== "completed" && activeSession.status !== "waiting" && new Date().getTime() - new Date(activeSession.createdAt).getTime() > 24 * 60 * 60 * 1000)) && !isCapturing && (
          <Card className="border-destructive/20 bg-destructive/5">
            <CardContent className="p-4 md:p-6 space-y-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <span className="font-medium text-foreground">Sessão Travada ou Captura Externa</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Esta sessão parece estar com o status "Capturando" há algum tempo. Se você não está gravando ativamente agora, você deve encerrar a captura manualmente para liberar o processamento ou excluir a sessão.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button 
                  variant="destructive" 
                  onClick={() => stopBackendCaptureMutation.mutate(activeSession.id)}
                  disabled={stopBackendCaptureMutation.isPending} 
                  className="gap-2"
                >
                  {stopBackendCaptureMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneOff className="h-4 w-4" />}
                  Forçar Encerramento
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    if (confirm("Tem certeza que deseja excluir esta sessão permanentemente?")) {
                      deleteMutation.mutate(activeSession.id);
                      setActiveSession(null);
                    }
                  }} 
                  className="gap-2 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" /> Excluir Sessão
                </Button>
                <Button variant="ghost" onClick={() => setActiveSession(null)} className="gap-2">
                  <ArrowLeft className="h-4 w-4" /> Voltar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Processing/completed status if not in modal */}
        {["uploaded", "completed"].includes(activeSession.status) && (
          <Card>
            <CardContent className="p-4 md:p-6 space-y-4">
              <div className="flex items-center gap-2">
                {proc.icon}
                <span className="text-sm font-medium text-foreground">{proc.label}</span>
              </div>
              {activeSession.processingStatus === "error" && (
                <Button size="sm" variant="outline" onClick={() => retryMutation.mutate(activeSession.id)}>
                  <RefreshCw className="h-3 w-3 mr-1" /> Tentar novamente
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ============================
  // Sessions list view
  // ============================
  return (
    <>
      <AnimatePresence>
        {recordingModalContent}
      </AnimatePresence>

      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
              Teleatendimento Inteligente
              <Badge variant="outline" className="text-[10px] py-0 h-4 bg-primary/5 text-primary border-primary/20">IA Ativa</Badge>
            </h1>
            <p className="text-muted-foreground text-xs md:text-sm max-w-lg">Capture sessões (Google Meet/Zoom), transcreva automaticamente e gere prontuários estruturados usando Inteligência Artificial.</p>
          </div>
          <Button onClick={handleNewSession} className="gap-2 w-full sm:w-auto"><Plus className="h-4 w-4" /> Nova Sessão</Button>
        </div>

        {isLoading ? (
          <div className="grid gap-3 md:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map(i => <Card key={i} className="h-40 animate-pulse bg-muted" />)}
          </div>
        ) : sessions.length === 0 ? (
          <Card className="p-8 md:p-12 text-center">
            <Video className="h-10 w-10 md:h-12 md:w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-sm">Nenhuma sessão de teleatendimento ainda.</p>
            <Button className="mt-4 w-full sm:w-auto" onClick={handleNewSession}><Plus className="h-4 w-4 mr-2" /> Criar Primeira Sessão</Button>
          </Card>
        ) : (
          <div className="grid gap-3 md:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence>
              {sessions.map((s) => {
                const stat = STATUS_MAP[s.status] || STATUS_MAP.waiting;
                const proc = PROCESSING_MAP[s.processingStatus] || PROCESSING_MAP.none;
                const canEdit = s.status === "waiting";
                const canDelete = s.status === "waiting" || s.status === "completed" || s.processingStatus === "error";
                const canProcess = s.status === "uploaded" && (s.processingStatus === "uploaded" || s.processingStatus === "error");
                return (
                  <motion.div key={s.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <Card className="hover:border-primary/40 transition-colors">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between cursor-pointer" onClick={() => {
                          if (s.status === "waiting" || s.status === "capturing") setActiveSession(s);
                          else setShowDetail(s.id);
                        }}>
                          <p className="font-semibold text-foreground">{s.patient?.name || s.couple?.name || "—"}</p>
                          <Badge className={stat.color}>{stat.icon}<span className="ml-1 text-xs">{stat.label}</span></Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{format(new Date(s.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                        {s.duration && <p className="text-xs text-muted-foreground">Duração: {formatDuration(s.duration)}</p>}
                        <div className="flex items-center gap-2 text-xs">
                          {proc.icon}<span className="text-muted-foreground">{proc.label}</span>
                        </div>
                        <div className="flex items-center gap-2 pt-2 border-t border-border/50 flex-wrap">
                          {canEdit && (
                            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={(e) => {
                              e.stopPropagation();
                              setEditSession(s);
                              setEditData({ patientId: s.patientId || "", meetingLink: s.meetingLink || "" });
                            }}>
                              <FileText className="h-3 w-3" /> Editar
                            </Button>
                          )}
                          {canProcess && (
                            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-primary" onClick={(e) => {
                              e.stopPropagation();
                              processMutation.mutate(s.id);
                            }} disabled={processMutation.isPending}>
                              <Brain className="h-3 w-3" /> Processar IA
                            </Button>
                          )}
                          {s.status === "capturing" && (
                            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-destructive" onClick={(e) => {
                              e.stopPropagation();
                              if (confirm("Deseja forçar o encerramento desta captura?")) {
                                stopBackendCaptureMutation.mutate(s.id);
                              }
                            }}>
                              <PhoneOff className="h-3 w-3" /> Parar Captura
                            </Button>
                          )}
                          {s.processingStatus === "error" && (
                            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={(e) => {
                              e.stopPropagation();
                              retryMutation.mutate(s.id);
                            }}>
                              <RefreshCw className="h-3 w-3" /> Tentar novamente
                            </Button>
                          )}
                          {canDelete && (
                            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-destructive" onClick={(e) => {
                              e.stopPropagation();
                              if (confirm("Deseja realmente excluir esta sessão?")) deleteMutation.mutate(s.id);
                            }} disabled={deleteMutation.isPending}>
                              <Trash2 className="h-3 w-3" /> Excluir
                            </Button>
                          )}
                          {(s.status !== "waiting") && (
                            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs ml-auto" onClick={(e) => {
                              e.stopPropagation();
                              setShowDetail(s.id);
                            }}>
                              <Eye className="h-3 w-3" /> Detalhes
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {/* Consent Dialog */}
        <Dialog open={showConsentDialog} onOpenChange={setShowConsentDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-primary" /> Aviso de Privacidade</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm text-muted-foreground">
              <p>Ao iniciar uma sessão de teleatendimento com captura de áudio:</p>
              <ul className="list-disc pl-5 space-y-2">
                <li>O áudio da sessão será capturado <strong>apenas para gerar a transcrição</strong> e organizar o prontuário.</li>
                <li>O arquivo de áudio será armazenado <strong>apenas temporariamente</strong> em área privada e segura.</li>
                <li>Após a transcrição, o áudio será <strong>excluído automaticamente</strong> do sistema.</li>
                <li>Apenas o texto organizado permanecerá no prontuário do paciente.</li>
                <li><strong>Nenhum acesso humano</strong> ao arquivo de áudio bruto é permitido.</li>
              </ul>
              <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                <p className="text-xs text-primary font-medium">🔒 Toda a comunicação é criptografada e o áudio é processado de forma automatizada e segura.</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowConsentDialog(false)}>Cancelar</Button>
              <Button onClick={handleConsentAccepted} className="gap-2"><Shield className="h-4 w-4" /> Aceitar e Continuar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* New Session Dialog */}
        <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova Sessão de Teleatendimento</DialogTitle>
              <DialogDescription>Configure a sessão com captura de áudio segura</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">Paciente *</label>
                <Select value={newSessionData.patientId} onValueChange={v => setNewSessionData(p => ({ ...p, patientId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione o paciente" /></SelectTrigger>
                  <SelectContent>
                    {patients.map((p: Patient) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Link da Reunião (opcional)</label>
                <Input placeholder="https://meet.google.com/... ou zoom.us/..."
                  value={newSessionData.meetingLink}
                  onChange={e => setNewSessionData(p => ({ ...p, meetingLink: e.target.value }))} />
                <p className="text-xs text-muted-foreground mt-1">Google Meet, Zoom ou outro link de videochamada</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNewDialog(false)}>Cancelar</Button>
              <Button onClick={handleCreateSession} disabled={createMutation.isPending} className="gap-2">
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                Criar Sessão
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Detail Dialog */}
        <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto w-[95vw] md:w-auto">
            <DialogHeader>
              <DialogTitle>Detalhes da Sessão</DialogTitle>
            </DialogHeader>
            {detailSession && (() => {
              const liveSession = sessions.find(s => s.id === detailSession.id) ?? detailSession;
              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 md:gap-4">
                    <div><p className="text-xs text-muted-foreground">Paciente</p><p className="font-medium text-foreground">{liveSession.patient?.name || detailSession.patient?.name || "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Data</p><p className="text-foreground">{format(new Date(liveSession.createdAt || detailSession.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p></div>
                    <div><p className="text-xs text-muted-foreground">Duração</p><p className="text-foreground">{(liveSession.duration ?? detailSession.duration) ? formatDuration((liveSession.duration ?? detailSession.duration) as number) : "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Status</p><Badge className={STATUS_MAP[liveSession.status]?.color}>{STATUS_MAP[liveSession.status]?.label}</Badge></div>
                  </div>

                  {detailSession.transcription && (
                    <div>
                      <p className="text-sm font-medium text-foreground mb-2 flex items-center gap-2"><FileText className="h-4 w-4" /> Transcrição</p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted p-4 rounded-lg max-h-48 overflow-y-auto">{detailSession.transcription}</p>
                    </div>
                  )}

                  {detailSession.structuredContent && (
                    <StructuredSessionContent data={detailSession.structuredContent} />
                  )}

                  {detailSession.recordId && (
                    <div className="flex items-center gap-2 text-sm text-success">
                      <CheckCircle className="h-4 w-4" /> Vinculado ao prontuário
                    </div>
                  )}

                  {detailSession.auditLogs && detailSession.auditLogs.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-foreground mb-2 flex items-center gap-2"><Shield className="h-4 w-4" /> Log de Auditoria</p>
                      <div className="space-y-1">
                        {detailSession.auditLogs.map(log => (
                          <div key={log.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{format(new Date(log.createdAt), "HH:mm:ss")}</span>
                            <span className="font-mono bg-muted px-1 rounded">{log.action}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-3">
                    <Trash2 className="h-3 w-3" /> Áudio excluído automaticamente após processamento
                  </div>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>

        {/* Edit Session Dialog */}
        <Dialog open={!!editSession} onOpenChange={() => setEditSession(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar Sessão</DialogTitle>
              <DialogDescription>Altere os dados da sessão antes de iniciar</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">Paciente</label>
                <Select value={editData.patientId} onValueChange={v => setEditData(p => ({ ...p, patientId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione o paciente" /></SelectTrigger>
                  <SelectContent>
                    {patients.map((p: Patient) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Link da Reunião (opcional)</label>
                <Input placeholder="https://meet.google.com/..."
                  value={editData.meetingLink}
                  onChange={e => setEditData(p => ({ ...p, meetingLink: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditSession(null)}>Cancelar</Button>
              <Button onClick={() => {
                if (editSession) updateMutation.mutate({ id: editSession.id, data: editData });
              }} disabled={updateMutation.isPending} className="gap-2">
                {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}