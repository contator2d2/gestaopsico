import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, FileSpreadsheet, Users, Calendar, DollarSign, Heart,
  CheckCircle, AlertTriangle, Trash2, RotateCcw, ArrowRight,
  Eye, Loader2, X, Download,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { apiRequest } from "@/lib/api";

/* ── helpers ──────────────────────────────────────────────── */
function readXlsx(file: File): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result as string;
        // Simple CSV-like approach: parse the XLSX via a temporary worker
        // We'll send the raw base64 to the backend for parsing
        // For client-side, we parse as CSV or use SheetJS
        resolve(parseSpreadsheet(data));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

function parseSpreadsheet(data: string): Record<string, string>[] {
  // Lightweight XLSX parser using the binary string
  // We use a simplified approach: detect if it's a ZIP (XLSX) and extract sheet data
  // For production, we'd use SheetJS. For now, we'll handle CSV fallback
  // and send raw data to backend
  try {
    // Try CSV parsing first
    const lines = data.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(/[,;\t]/).map(h => h.trim().replace(/^"/, '').replace(/"$/, ''));
    return lines.slice(1).map(line => {
      const values = line.split(/[,;\t]/).map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = values[i] || ''; });
      return row;
    });
  } catch {
    return [];
  }
}

/* ── API ──────────────────────────────────────────────────── */
const importApi = {
  preview: (patients: any[], sessions: any[]) =>
    apiRequest<any>("/import/xlsx", { method: "POST", body: { patients, sessions, preview: true } }),
  execute: (patients: any[], sessions: any[]) =>
    apiRequest<any>("/import/xlsx", { method: "POST", body: { patients, sessions } }),
  batches: () => apiRequest<any[]>("/import/batches"),
  rollback: (id: string) => apiRequest<any>(`/import/batches/${id}`, { method: "DELETE" }),
};

/* ── Types ────────────────────────────────────────────────── */
interface PreviewData {
  patients: number;
  sessions: number;
  couples: string[];
  futureAppointments: number;
  pastSessions: number;
  cancelledSessions: number;
  financialEntries: number;
}

/* ── Component ────────────────────────────────────────────── */
export default function ImportacaoDados() {
  const qc = useQueryClient();
  const [step, setStep] = useState<"upload" | "mapping" | "preview" | "done">("upload");
  const [patientsFile, setPatientsFile] = useState<File | null>(null);
  const [sessionsFile, setSessionsFile] = useState<File | null>(null);
  const [patientsData, setPatientsData] = useState<any[]>([]);
  const [sessionsData, setSessionsData] = useState<any[]>([]);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  
  // Mapping state
  const [patientMapping, setPatientMapping] = useState<Record<string, string>>({});
  const [sessionMapping, setSessionMapping] = useState<Record<string, string>>({});
  const [originalHeaders, setOriginalHeaders] = useState<{patients: string[], sessions: string[]}>({
    patients: [],
    sessions: []
  });

  const { data: batches = [], isLoading: loadingBatches } = useQuery({
    queryKey: ["import-batches"],
    queryFn: importApi.batches,
  });

  const rollbackMut = useMutation({
    mutationFn: (id: string) => importApi.rollback(id),
    onSuccess: (data) => {
      toast.success("Importação desfeita com sucesso", {
        description: `Removidos: ${data.removed?.patients || 0} pacientes, ${data.removed?.appointments || 0} sessões`,
      });
      qc.invalidateQueries({ queryKey: ["import-batches"] });
      qc.invalidateQueries({ queryKey: ["patients"] });
      qc.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: () => toast.error("Erro ao desfazer importação"),
  });

  /* File handlers - parse XLSX on client using SheetJS CDN */
  const handleFileSelect = useCallback(async (file: File, type: "patients" | "sessions") => {
    try {
      // Dynamic import of SheetJS from CDN
      // @ts-ignore
      if (!window.XLSX) {
        const script = document.createElement("script");
        script.src = "https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js";
        document.head.appendChild(script);
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
        });
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        // @ts-ignore
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        // @ts-ignore
        const wb = window.XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        // @ts-ignore
        const rows = window.XLSX.utils.sheet_to_json(ws, { defval: "" });
        
        if (rows.length === 0) {
          toast.error("Arquivo vazio ou sem dados válidos");
          return;
        }

        const headers = Object.keys(rows[0]);
        
        if (type === "patients") {
          setPatientsFile(file);
          setPatientsData(rows);
          setOriginalHeaders(prev => ({ ...prev, patients: headers }));
          
          // Auto-mapping
          const mapping: Record<string, string> = {};
          const fieldSuggestions: Record<string, string[]> = {
            "Nome": ["nome", "paciente", "nome do paciente", "name"],
            "Data de Nascimento": ["data de nascimento", "nascimento", "data_nascimento", "birth date", "birthdate", "data de nasc"],
            "CPF": ["cpf", "documento", "doc"],
            "CEP": ["cep", "zip", "zipcode"],
            "Endereço": ["endereço", "endereco", "address", "logradouro"],
            "Telefone": ["telefone", "celular", "phone", "mobile", "tel"],
            "E-mail": ["e-mail", "email", "mail"],
            "Data de Pagamento": ["data de pagamento", "pagamento", "data_pagamento", "payment date"],
            "Observações": ["observações", "observacao", "obs", "notes"],
            "Psicólogo": ["psicólogo", "psicologo", "terapeuta", "professional"],
            "Criado em": ["criado em", "data de cadastro", "created_at"]
          };

          headers.forEach(h => {
            const normalizedH = h.toLowerCase().trim();
            for (const [field, suggestions] of Object.entries(fieldSuggestions)) {
              if (suggestions.includes(normalizedH)) {
                mapping[field] = h;
                break;
              }
            }
          });
          setPatientMapping(mapping);
        } else {
          setSessionsFile(file);
          setSessionsData(rows);
          setOriginalHeaders(prev => ({ ...prev, sessions: headers }));
          
          // Auto-mapping
          const mapping: Record<string, string> = {};
          const possibleFields = ["Paciente", "Data", "Horário", "Duração", "Status", "Pagamento", "Valor Esperado", "Valor Pago"];
          headers.forEach(h => {
            const field = possibleFields.find(f => f.toLowerCase() === h.toLowerCase());
            if (field) mapping[field] = h;
          });
          setSessionMapping(mapping);
        }
        
        toast.success(`${rows.length} registros carregados de ${file.name}`);
      };
      reader.readAsArrayBuffer(file);
    } catch (err) {
      console.error("Erro ao ler arquivo:", err);
      toast.error("Erro ao ler arquivo. Verifique se é um arquivo Excel (.xlsx) válido.");
    }
  }, []);

  const handleToMapping = () => {
    if (!patientsData.length && !sessionsData.length) {
      toast.error("Carregue pelo menos um arquivo");
      return;
    }
    setStep("mapping");
  };

  const validateAndTransformData = (data: any[], mapping: Record<string, string>) => {
    return data.map(row => {
      const newRow: any = {};
      Object.entries(mapping).forEach(([target, source]) => {
        newRow[target] = row[source];
      });
      return newRow;
    });
  };

  const handlePreview = async () => {
    // Check required fields before preview
    if (patientsFile) {
      if (!patientMapping["Nome"]) {
        toast.error("Mapeie a coluna 'Nome' na planilha de pacientes.");
        return;
      }
    }
    if (sessionsFile) {
      if (!sessionMapping["Paciente"] || !sessionMapping["Data"]) {
        toast.error("Mapeie as colunas 'Paciente' e 'Data' na planilha de sessões.");
        return;
      }
    }

    try {
      const mappedPatients = validateAndTransformData(patientsData, patientMapping);
      const mappedSessions = validateAndTransformData(sessionsData, sessionMapping);

      let data;
      try {
        data = await importApi.preview(mappedPatients, mappedSessions);
      } catch (e) {
        data = {
          patients: mappedPatients.length,
          sessions: mappedSessions.length,
          couples: [],
          futureAppointments: 0,
          pastSessions: mappedSessions.length,
          cancelledSessions: 0,
          financialEntries: mappedSessions.length
        };
      }
      setPreview(data);
      setStep("preview");
    } catch (err) {
      toast.error("Erro ao gerar preview");
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const mappedPatients = validateAndTransformData(patientsData, patientMapping);
      const mappedSessions = validateAndTransformData(sessionsData, sessionMapping);
      
      const data = await importApi.execute(mappedPatients, mappedSessions);
      setResult(data);
      setStep("done");
      qc.invalidateQueries({ queryKey: ["import-batches"] });
      qc.invalidateQueries({ queryKey: ["patients"] });
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast.success("Importação concluída com sucesso!");
    } catch (err: any) {
      console.error("Erro na importação:", err);
      toast.error(err.message || "Erro na importação. Verifique se o servidor está respondendo.");
    } finally {
      setImporting(false);
    }
  };

  const resetForm = () => {
    setStep("upload");
    setPatientsFile(null);
    setSessionsFile(null);
    setPatientsData([]);
    setSessionsData([]);
    setPreview(null);
    setResult(null);
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Importação de Dados</h1>
        <p className="text-sm text-muted-foreground">
          Importe pacientes e sessões de outro sistema via planilha XLSX
        </p>
      </div>

      {/* ── Steps indicator ─────────────────────────────── */}
      <div className="flex items-center gap-2 text-sm">
        {["Upload", "Mapeamento", "Preview", "Concluído"].map((label, i) => {
          const stepIdx = i;
          const current = step === ["upload", "mapping", "preview", "done"][i];
          const past = ["upload", "mapping", "preview", "done"].indexOf(step) > i;
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && <ArrowRight className="w-4 h-4 text-muted-foreground" />}
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                current ? "bg-primary text-primary-foreground" :
                past ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                {past ? <CheckCircle className="w-3.5 h-3.5" /> : null}
                {label}
              </div>
            </div>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {/* ── STEP 1: Upload ──────────────────────────── */}
        {step === "upload" && (
          <motion.div key="upload" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <FileDropZone
                label="Planilha de Pacientes"
                description="Colunas: Nome, Email, Telefone, Observações"
                icon={Users}
                file={patientsFile}
                count={patientsData.length}
                onSelect={(f) => handleFileSelect(f, "patients")}
                onClear={() => { setPatientsFile(null); setPatientsData([]); }}
              />
              <FileDropZone
                label="Planilha de Sessões"
                description="Colunas: Paciente, Data, Horário, Status, Valor"
                icon={Calendar}
                file={sessionsFile}
                count={sessionsData.length}
                onSelect={(f) => handleFileSelect(f, "sessions")}
                onClear={() => { setSessionsFile(null); setSessionsData([]); }}
              />
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={handleToMapping} disabled={!patientsData.length && !sessionsData.length} className="gap-2">
                <ArrowRight className="w-4 h-4" /> Próximo: Mapear Colunas
              </Button>
              <p className="text-xs text-muted-foreground">
                Mapeie as colunas da sua planilha antes de importar
              </p>
            </div>

            {/* Sample format info */}
            <Card className="border-dashed">
              <CardContent className="pt-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">Formato esperado das planilhas:</p>
                <div className="grid md:grid-cols-2 gap-4 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">pacientes.xlsx</p>
                    <p>Nome | Email | Telefone | Psicólogo | Observações | Criado em</p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">sessoes.xlsx</p>
                    <p>Paciente | Data | Horário | Duração | Status | Pagamento | Valor Esperado | Valor Pago</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ── STEP 1.5: Mapping ───────────────────────── */}
        {step === "mapping" && (
          <motion.div key="mapping" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              {patientsFile && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Users className="w-4 h-4" /> Mapeamento de Pacientes
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {[
                      { label: "Nome", required: true },
                      { label: "Data de Nascimento" },
                      { label: "CPF" },
                      { label: "CEP" },
                      { label: "Endereço" },
                      { label: "Telefone" },
                      { label: "E-mail" },
                      { label: "Data de Pagamento" },
                      { label: "Observações" },
                      { label: "Psicólogo" },
                      { label: "Criado em" }
                    ].map(field => (
                      <div key={field.label} className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground flex items-center justify-between">
                          <span>{field.label} {field.required && <span className="text-destructive">*</span>}</span>
                          {!patientMapping[field.label] && field.required && (
                            <span className="text-[10px] text-destructive">Obrigatório</span>
                          )}
                        </label>
                        <select
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          value={patientMapping[field.label] || ""}
                          onChange={(e) => setPatientMapping(prev => ({ ...prev, [field.label]: e.target.value }))}
                        >
                          <option value="">-- Ignorar ou não encontrado --</option>
                          {originalHeaders.patients.map(h => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {sessionsFile && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Calendar className="w-4 h-4" /> Mapeamento de Sessões
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {[
                      { label: "Paciente", required: true },
                      { label: "Data", required: true },
                      { label: "Horário" },
                      { label: "Duração" },
                      { label: "Status" },
                      { label: "Pagamento" },
                      { label: "Valor Esperado" },
                      { label: "Valor Pago" }
                    ].map(field => (
                      <div key={field.label} className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground flex items-center justify-between">
                          <span>{field.label} {field.required && <span className="text-destructive">*</span>}</span>
                          {!sessionMapping[field.label] && field.required && (
                            <span className="text-[10px] text-destructive">Obrigatório</span>
                          )}
                        </label>
                        <select
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          value={sessionMapping[field.label] || ""}
                          onChange={(e) => setSessionMapping(prev => ({ ...prev, [field.label]: e.target.value }))}
                        >
                          <option value="">-- Ignorar ou não encontrado --</option>
                          {originalHeaders.sessions.map(h => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => setStep("mapping")}>Voltar</Button>
              <Button onClick={handlePreview} className="gap-2">
                <Eye className="w-4 h-4" /> Próximo: Ver Resumo
              </Button>
            </div>
          </motion.div>
        )}

        {/* ── STEP 2: Preview ─────────────────────────── */}
        {step === "preview" && preview && (
          <motion.div key="preview" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-4">
            <Card className="bg-gradient-to-br from-primary/5 to-transparent border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="w-4 h-4" /> Resumo da Importação
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatItem icon={Users} label="Pacientes" value={preview.patients} color="text-primary" />
                  <StatItem icon={Heart} label="Casais" value={preview.couples.length} color="text-pink-500" />
                  <StatItem icon={Calendar} label="Sessões realizadas" value={preview.pastSessions} color="text-emerald-500" />
                  <StatItem icon={Calendar} label="Agendamentos futuros" value={preview.futureAppointments} color="text-blue-500" />
                  <StatItem icon={DollarSign} label="Entradas financeiras" value={preview.financialEntries} color="text-amber-500" />
                  <StatItem icon={X} label="Sessões canceladas" value={preview.cancelledSessions} color="text-muted-foreground" />
                </div>

                {preview.couples.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Casais detectados:</p>
                    <div className="flex flex-wrap gap-2">
                      {preview.couples.map(c => (
                        <Badge key={c} variant="secondary" className="text-xs gap-1">
                          <Heart className="w-3 h-3" /> {c}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-amber-700 dark:text-amber-400">Atenção</p>
                <p className="text-muted-foreground">
                  Ao confirmar, todos os dados serão importados. Você poderá desfazer a importação completa a qualquer momento.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => setStep("mapping")}>Voltar</Button>
              <Button onClick={handleImport} disabled={importing} className="gap-2">
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {importing ? "Importando..." : "Confirmar Importação"}
              </Button>
            </div>
          </motion.div>
        )}

        {/* ── STEP 3: Done ────────────────────────────── */}
        {step === "done" && result && (
          <motion.div key="done" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-4">
            <Card className="bg-gradient-to-br from-emerald-500/5 to-transparent border-emerald-500/20">
              <CardContent className="pt-6 text-center">
                <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                <h2 className="text-lg font-bold text-foreground mb-1">Importação Concluída!</h2>
                <p className="text-sm text-muted-foreground mb-4">Todos os dados foram importados com sucesso</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-lg mx-auto">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">{result.patients}</p>
                    <p className="text-xs text-muted-foreground">Pacientes</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">{result.couples}</p>
                    <p className="text-xs text-muted-foreground">Casais</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">{result.appointments}</p>
                    <p className="text-xs text-muted-foreground">Sessões</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">{result.financialEntries}</p>
                    <p className="text-xs text-muted-foreground">Financeiro</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Button onClick={resetForm} variant="outline" className="gap-2">
              <Upload className="w-4 h-4" /> Nova Importação
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Histórico de importações ──────────────────── */}
      <div className="pt-4 border-t border-border">
        <h2 className="text-base font-bold text-foreground mb-3">Histórico de Importações</h2>
        {loadingBatches ? (
          <div className="space-y-2">
            {[1, 2].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma importação realizada</p>
        ) : (
          <div className="space-y-2">
            {batches.map((b: any) => (
              <Card key={b.id}>
                <CardContent className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="w-5 h-5 text-primary shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{b.fileName || "Importação XLSX"}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(b.createdAt).toLocaleDateString("pt-BR")} às {new Date(b.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        {b.summary && ` · ${b.summary.patients || 0} pac. · ${b.summary.appointments || 0} sess.`}
                      </p>
                    </div>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive gap-1.5">
                        <RotateCcw className="w-3.5 h-3.5" /> Desfazer
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Desfazer importação?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Todos os pacientes, sessões, casais e entradas financeiras criados nesta importação serão removidos permanentemente. Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => rollbackMut.mutate(b.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {rollbackMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                          Sim, desfazer
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────── */
function FileDropZone({ label, description, icon: Icon, file, count, onSelect, onClear }: {
  label: string; description: string; icon: any; file: File | null; count: number;
  onSelect: (f: File) => void; onClear: () => void;
}) {
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) onSelect(f);
  }, [onSelect]);

  return (
    <Card className={`relative transition-all ${file ? "border-primary/30 bg-primary/5" : "border-dashed hover:border-primary/30"}`}>
      <CardContent className="pt-6 pb-4 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {file ? (
          <>
            <CheckCircle className="w-8 h-8 text-primary mx-auto mb-2" />
            <p className="text-sm font-medium text-foreground">{file.name}</p>
            <p className="text-xs text-muted-foreground">{count} registros carregados</p>
            <Button variant="ghost" size="sm" onClick={onClear} className="mt-2 text-xs text-muted-foreground">
              <X className="w-3 h-3 mr-1" /> Remover
            </Button>
          </>
        ) : (
          <>
            <Icon className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium text-foreground mb-1">{label}</p>
            <p className="text-xs text-muted-foreground mb-3">{description}</p>
             <label className="cursor-pointer inline-block">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors">
                <Upload className="w-3.5 h-3.5" /> Selecionar arquivo
              </span>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onSelect(f);
              }} />
            </label>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatItem({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`w-4 h-4 ${color} shrink-0`} />
      <div>
        <p className="text-lg font-bold text-foreground">{value}</p>
        <p className="text-[10px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
