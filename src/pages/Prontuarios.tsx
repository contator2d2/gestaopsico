import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { pacientesApi, consultasApi, casaisApi, type Consulta } from "@/lib/api";
import { recordsApi, type RecordData } from "@/lib/recordsApi";
import StructuredSessionContent from "@/components/telehealth/StructuredSessionContent";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  FileText, Plus, Search, Calendar, User, Edit, Eye, Sparkles, Brain,
  AlertTriangle, TrendingUp, Tag, BarChart3, Clock, ChevronRight, ArrowLeft,
  Users, Heart, Filter, CalendarDays, Trash2, RefreshCw, CheckCircle2, Smile,
  DollarSign, ClipboardList
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import PatientTimeline from "@/components/records/PatientTimeline";
import ClinicalDashboard from "@/components/records/ClinicalDashboard";
import MoodDashboard from "@/components/MoodDashboard";
import PatientHub from "@/components/records/PatientHub";
import PremiumClinicalRecord from "@/components/records/PremiumClinicalRecord";
import PatientInsights from "@/components/records/PatientInsights";
import PatientFinancial from "@/components/records/PatientFinancial";
import PatientTestsTab from "@/components/records/PatientTestsTab";
import { LayoutDashboard, Target } from "lucide-react";
import PatientGoals from "@/components/records/PatientGoals";
import { useNavigate } from "react-router-dom";
import { getLocalDateString } from "@/lib/utils";

const EMPTY_FORM = {
  patientId: "", coupleId: "", appointmentId: "", type: "individual" as string,
  date: getLocalDateString(), modality: "in_person" as string,
  content: "", complaint: "", keyPoints: "", clinicalObservations: "",
  interventions: "", evolution: "", nextSteps: "", privateNotes: "", aiContent: "",
};

type TypeFilter = "all" | "individual" | "couple";

export default function Prontuarios() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialPatientId = searchParams.get("patientId") || "";
  const initialCoupleId = searchParams.get("coupleId") || "";
  const initialCoupleName = searchParams.get("coupleName") || "";

  // Two-level: null = patient list, string = selected patient/couple detail
  const [selectedEntity, setSelectedEntity] = useState<{ type: "patient" | "couple"; id: string; name: string } | null>(
    initialPatientId ? { type: "patient", id: initialPatientId, name: "" } :
    initialCoupleId ? { type: "couple", id: initialCoupleId, name: initialCoupleName } : null
  );
  const [detailTab, setDetailTab] = useState("overview");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<RecordData | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [aiLoading, setAiLoading] = useState<string | null>(null);

  // Data
  const { data: patients = [] } = useQuery({
    queryKey: ["pacientes-all"],
    queryFn: async () => {
      const res = await pacientesApi.list();
      return Array.isArray(res) ? res : (res as any).data ?? [];
    },
  });

  const { data: couples = [] } = useQuery({
    queryKey: ["couples"],
    queryFn: () => casaisApi.list(),
  });

  const { data: records = [], isLoading: recordsLoading } = useQuery({
    queryKey: ["prontuarios", selectedEntity?.id],
    queryFn: () => {
      if (!selectedEntity) return recordsApi.listAll();
      if (selectedEntity.type === "patient") return recordsApi.listAll({ patientId: selectedEntity.id });
      return recordsApi.listAll({ coupleId: selectedEntity.id });
    },
  });

  const { data: appointments = [] } = useQuery({
    queryKey: ["consultas-for-prontuario", form.patientId],
    queryFn: () => consultasApi.list({}),
    enabled: isCreateOpen,
  });

  // Appointments for the selected patient (detail view)
  const { data: patientApts = [], isLoading: aptsLoading } = useQuery<Consulta[]>({
    queryKey: ["patient-appointments", selectedEntity?.id],
    queryFn: () => consultasApi.list({ patientId: selectedEntity?.id || "" }),
    enabled: !!selectedEntity && selectedEntity.type === "patient",
  });

  const [editAptDialog, setEditAptDialog] = useState(false);
  const [editingApt, setEditingApt] = useState<Partial<Consulta> | null>(null);

  const updateAptMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Consulta> }) => consultasApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["patient-financial-detail"] });
      toast.success("Consulta atualizada");
      setEditAptDialog(false);
      setEditingApt(null);
    },
    onError: () => toast.error("Erro ao atualizar consulta"),
  });

  const cancelAptMutation = useMutation({
    mutationFn: (id: string) => consultasApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-appointments"] });
      toast.success("Consulta cancelada");
    },
    onError: () => toast.error("Erro ao cancelar consulta"),
  });

  const attendAptMutation = useMutation({
    mutationFn: (id: string) => consultasApi.attend(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["patient-financial-detail"] });
      toast.success("Comparecimento registrado");
    },
    onError: () => toast.error("Erro ao registrar comparecimento"),
  });

  const missAptMutation = useMutation({
    mutationFn: (id: string) => consultasApi.miss(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["patient-financial-detail"] });
      toast.success("Falta registrada");
    },
    onError: () => toast.error("Erro ao registrar falta"),
  });

  // Build card list: patients + couples with record counts
  const entityCards = useMemo(() => {
    const allRecords = records;
    const patientCards = patients.map((p: any) => ({
      type: "patient" as const,
      id: p.id,
      name: p.name,
      recordCount: 0, // will use all records if not filtered
      lastDate: null as string | null,
    }));

    const coupleCards = (couples as any[]).map((c: any) => ({
      type: "couple" as const,
      id: c.id,
      name: c.name || `${c.patient1?.name} & ${c.patient2?.name}`,
      recordCount: 0,
      lastDate: null as string | null,
    }));

    return [...patientCards, ...coupleCards];
  }, [patients, couples]);

  // Filter cards
  const filteredCards = useMemo(() => {
    let cards = entityCards;
    if (typeFilter === "individual") cards = cards.filter(c => c.type === "patient");
    if (typeFilter === "couple") cards = cards.filter(c => c.type === "couple");
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      cards = cards.filter(c => c.name.toLowerCase().includes(term));
    }
    return cards;
  }, [entityCards, typeFilter, searchTerm]);

  // Mutations
  const createMutationApt = useMutation({
    mutationFn: (data: Partial<Consulta>) => consultasApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["patient-financial-detail"] });
      toast.success("Sessão lançada com sucesso");
      setEditAptDialog(false);
      setEditingApt(null);
    },
    onError: (err: any) => toast.error(err.message || "Erro ao criar sessão"),
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<RecordData>) => recordsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prontuarios"] });
      toast.success("Prontuário criado com sucesso");
      setIsCreateOpen(false);
      setForm({ ...EMPTY_FORM });
    },
    onError: () => toast.error("Erro ao criar prontuário"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<RecordData> }) => recordsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prontuarios"] });
      toast.success("Prontuário atualizado");
      setIsEditOpen(false);
      setIsViewOpen(false);
    },
    onError: () => toast.error("Erro ao atualizar"),
  });

  const handleCreate = () => {
    if (!form.patientId && !form.coupleId) { toast.error("Selecione um paciente ou casal"); return; }
    const hasContent = form.content || form.complaint || form.keyPoints;
    if (!hasContent) { toast.error("Preencha pelo menos o motivo ou conteúdo"); return; }
    const data: Partial<RecordData> = {
      type: form.type, date: form.date, modality: form.modality,
      content: form.content || undefined, complaint: form.complaint || undefined,
      keyPoints: form.keyPoints || undefined, clinicalObservations: form.clinicalObservations || undefined,
      interventions: form.interventions || undefined, evolution: form.evolution || undefined,
      nextSteps: form.nextSteps || undefined, privateNotes: form.privateNotes || undefined,
      aiContent: form.aiContent || undefined,
    };
    if (form.patientId) data.patientId = form.patientId;
    if (form.coupleId) data.coupleId = form.coupleId;
    if (form.appointmentId) data.appointmentId = form.appointmentId;
    createMutation.mutate(data);
  };

  const handleOrganizeAi = async (recordId: string) => {
    setAiLoading("organize-" + recordId);
    try {
      const result = await recordsApi.organizeWithAi(recordId);
      queryClient.invalidateQueries({ queryKey: ["prontuarios"] });
      if (result.record) { setSelectedRecord(result.record); loadFormFromRecord(result.record); }
      toast.success("Prontuário organizado com IA!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao organizar com IA");
    } finally { setAiLoading(null); }
  };

  const handleClinicalSupport = async (recordId: string) => {
    setAiLoading("support-" + recordId);
    try {
      const result = await recordsApi.clinicalSupport(recordId);
      queryClient.invalidateQueries({ queryKey: ["prontuarios"] });
      toast.success("Apoio clínico gerado!");
      if (selectedRecord) setSelectedRecord({ ...selectedRecord, aiClinicalSupport: result.clinicalSupport });
    } catch (err: any) {
      toast.error(err.message || "Erro ao gerar apoio clínico");
    } finally { setAiLoading(null); }
  };

  const loadFormFromRecord = (r: RecordData) => {
    setForm({
      patientId: r.patientId || "", coupleId: r.coupleId || "", appointmentId: r.appointmentId || "",
      type: r.type as any, date: r.date?.split("T")[0] || "", modality: r.modality || "in_person",
      content: r.content || "", complaint: r.complaint || "", keyPoints: r.keyPoints || "",
      clinicalObservations: r.clinicalObservations || "", interventions: r.interventions || "",
      evolution: r.evolution || "", nextSteps: r.nextSteps || "", privateNotes: r.privateNotes || "",
      aiContent: r.aiContent || "",
    });
  };

  const handleSelectEntity = (type: "patient" | "couple", id: string, name: string) => {
    setSelectedEntity({ type, id, name });
    setDetailTab("overview");
  };

  const handleBack = () => {
    setSelectedEntity(null);
    setDetailTab("overview");
  };

  const patientAppointments = form.patientId
    ? appointments.filter((a) => a.patient_id === form.patientId)
    : appointments;

  // Filter appointments for the selected patient
  const selectedPatientApts = useMemo(() => {
    if (!selectedEntity || selectedEntity.type !== "patient") return { upcoming: [], past: [] };
    const now = new Date();
    const filtered = patientApts.filter((a: any) => a.patientId === selectedEntity.id || a.patient?.id === selectedEntity.id);
    const upcoming = filtered.filter((a: any) => new Date(a.date) >= new Date(now.toISOString().split("T")[0]) && a.status !== "cancelled");
    const past = filtered.filter((a: any) => new Date(a.date) < new Date(now.toISOString().split("T")[0]) || a.status === "cancelled" || a.status === "completed");
    return {
      upcoming: upcoming.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()),
      past: past.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    };
  }, [selectedEntity, patientApts]);

  // Update name if we came from URL param and now have patients loaded
  if (selectedEntity && !selectedEntity.name && patients.length > 0) {
    const found = patients.find((p: any) => p.id === selectedEntity.id);
    if (found) setSelectedEntity({ ...selectedEntity, name: found.name });
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {selectedEntity && (
            <Button variant="ghost" size="icon" onClick={handleBack} className="shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          )}
          <div>
            <h1 className="text-2xl md:text-3xl font-display font-bold text-foreground">
              {selectedEntity ? selectedEntity.name : "Prontuário Clínico"}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {selectedEntity
                ? `${selectedEntity.type === "couple" ? "Casal" : "Paciente"} — prontuários e evolução`
                : "Selecione um paciente ou casal para ver seus prontuários"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {selectedEntity?.type === "patient" && (
            <Button variant="outline" onClick={() => setEditAptDialog(true)}>
              <Plus className="w-4 h-4 mr-2" /> Lançar Sessão Passada
            </Button>
          )}
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-primary border-0 shadow-glow" onClick={() => {
                const newForm = { ...EMPTY_FORM };
                if (selectedEntity?.type === "patient") newForm.patientId = selectedEntity.id;
                if (selectedEntity?.type === "couple") { newForm.coupleId = selectedEntity.id; newForm.type = "couple"; }
                setForm(newForm);
              }}>
                <Plus className="w-4 h-4 mr-2" /> Novo Prontuário
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" /> Novo Prontuário
                </DialogTitle>
              </DialogHeader>
              <RecordForm
                form={form} setForm={setForm}
                patients={patients} appointments={patientAppointments}
                onSubmit={handleCreate} isLoading={createMutation.isPending}
                submitLabel="Criar Prontuário"
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {!selectedEntity ? (
          /* =================== PATIENT/COUPLE CARDS VIEW =================== */
          <motion.div key="cards" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Buscar paciente ou casal..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
              </div>
              <div className="flex gap-2">
                {(["all", "individual", "couple"] as TypeFilter[]).map((f) => (
                  <Button key={f} size="sm" variant={typeFilter === f ? "default" : "outline"}
                    onClick={() => setTypeFilter(f)}
                    className={typeFilter === f ? "gradient-primary border-0" : ""}
                  >
                    {f === "all" && <><Filter className="w-3.5 h-3.5 mr-1" /> Todos</>}
                    {f === "individual" && <><User className="w-3.5 h-3.5 mr-1" /> Individual</>}
                    {f === "couple" && <><Heart className="w-3.5 h-3.5 mr-1" /> Casal</>}
                  </Button>
                ))}
              </div>
            </div>

            {/* Dashboard summary row */}
            <div className="mb-6">
              <ClinicalDashboard 
                onSelectPatient={(id, name) => handleSelectEntity("patient", id, name)}
                onSelectCouple={(id, name) => handleSelectEntity("couple", id, name)}
              />
            </div>

            {/* Cards grid */}
            {filteredCards.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <Users className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="font-semibold text-foreground text-lg">Nenhum resultado encontrado</h3>
                  <p className="text-muted-foreground text-sm mt-1">Ajuste os filtros ou cadastre novos pacientes.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCards.map((card, i) => (
                  <motion.div key={`${card.type}-${card.id}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                    <Card
                      className="hover:shadow-lg transition-all cursor-pointer group border-border/60 hover:border-primary/40"
                      onClick={() => handleSelectEntity(card.type, card.id, card.name)}
                    >
                      <CardContent className="pt-5 pb-4">
                        <div className="flex items-start gap-3">
                          <div className={`p-2.5 rounded-xl ${card.type === "couple" ? "bg-pink-100 text-pink-600 dark:bg-pink-950 dark:text-pink-400" : "bg-primary/10 text-primary"}`}>
                            {card.type === "couple" ? <Heart className="w-5 h-5" /> : <User className="w-5 h-5" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">{card.name}</h3>
                            <Badge variant="outline" className="text-[10px] mt-1">
                              {card.type === "couple" ? "Casal" : "Individual"}
                            </Badge>
                          </div>
                          <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-1" />
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          /* =================== DETAIL VIEW (records, evolution, dashboard) =================== */
          <motion.div key="detail" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <Tabs value={detailTab} onValueChange={setDetailTab}>
              <TabsList className={`grid w-full max-w-5xl ${selectedEntity.type === "patient" ? "grid-cols-9" : "grid-cols-6"}`}>
                {selectedEntity.type === "patient" && (
                  <TabsTrigger value="overview" className="flex items-center gap-1.5">
                    <LayoutDashboard className="w-4 h-4" /> <span className="hidden sm:inline">Visão Geral</span>
                  </TabsTrigger>
                )}
                <TabsTrigger value="records" className="flex items-center gap-1.5">
                  <FileText className="w-4 h-4" /> <span className="hidden sm:inline">Sessões</span>
                </TabsTrigger>
                <TabsTrigger value="goals" className="flex items-center gap-1.5">
                  <Target className="w-4 h-4" /> <span className="hidden sm:inline">Objetivos</span>
                </TabsTrigger>
                <TabsTrigger value="agenda" className="flex items-center gap-1.5">
                  <CalendarDays className="w-4 h-4" /> <span className="hidden sm:inline">Agenda</span>
                </TabsTrigger>
                {selectedEntity.type === "patient" && (
                  <TabsTrigger value="tests" className="flex items-center gap-1.5">
                    <ClipboardList className="w-4 h-4" /> <span className="hidden sm:inline">Testes</span>
                  </TabsTrigger>
                )}
                {selectedEntity.type === "patient" && (
                  <TabsTrigger value="financial" className="flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4" /> <span className="hidden sm:inline">Financeiro</span>
                  </TabsTrigger>
                )}
                <TabsTrigger value="timeline" className="flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4" /> <span className="hidden sm:inline">Evolução</span>
                </TabsTrigger>
                {selectedEntity.type === "patient" && (
                  <TabsTrigger value="mood" className="flex items-center gap-1.5">
                    <Smile className="w-4 h-4" /> <span className="hidden sm:inline">Humor</span>
                  </TabsTrigger>
                )}
                <TabsTrigger value="dashboard" className="flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4" /> <span className="hidden sm:inline">Insights</span>
                </TabsTrigger>
              </TabsList>

              {/* Visão Geral - Hub Clínico 360º */}
              {selectedEntity.type === "patient" && (
                <TabsContent value="overview" className="mt-4">
                  <PremiumClinicalRecord
                    patientId={selectedEntity.id}
                    patientName={selectedEntity.name}
                  />
                </TabsContent>
              )}

              {/* Testes - gestão de testes psicológicos */}
              {selectedEntity.type === "patient" && (
                <TabsContent value="tests" className="mt-4">
                  <PatientTestsTab patientId={selectedEntity.id} patientName={selectedEntity.name} />
                </TabsContent>
              )}

              {/* Financeiro - cobrança e pagamentos */}
              {selectedEntity.type === "patient" && (
                <TabsContent value="financial" className="mt-4">
                  <PatientFinancial patientId={selectedEntity.id} patientName={selectedEntity.name} />
                </TabsContent>
              )}

              {/* Records tab */}
              <TabsContent value="records" className="space-y-4 mt-4">
                {recordsLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[1, 2, 3, 4].map((i) => <div key={i} className="h-44 rounded-xl bg-muted animate-pulse" />)}
                  </div>
                ) : records.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                      <FileText className="w-12 h-12 text-muted-foreground mb-4" />
                      <h3 className="font-display font-semibold text-foreground text-lg">Nenhum prontuário</h3>
                      <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                        Crie o primeiro prontuário para {selectedEntity.name}.
                      </p>
                      <Button className="mt-4 gradient-primary border-0" onClick={() => {
                        const newForm = { ...EMPTY_FORM };
                        if (selectedEntity.type === "patient") newForm.patientId = selectedEntity.id;
                        if (selectedEntity.type === "couple") { newForm.coupleId = selectedEntity.id; newForm.type = "couple"; }
                        setForm(newForm);
                        setIsCreateOpen(true);
                      }}>
                        <Plus className="w-4 h-4 mr-2" /> Criar Prontuário
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {records.map((record: RecordData, i: number) => (
                      <motion.div key={record.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                        <Card className="hover:shadow-lg transition-shadow group">
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-primary" />
                                <button
                                  onClick={() => {
                                    if (record.patientId && record.patient?.name) handleSelectEntity("patient", record.patientId, record.patient.name);
                                    else if (record.coupleId && record.couple?.name) handleSelectEntity("couple", record.coupleId, record.couple.name);
                                  }}
                                  className="text-base font-semibold hover:text-primary transition-colors hover:underline"
                                >
                                  {record.patient?.name || record.couple?.name || "—"}
                                </button>
                              </div>
                              <div className="flex items-center gap-1 flex-wrap">
                                {record.modality === "test" ? (
                                  <Badge className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 border-0">
                                    📋 Teste
                                  </Badge>
                                ) : (
                                  <Badge variant={record.type === "couple" ? "secondary" : "default"} className="text-xs">
                                    {record.type === "couple" ? "Casal" : "Individual"}
                                  </Badge>
                                )}
                                {record.modality && record.modality !== "test" && (
                                  <Badge variant="outline" className="text-xs">
                                    {record.modality === "video" || record.modality === "online" ? "Online" : "Presencial"}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <p className="text-xs text-muted-foreground mb-2">
                              <Clock className="w-3 h-3 inline mr-1" />
                              {format(new Date(record.date.includes('T') ? record.date : record.date + 'T12:00:00'), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                              {record.appointment && ` • ${record.appointment.time}`}
                            </p>
                            {record.complaint && (
                              <p className="text-sm font-medium text-foreground mb-1 line-clamp-1">📋 {record.complaint}</p>
                            )}
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {record.keyPoints || record.content || "Sem conteúdo"}
                            </p>
                            {record.themes && record.themes.length > 0 && (
                              <div className="flex gap-1 mt-2 flex-wrap">
                                {record.themes.slice(0, 4).map((t) => (
                                  <Badge key={t} variant="outline" className="text-[10px] py-0"><Tag className="w-2.5 h-2.5 mr-0.5" />{t}</Badge>
                                ))}
                              </div>
                            )}
                            {(record.aiContent || record.aiClinicalSupport) && (
                              <p className="text-xs text-primary mt-2 flex items-center gap-1">
                                <Sparkles className="w-3 h-3" /> Contém análise de IA
                              </p>
                            )}
                            <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button size="sm" variant="outline" className="text-xs" onClick={() => { setSelectedRecord(record); setIsViewOpen(true); }}>
                                <Eye className="w-3 h-3 mr-1" /> Ver
                              </Button>
                              <Button size="sm" variant="outline" className="text-xs" onClick={() => { setSelectedRecord(record); loadFormFromRecord(record); setIsEditOpen(true); }}>
                                <Edit className="w-3 h-3 mr-1" /> Editar
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Goals tab */}
              <TabsContent value="goals" className="mt-4">
                {selectedEntity.type === "patient" ? (
                  <PatientGoals patientId={selectedEntity.id} patientName={selectedEntity.name} />
                ) : (
                  <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                      <Target className="w-12 h-12 text-muted-foreground mb-4" />
                      <h3 className="font-semibold text-foreground">Objetivos disponíveis para pacientes individuais</h3>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Agenda tab */}
              <TabsContent value="agenda" className="space-y-6 mt-4">
                {selectedEntity.type !== "patient" ? (
                  <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                      <CalendarDays className="w-12 h-12 text-muted-foreground mb-4" />
                      <h3 className="font-semibold text-foreground">Agenda disponível para pacientes individuais</h3>
                    </CardContent>
                  </Card>
                ) : aptsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
                  </div>
                ) : (
                  <>
                    {/* Upcoming */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-primary" /> Próximas Consultas ({selectedPatientApts.upcoming.length})
                        </h3>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => navigate(`/agenda?patientId=${selectedEntity.id}`)}
                          className="gap-1.5 h-8"
                        >
                          <Plus className="w-3.5 h-3.5" /> Agendar Sessão
                        </Button>
                      </div>
                      {selectedPatientApts.upcoming.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhuma consulta agendada.</p>
                      ) : (
                        <div className="space-y-3">
                          {selectedPatientApts.upcoming.map((apt: any) => (
                            <AppointmentCard
                              key={apt.id}
                              apt={apt}
                              onEdit={() => { setEditingApt(apt); setEditAptDialog(true); }}
                              onCancel={() => cancelAptMutation.mutate(apt.id)}
                              onAttend={() => attendAptMutation.mutate(apt.id)}
                              onMiss={() => missAptMutation.mutate(apt.id)}
                              isCancelling={cancelAptMutation.isPending}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Past */}
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" /> Histórico ({selectedPatientApts.past.length})
                      </h3>
                      {selectedPatientApts.past.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhuma consulta anterior.</p>
                      ) : (
                        <div className="space-y-3">
                          {selectedPatientApts.past.map((apt: any) => (
                            <AppointmentCard
                              key={apt.id}
                              apt={apt}
                              onEdit={() => { setEditingApt(apt); setEditAptDialog(true); }}
                              onCancel={() => cancelAptMutation.mutate(apt.id)}
                              onAttend={() => attendAptMutation.mutate(apt.id)}
                              onMiss={() => missAptMutation.mutate(apt.id)}
                              isPast
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </TabsContent>

              {/* Timeline tab */}
              <TabsContent value="timeline" className="mt-4">
                {selectedEntity.type === "patient" ? (
                  <PatientTimeline 
                    patients={patients} 
                    selectedPatientId={selectedEntity.id} 
                    onSelectPatient={() => {}} 
                    appointments={patientApts}
                  />
                ) : (
                  <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                      <TrendingUp className="w-12 h-12 text-muted-foreground mb-4" />
                      <h3 className="font-semibold text-foreground">Evolução disponível para pacientes individuais</h3>
                      <p className="text-muted-foreground text-sm mt-1">Selecione um paciente individual para ver a linha do tempo.</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Mood tab - only for patients */}
              {selectedEntity.type === "patient" && (
                <TabsContent value="mood" className="mt-4">
                  <MoodDashboard patientId={selectedEntity.id} patientName={selectedEntity.name} showAiAnalysis />
                </TabsContent>
              )}

              {/* Dashboard tab */}
              <TabsContent value="dashboard" className="mt-4">
                {selectedEntity.type === "couple" ? (
                  <div className="space-y-6">
                    {/* Couple Info Card */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-1.5">
                          <Heart className="w-4 h-4 text-primary" /> Informações do Casal
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {(() => {
                          const couple = couples.find((c: any) => c.id === selectedEntity.id);
                          return couple ? (
                            <>
                              <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-pink-100 text-pink-600 dark:bg-pink-950 dark:text-pink-400">
                                  <Heart className="w-5 h-5" />
                                </div>
                                <div>
                                  <h3 className="font-semibold text-foreground text-lg">{couple.name || `${couple.patient1?.name} & ${couple.patient2?.name}`}</h3>
                                  <p className="text-sm text-muted-foreground">Terapia de Casal</p>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                                <Card className="border-border/60">
                                  <CardContent className="pt-4">
                                    <div className="flex items-center gap-2 mb-1">
                                      <User className="w-4 h-4 text-primary" />
                                      <span className="font-medium text-sm">Paciente 1</span>
                                    </div>
                                    <button
                                      onClick={() => couple.patient1?.id && handleSelectEntity("patient", couple.patient1.id, couple.patient1.name)}
                                      className="text-foreground font-semibold hover:text-primary transition-colors hover:underline text-left"
                                    >
                                      {couple.patient1?.name}
                                    </button>
                                    {couple.patient1?.email && <p className="text-xs text-muted-foreground">{couple.patient1.email}</p>}
                                    {couple.patient1?.phone && <p className="text-xs text-muted-foreground">{couple.patient1.phone}</p>}
                                  </CardContent>
                                </Card>
                                <Card className="border-border/60">
                                  <CardContent className="pt-4">
                                    <div className="flex items-center gap-2 mb-1">
                                      <User className="w-4 h-4 text-primary" />
                                      <span className="font-medium text-sm">Paciente 2</span>
                                    </div>
                                    <button
                                      onClick={() => couple.patient2?.id && handleSelectEntity("patient", couple.patient2.id, couple.patient2.name)}
                                      className="text-foreground font-semibold hover:text-primary transition-colors hover:underline text-left"
                                    >
                                      {couple.patient2?.name}
                                    </button>
                                    {couple.patient2?.email && <p className="text-xs text-muted-foreground">{couple.patient2.email}</p>}
                                    {couple.patient2?.phone && <p className="text-xs text-muted-foreground">{couple.patient2.phone}</p>}
                                  </CardContent>
                                </Card>
                              </div>
                            </>
                          ) : <p className="text-sm text-muted-foreground">Informações do casal não encontradas.</p>;
                        })()}
                      </CardContent>
                    </Card>

                    {/* Couple Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <Card>
                        <CardContent className="pt-4 flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10 text-primary">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-foreground">{records.length}</p>
                            <p className="text-xs text-muted-foreground">Prontuários</p>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4 flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10 text-primary">
                            <CalendarDays className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-foreground">
                              {records.length > 0 ? format(new Date(records[0]?.date), "dd/MM/yy", { locale: ptBR }) : "—"}
                            </p>
                            <p className="text-xs text-muted-foreground">Última Sessão</p>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4 flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10 text-primary">
                            <Clock className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-foreground">
                              {records.length > 0 ? format(new Date(records[records.length - 1]?.date), "dd/MM/yy", { locale: ptBR }) : "—"}
                            </p>
                            <p className="text-xs text-muted-foreground">Primeira Sessão</p>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Ethical reminder */}
                    <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
                      <CardContent className="py-3 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          A IA organiza e sugere — nunca gera diagnósticos. O psicólogo revisa e valida todas as informações.
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                ) : (
                  <PatientInsights
                    patientId={selectedEntity.id}
                    patientName={selectedEntity.name}
                    onScheduleSession={() => navigate(`/agenda?patientId=${selectedEntity.id}`)}
                    onSendTest={() => navigate(`/testes?patientId=${selectedEntity.id}`)}
                  />
                )}
              </TabsContent>
            </Tabs>

            {/* Edit Appointment Dialog */}
            <Dialog open={editAptDialog} onOpenChange={setEditAptDialog}>
              <DialogContent className="max-w-md" aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Edit className="w-5 h-5 text-primary" /> Editar Consulta
                  </DialogTitle>
                </DialogHeader>
                {editingApt && (
                  <div className="space-y-4 mt-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Data</Label>
                        <Input type="date" value={editingApt.date?.split("T")[0] || ""} onChange={e => setEditingApt({ ...editingApt, date: e.target.value })} />
                      </div>
                      <div>
                        <Label>Horário</Label>
                        <Input type="time" value={editingApt.time || ""} onChange={e => setEditingApt({ ...editingApt, time: e.target.value })} />
                      </div>
                    </div>
                    <div>
                      <Label>Status</Label>
                      <Select value={editingApt.status || "scheduled"} onValueChange={v => setEditingApt({ ...editingApt, status: v as any })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="scheduled">Agendada</SelectItem>
                          <SelectItem value="completed">Realizada</SelectItem>
                          <SelectItem value="cancelled">Cancelada</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Modalidade</Label>
                      <Select value={editingApt.mode || "in_person"} onValueChange={v => setEditingApt({ ...editingApt, mode: v as any })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="in_person">Presencial</SelectItem>
                          <SelectItem value="video">Online</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Observações</Label>
                      <Textarea value={editingApt.notes || ""} onChange={e => setEditingApt({ ...editingApt, notes: e.target.value })} rows={2} />
                    </div>
                    <Button className="w-full gradient-primary border-0" onClick={() => {
                      if (!editingApt.id) return;
                      updateAptMutation.mutate({
                        id: editingApt.id,
                        data: { date: editingApt.date, time: editingApt.time, status: editingApt.status, mode: editingApt.mode, notes: editingApt.notes },
                      });
                    }} disabled={updateAptMutation.isPending}>
                      {updateAptMutation.isPending ? "Salvando..." : "Salvar Alterações"}
                    </Button>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </motion.div>
        )}
      </AnimatePresence>

      {/* View Dialog */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Prontuário — {selectedRecord?.patient?.name || selectedRecord?.couple?.name}
            </DialogTitle>
          </DialogHeader>
          {selectedRecord && (
            <div className="space-y-4 mt-4">
              <div className="flex gap-2 flex-wrap">
                <Badge>{selectedRecord.type === "couple" ? "Casal" : "Individual"}</Badge>
                <Badge variant="outline">{format(new Date(selectedRecord.date), "dd/MM/yyyy", { locale: ptBR })}</Badge>
                {selectedRecord.modality && (
                  <Badge variant="outline">{selectedRecord.modality === "video" || selectedRecord.modality === "online" ? "Online" : "Presencial"}</Badge>
                )}
                {selectedRecord.appointment ? (
                  <Badge variant="outline"><Calendar className="w-3 h-3 mr-1" /> {selectedRecord.appointment.time}</Badge>
                ) : (
                  <Badge variant="outline">Registro avulso</Badge>
                )}
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" className="text-primary border-primary/30"
                  onClick={() => handleOrganizeAi(selectedRecord.id)} disabled={!!aiLoading}>
                  <Sparkles className="w-4 h-4 mr-1" />
                  {aiLoading === "organize-" + selectedRecord.id ? "Organizando..." : "Organizar com IA"}
                </Button>
                <Button size="sm" variant="outline" className="text-primary border-primary/30"
                  onClick={() => handleClinicalSupport(selectedRecord.id)} disabled={!!aiLoading}>
                  <Brain className="w-4 h-4 mr-1" />
                  {aiLoading === "support-" + selectedRecord.id ? "Gerando..." : "Gerar Apoio Clínico"}
                </Button>
              </div>

              {selectedRecord.complaint && <RecordSection label="Motivo / Demanda" content={selectedRecord.complaint} />}
              {selectedRecord.keyPoints && <RecordSection label="Principais Pontos da Sessão" content={selectedRecord.keyPoints} />}
              {selectedRecord.clinicalObservations && <RecordSection label="Observações Clínicas" content={selectedRecord.clinicalObservations} />}
              {selectedRecord.interventions && <RecordSection label="Intervenções Realizadas" content={selectedRecord.interventions} />}
              {selectedRecord.evolution && <RecordSection label="Evolução" content={selectedRecord.evolution} icon={<TrendingUp className="w-4 h-4" />} />}
              {selectedRecord.nextSteps && <RecordSection label="Próximos Passos" content={selectedRecord.nextSteps} icon={<ChevronRight className="w-4 h-4" />} />}
              {selectedRecord.content && !selectedRecord.complaint && <RecordSection label="Conteúdo" content={selectedRecord.content} />}
              {selectedRecord.content && selectedRecord.complaint && <RecordSection label="Anotações gerais" content={selectedRecord.content} />}

              {selectedRecord.themes && selectedRecord.themes.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1"><Tag className="w-3 h-3" /> Temas</Label>
                  <div className="flex gap-1.5 flex-wrap mt-1">
                    {selectedRecord.themes.map((t) => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}
                  </div>
                </div>
              )}

              {selectedRecord.aiContent && (
                <div>
                  <Label className="text-xs text-primary flex items-center gap-1"><Sparkles className="w-3 h-3" /> Resumo IA</Label>
                  {(() => {
                    try {
                      JSON.parse(selectedRecord.aiContent);
                      return <div className="mt-2"><StructuredSessionContent data={selectedRecord.aiContent} /></div>;
                    } catch {
                      return <div className="bg-primary/5 border border-primary/10 rounded-lg p-4 mt-1 text-sm whitespace-pre-wrap">{selectedRecord.aiContent}</div>;
                    }
                  })()}
                </div>
              )}

              {selectedRecord.aiClinicalSupport && (
                <div>
                  <Label className="text-xs text-primary flex items-center gap-1"><Brain className="w-3 h-3" /> Apoio Clínico IA</Label>
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mt-1 text-sm whitespace-pre-wrap">
                    <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mb-2">
                      <AlertTriangle className="w-3 h-3" /> Sugestão de apoio — não substitui avaliação profissional
                    </div>
                    {selectedRecord.aiClinicalSupport}
                  </div>
                </div>
              )}

              {selectedRecord.privateNotes && (
                <div>
                  <Label className="text-xs text-destructive">🔒 Observações Privadas</Label>
                  <div className="bg-destructive/5 border border-destructive/10 rounded-lg p-4 mt-1 text-sm whitespace-pre-wrap">{selectedRecord.privateNotes}</div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => { loadFormFromRecord(selectedRecord); setIsViewOpen(false); setIsEditOpen(true); }}>
                  <Edit className="w-4 h-4 mr-1" /> Editar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Editar Prontuário</DialogTitle>
          </DialogHeader>
          <RecordForm
            form={form} setForm={setForm}
            patients={patients} appointments={patientAppointments}
            onSubmit={() => {
              if (!selectedRecord) return;
              updateMutation.mutate({
                id: selectedRecord.id,
                data: {
                  content: form.content || undefined, complaint: form.complaint || undefined,
                  keyPoints: form.keyPoints || undefined, clinicalObservations: form.clinicalObservations || undefined,
                  interventions: form.interventions || undefined, evolution: form.evolution || undefined,
                  nextSteps: form.nextSteps || undefined, privateNotes: form.privateNotes || undefined,
                  aiContent: form.aiContent || undefined, modality: form.modality,
                },
              });
            }}
            isLoading={updateMutation.isPending}
            submitLabel="Salvar Alterações"
            isEdit
          />
        </DialogContent>
      </Dialog>

      <Dialog open={editAptDialog} onOpenChange={setEditAptDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingApt?.id ? "Editar Sessão" : "Lançar Sessão Passada"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Data</Label>
                <Input 
                  type="date" 
                  value={editingApt?.date ? (typeof editingApt.date === 'string' ? editingApt.date.split("T")[0] : format(editingApt.date, "yyyy-MM-dd")) : ""} 
                  onChange={e => setEditingApt(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Horário</Label>
                <Input 
                  type="time" 
                  value={editingApt?.time || "08:00"} 
                  onChange={e => setEditingApt(prev => ({ ...prev, time: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Valor</Label>
                <Input 
                  type="number" 
                  value={editingApt?.value || 0} 
                  onChange={e => setEditingApt(prev => ({ ...prev, value: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editingApt?.status} onValueChange={v => setEditingApt(prev => ({ ...prev, status: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scheduled">Agendada</SelectItem>
                    <SelectItem value="completed">Realizada</SelectItem>
                    <SelectItem value="cancelled">Cancelada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea 
                value={editingApt?.notes || ""} 
                onChange={e => setEditingApt(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Ex: Primeira consulta, paciente importado..."
              />
            </div>
            {editingApt?.id && (
              <div className="flex items-center gap-2 pt-2">
                <Checkbox 
                  id="attended" 
                  checked={editingApt.attended} 
                  onCheckedChange={checked => setEditingApt(prev => ({ ...prev, attended: !!checked }))} 
                />
                <Label htmlFor="attended" className="cursor-pointer">Paciente compareceu</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditAptDialog(false); setEditingApt(null); }}>Cancelar</Button>
            <Button 
              className="gradient-primary border-0" 
              onClick={() => {
                if (editingApt?.id) {
                  updateAptMutation.mutate({ id: editingApt.id, data: editingApt });
                } else {
                  // New past appointment
                  const payload = { 
                    ...editingApt, 
                    patient_id: selectedEntity?.id,
                    type: "individual",
                    status: "completed", // Default for past
                    attended: true
                  };
                  createMutationApt.mutate(payload as any);
                }
              }}
              disabled={updateAptMutation.isPending || createMutationApt.isPending}
            >
              {editingApt?.id ? "Salvar Alterações" : "Lançar Sessão"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RecordSection({ label, content, icon }: { label: string; content: string; icon?: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</Label>
      <div className="bg-muted/50 rounded-lg p-3 mt-1 text-sm whitespace-pre-wrap">{content}</div>
    </div>
  );
}

function RecordForm({
  form, setForm, patients, appointments, onSubmit, isLoading, submitLabel, isEdit
}: {
  form: typeof EMPTY_FORM;
  setForm: (f: typeof EMPTY_FORM) => void;
  patients: any[];
  appointments: any[];
  onSubmit: () => void;
  isLoading: boolean;
  submitLabel: string;
  isEdit?: boolean;
}) {
  return (
    <div className="space-y-4 mt-4">
      {!isEdit && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label>Tipo</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="couple">Casal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Data</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <Label>Modalidade</Label>
              <Select value={form.modality} onValueChange={(v) => setForm({ ...form, modality: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_person">Presencial</SelectItem>
                  <SelectItem value="video">Online</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Paciente</Label>
            <Select value={form.patientId} onValueChange={(v) => setForm({ ...form, patientId: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione um paciente" /></SelectTrigger>
              <SelectContent>
                {patients.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Consulta vinculada <span className="text-muted-foreground text-xs">(opcional)</span></Label>
            <Select value={form.appointmentId || "_none"} onValueChange={(v) => setForm({ ...form, appointmentId: v === "_none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Nenhuma — registro avulso</SelectItem>
                {appointments.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {format(new Date(a.date), "dd/MM/yyyy", { locale: ptBR })} às {a.time}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      <div>
        <Label className="flex items-center gap-1">📋 Motivo / Demanda <span className="text-muted-foreground text-xs">(queixa principal)</span></Label>
        <Textarea value={form.complaint} onChange={(e) => setForm({ ...form, complaint: e.target.value })}
          placeholder="Qual a queixa ou demanda principal desta sessão?" rows={2} />
      </div>
      <div>
        <Label>📝 Principais pontos da sessão</Label>
        <Textarea value={form.keyPoints} onChange={(e) => setForm({ ...form, keyPoints: e.target.value })}
          placeholder="Resumo dos temas abordados..." rows={3} />
      </div>
      <div>
        <Label>👁️ Observações clínicas</Label>
        <Textarea value={form.clinicalObservations} onChange={(e) => setForm({ ...form, clinicalObservations: e.target.value })}
          placeholder="Percepções durante o atendimento..." rows={2} />
      </div>
      <div>
        <Label>🛠️ Intervenções realizadas</Label>
        <Textarea value={form.interventions} onChange={(e) => setForm({ ...form, interventions: e.target.value })}
          placeholder="Técnicas, abordagens ou direcionamentos..." rows={2} />
      </div>
      <div>
        <Label className="flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" /> Evolução</Label>
        <Textarea value={form.evolution} onChange={(e) => setForm({ ...form, evolution: e.target.value })}
          placeholder="Comparação com sessões anteriores..." rows={2} />
      </div>
      <div>
        <Label className="flex items-center gap-1"><ChevronRight className="w-3.5 h-3.5" /> Próximos passos</Label>
        <Textarea value={form.nextSteps} onChange={(e) => setForm({ ...form, nextSteps: e.target.value })}
          placeholder="Encaminhamentos e foco para continuidade..." rows={2} />
      </div>
      <div>
        <Label>🔒 Observações privadas <span className="text-muted-foreground text-xs">(não aparece em relatórios)</span></Label>
        <Textarea value={form.privateNotes} onChange={(e) => setForm({ ...form, privateNotes: e.target.value })}
          placeholder="Anotações exclusivas do profissional..." rows={2} className="border-destructive/20" />
      </div>
      <div>
        <Label>Anotações livres <span className="text-muted-foreground text-xs">(opcional)</span></Label>
        <Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
          placeholder="Texto livre, transcrição, observações gerais..." rows={4} />
      </div>

      <Button onClick={onSubmit} disabled={isLoading} className="w-full gradient-primary border-0">
        {isLoading ? "Salvando..." : submitLabel}
      </Button>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  blocked: "bg-muted text-muted-foreground",
};
const STATUS_LABELS: Record<string, string> = {
  scheduled: "Agendada", completed: "Realizada", cancelled: "Cancelada", blocked: "Bloqueado",
};

function AppointmentCard({ apt, onEdit, onCancel, onAttend, onMiss, isPast, isCancelling }: {
  apt: any;
  onEdit: () => void;
  onCancel: () => void;
  onAttend?: () => void;
  onMiss?: () => void;
  isPast?: boolean;
  isCancelling?: boolean;
}) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="py-4 px-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex flex-col items-center text-center bg-muted rounded-lg px-3 py-2 min-w-[60px]">
              <span className="text-lg font-bold text-foreground leading-none">
                {format(new Date(apt.date.includes('T') ? apt.date : apt.date + 'T12:00:00'), "dd")}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase">
                {format(new Date(apt.date.includes('T') ? apt.date : apt.date + 'T12:00:00'), "MMM yyyy", { locale: ptBR })}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {apt.time} • {apt.duration || 50}min
              </p>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <Badge className={`text-[10px] ${STATUS_COLORS[apt.status] || ""}`}>
                  {STATUS_LABELS[apt.status] || apt.status}
                </Badge>
                {apt.mode && (
                  <Badge variant="outline" className="text-[10px]">
                    {apt.mode === "video" || apt.mode === "online" ? "Online" : "Presencial"}
                  </Badge>
                )}
                {apt.attended && <Badge variant="outline" className="text-[10px] border-green-300 text-green-600">✓ Compareceu</Badge>}
              </div>
              {apt.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{apt.notes}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {apt.status === "scheduled" && (
              <div className="flex items-center gap-1">
                {onAttend && (
                  <Button size="sm" variant="outline" className="text-[10px] h-7 px-2 text-green-600 border-green-200 hover:bg-green-50" onClick={onAttend}>
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Compareceu
                  </Button>
                )}
                {onMiss && (
                  <Button size="sm" variant="outline" className="text-[10px] h-7 px-2 text-destructive border-destructive/20 hover:bg-destructive/5" onClick={onMiss}>
                    <AlertTriangle className="w-3 h-3 mr-1" /> Faltou
                  </Button>
                )}
              </div>
            )}
            <Button size="sm" variant="ghost" className="text-xs" onClick={onEdit}>
              <Edit className="w-3.5 h-3.5" />
            </Button>
            {apt.status !== "cancelled" && (
              <Button size="sm" variant="ghost" className="text-xs text-destructive hover:text-destructive" onClick={onCancel} disabled={isCancelling}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
