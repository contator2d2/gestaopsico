import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Plus, ChevronLeft, ChevronRight, Clock, Video, MapPin, Loader2, Check,
  UserCheck, Heart, Ban, Filter, Users, CalendarIcon, Repeat, Briefcase,
  Plane, Stethoscope, GraduationCap, Home, Coffee, LayoutGrid, List, CalendarDays
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useAppointments } from "@/hooks/useAppointments";
import {
  format, addDays, addWeeks, addMonths, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, isToday, parse
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { consultasApi, casaisApi, apiRequest, type Consulta, type Casal } from "@/lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, getLocalDateString, parseLocalDate } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import PatientSearchSelect from "@/components/PatientSearchSelect";
import { orgSettingsApi } from "@/lib/portalApi";
import { useNavigate } from "react-router-dom";

type ViewMode = "day" | "week" | "month" | "pipeline";

const statusColors: Record<string, string> = {
  scheduled: "bg-green-500",
  confirmed: "bg-green-500",
  completed: "bg-primary",
  pending: "bg-yellow-500",
  pending_approval: "bg-orange-500",
  cancelled: "bg-destructive",
  blocked: "bg-muted-foreground",
  missed: "bg-destructive",
  attended: "bg-success",
};

const statusBgColors: Record<string, string> = {
  scheduled: "border-l-green-500 bg-green-500/5",
  confirmed: "border-l-green-500 bg-green-500/5",
  completed: "border-l-primary bg-primary/5",
  pending: "border-l-yellow-500 bg-yellow-500/5",
  pending_approval: "border-l-orange-500 bg-orange-500/5",
  cancelled: "border-l-destructive bg-destructive/5",
  blocked: "border-l-muted-foreground bg-muted/30",
  missed: "border-l-destructive bg-destructive/5",
  attended: "border-l-success bg-success/5",
};

const statusLabels: Record<string, string> = {
  scheduled: "Agendada",
  confirmed: "Confirmada",
  completed: "Concluída",
  pending: "Pendente",
  pending_approval: "Aguardando Aprovação",
  cancelled: "Cancelada",
  blocked: "Bloqueado",
  missed: "Faltou",
  attended: "Compareceu",
};

const emptyConsulta: Partial<Consulta> = {
  patient_id: "", type: "individual", date: "", time: "",
  duration: 50, value: 0, status: "scheduled",
  payment_status: "pending", mode: "in_person", notes: "",
};

const ALL_HOURS = Array.from({ length: 17 }, (_, i) => i + 6);

const PROFESSIONAL_COLORS = [
  { bg: "bg-blue-500/10", border: "border-l-blue-500", text: "text-blue-700", dot: "bg-blue-500" },
  { bg: "bg-emerald-500/10", border: "border-l-emerald-500", text: "text-emerald-700", dot: "bg-emerald-500" },
  { bg: "bg-violet-500/10", border: "border-l-violet-500", text: "text-violet-700", dot: "bg-violet-500" },
  { bg: "bg-amber-500/10", border: "border-l-amber-500", text: "text-amber-700", dot: "bg-amber-500" },
  { bg: "bg-rose-500/10", border: "border-l-rose-500", text: "text-rose-700", dot: "bg-rose-500" },
  { bg: "bg-cyan-500/10", border: "border-l-cyan-500", text: "text-cyan-700", dot: "bg-cyan-500" },
  { bg: "bg-orange-500/10", border: "border-l-orange-500", text: "text-orange-700", dot: "bg-orange-500" },
  { bg: "bg-indigo-500/10", border: "border-l-indigo-500", text: "text-indigo-700", dot: "bg-indigo-500" },
];

function getProfessionalColor(professionalId: string, profMap: Map<string, number>) {
  if (!profMap.has(professionalId)) {
    profMap.set(professionalId, profMap.size);
  }
  return PROFESSIONAL_COLORS[profMap.get(professionalId)! % PROFESSIONAL_COLORS.length];
}

function getDateKey(value?: string | Date | null) {
  if (!value) return "";
  
  if (typeof value === "string") {
    // Extract YYYY-MM-DD from any string that starts with it (ISO or simple date)
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    
    // Try to parse as date and then get local string
    try {
      const d = new Date(value);
      if (!isNaN(d.getTime())) return getLocalDateString(d);
    } catch {
      return "";
    }
  }

  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";

  return getLocalDateString(d);
}


function getAppointmentDisplayName(apt: any) {
  if (apt.type === "blocked") return apt.notes || "Bloqueado";
  if (apt.type === "couple") return apt.couple?.name || "Casal";
  return apt.patient?.name || "Paciente";
}

type PipelineFilter = "today" | "week" | "month" | "custom";

export default function Agenda() {
  const routerNavigate = useNavigate();
  const [searchParams] = useSearchParams();
  const patientIdParam = searchParams.get("patientId");
  
  const { user } = useAuth();
  const role = user?.role || "professional";
  const isSecretary = role === "secretary";
  const isAdmin = role === "admin" || role === "superadmin";
  const canCreateForOthers = isSecretary || isAdmin;

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [form, setForm] = useState<Partial<Consulta>>({ ...emptyConsulta });
  const [selectedProfessional, setSelectedProfessional] = useState("");

  useEffect(() => {
    if (patientIdParam) {
      setForm(prev => ({ ...prev, patient_id: patientIdParam, date: getLocalDateString(), time: "08:00" }));
      setDialogOpen(true);
    }
  }, [patientIdParam]);
  const [blockReason, setBlockReason] = useState("");
  const [blockTime, setBlockTime] = useState("");
  const [blockEndTime, setBlockEndTime] = useState("");
  const [blockDuration, setBlockDuration] = useState(60);
  const [blockCategory, setBlockCategory] = useState("personal");
  const [blockMode, setBlockMode] = useState<"single" | "period" | "recurring">("single");
  const [blockStartDate, setBlockStartDate] = useState<Date | undefined>(undefined);
  const [blockEndDate, setBlockEndDate] = useState<Date | undefined>(undefined);
  const [blockRecurrence, setBlockRecurrence] = useState<"daily" | "weekly" | "monthly">("daily");
  const [blockWeekdays, setBlockWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>("today");
  const [pipelineCustomStart, setPipelineCustomStart] = useState<Date | undefined>(undefined);
  const [pipelineCustomEnd, setPipelineCustomEnd] = useState<Date | undefined>(undefined);
  const [viewApt, setViewApt] = useState<any>(null);
  const [editApt, setEditApt] = useState<Partial<Consulta> | null>(null);
  const [editMode, setEditMode] = useState(false);

  const dateStr = getLocalDateString(selectedDate);

  const dateRange = useMemo(() => {
    if (viewMode === "pipeline") {
      const today = new Date();
      if (pipelineFilter === "today") {
        const d = format(today, "yyyy-MM-dd");
        return { startDate: d, endDate: d };
      } else if (pipelineFilter === "week") {
        return { startDate: format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"), endDate: format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd") };
      } else if (pipelineFilter === "month") {
        return { startDate: format(startOfMonth(today), "yyyy-MM-dd"), endDate: format(endOfMonth(today), "yyyy-MM-dd") };
      } else if (pipelineFilter === "custom" && pipelineCustomStart && pipelineCustomEnd) {
        return { startDate: format(pipelineCustomStart, "yyyy-MM-dd"), endDate: format(pipelineCustomEnd, "yyyy-MM-dd") };
      }
      const d = format(today, "yyyy-MM-dd");
      return { startDate: d, endDate: d };
    } else if (viewMode === "day") {
      return { startDate: dateStr, endDate: dateStr };
    } else if (viewMode === "week") {
      const start = startOfWeek(selectedDate, { weekStartsOn: 1 });
      const end = endOfWeek(selectedDate, { weekStartsOn: 1 });
      return { startDate: format(start, "yyyy-MM-dd"), endDate: format(end, "yyyy-MM-dd") };
    } else {
      const start = startOfMonth(selectedDate);
      const end = endOfMonth(selectedDate);
      return { startDate: format(start, "yyyy-MM-dd"), endDate: format(end, "yyyy-MM-dd") };
    }
  }, [selectedDate, viewMode, dateStr, pipelineFilter, pipelineCustomStart, pipelineCustomEnd]);

  const { data: professionals = [] } = useQuery<any[]>({
    queryKey: ["professionals"],
    queryFn: () => apiRequest<any[]>("/settings/professionals"),
    enabled: canCreateForOthers,
  });

  const { data: orgSettings } = useQuery({
    queryKey: ["org-settings"],
    queryFn: () => orgSettingsApi.get(),
  });

  const businessStartHour = orgSettings?.scheduleStartHour ?? 8;
  const businessEndHour = orgSettings?.scheduleEndHour ?? 19;

  const businessHours = useMemo(() => {
    return Array.from({ length: businessEndHour - businessStartHour + 1 }, (_, i) => i + businessStartHour);
  }, [businessStartHour, businessEndHour]);

  const queryParams: Record<string, string> = { ...dateRange };
  if (canCreateForOthers && selectedProfessional && selectedProfessional !== "all") {
    queryParams.professional_id = selectedProfessional;
  }
  const { data: appointments = [], isLoading } = useAppointments(queryParams);

  const professionalColorMap = useMemo(() => {
    const map = new Map<string, number>();
    if (Array.isArray(professionals)) {
      professionals.forEach((p: any, i: number) => map.set(p.id, i));
    }
    appointments.forEach((apt: any) => {
      if (apt.professionalId && !map.has(apt.professionalId)) {
        map.set(apt.professionalId, map.size);
      }
    });
    return map;
  }, [professionals, appointments]);

  const { data: couples = [] } = useQuery<Casal[]>({
    queryKey: ["couples"],
    queryFn: () => casaisApi.list(),
  });
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data: Partial<Consulta>) => consultasApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast({ title: "Consulta agendada com sucesso!" });
      setDialogOpen(false);
      setForm({ ...emptyConsulta });
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const attendMutation = useMutation({
    mutationFn: (id: string) => consultasApi.attend(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast({ title: "Comparecimento registrado e conta a receber gerada!" });
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });
  
  const missMutation = useMutation({
    mutationFn: (id: string) => consultasApi.miss(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast({ title: "Falta registrada e conta a receber gerada!" });
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const blockMutation = useMutation({
    mutationFn: (data: any) => consultasApi.create({ ...data, type: "blocked", status: "blocked" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast({ title: "Horário bloqueado!" });
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Consulta> }) => consultasApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast({ title: "Consulta atualizada!" });
      setViewApt(null);
      setEditMode(false);
      setEditApt(null);
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => consultasApi.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast({ title: "Consulta cancelada!" });
      setViewApt(null);
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => consultasApi.approve(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast({ title: "Consulta aprovada!" });
      setViewApt(null);
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => consultasApi.reject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast({ title: "Consulta rejeitada!" });
      setViewApt(null);
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const openViewDialog = (apt: any) => {
    setViewApt(apt);
    setEditMode(false);
    setEditApt(null);
  };

  const startEditing = () => {
    if (!viewApt) return;
    const dateVal = viewApt.date ? getDateKey(viewApt.date) : "";
    setEditApt({
      patient_id: viewApt.patientId || viewApt.patient_id || "",
      type: viewApt.type || "individual",
      date: dateVal,
      time: viewApt.time || "",
      duration: viewApt.duration || 50,
      value: viewApt.value || 0,
      mode: viewApt.mode || "in_person",
      notes: viewApt.notes || "",
      status: viewApt.status || "scheduled",
    });
    setEditMode(true);
  };

  const handleEditSave = () => {
    if (!viewApt || !editApt) return;
    updateMutation.mutate({ id: viewApt.id, data: editApt });
  };

  const navigate = (dir: number) => {
    if (viewMode === "day") setSelectedDate(prev => addDays(prev, dir));
    else if (viewMode === "week") setSelectedDate(prev => addWeeks(prev, dir));
    else setSelectedDate(prev => addMonths(prev, dir));
  };

  const set = (field: string, value: string | number) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const openScheduleDialog = (date: Date, time?: string) => {
    const defaultTime = time || `${String(businessStartHour).padStart(2, "0")}:00`;
    setSelectedDate(date);
    setForm({
      ...emptyConsulta,
      date: getLocalDateString(date),
      time: defaultTime,
      duration: 50,
      value: 0,
      mode: "in_person",
      type: "individual",
    });
    if (selectedProfessional === "all") {
      setSelectedProfessional("");
    }
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (canCreateForOthers && (!selectedProfessional || selectedProfessional === "all")) {
      toast({ title: "Selecione o profissional", variant: "destructive" });
      return;
    }

    if (form.type === "couple") {
      if (!(form as any).couple_id || !form.date || !form.time) {
        toast({ title: "Preencha casal, data e horário", variant: "destructive" });
        return;
      }
    } else {
      if (!form.patient_id || !form.date || !form.time) {
        toast({ title: "Preencha paciente, data e horário", variant: "destructive" });
        return;
      }
    }

    const payload = { ...form };
    if (canCreateForOthers && selectedProfessional && selectedProfessional !== "all") {
      (payload as any).professional_id = selectedProfessional;
    }
    createMutation.mutate(payload);
  };

  const blockCategories = [
    { value: "personal", label: "Compromisso pessoal", icon: Coffee },
    { value: "vacation", label: "Férias", icon: Plane },
    { value: "congress", label: "Congresso / Evento", icon: GraduationCap },
    { value: "family", label: "Familiar", icon: Home },
    { value: "health", label: "Saúde / Doença", icon: Stethoscope },
    { value: "work", label: "Reunião / Trabalho", icon: Briefcase },
  ];

  const handleBlock = () => {
    if (!blockTime) {
      toast({ title: "Selecione o horário inicial", variant: "destructive" });
      return;
    }
    const catLabel = blockCategories.find(c => c.value === blockCategory)?.label || blockCategory;
    const note = blockReason ? `[${catLabel}] ${blockReason}` : catLabel;
    const baseData: any = { time: blockTime, duration: blockDuration, notes: note };
    if (canCreateForOthers && selectedProfessional && selectedProfessional !== "all") baseData.professional_id = selectedProfessional;

    if (blockMode === "single") {
      blockMutation.mutate({ ...baseData, date: dateStr });
    } else if (blockMode === "period") {
      if (!blockStartDate || !blockEndDate) { toast({ title: "Selecione data inicial e final", variant: "destructive" }); return; }
      eachDayOfInterval({ start: blockStartDate, end: blockEndDate }).forEach(day => {
        blockMutation.mutate({ ...baseData, date: format(day, "yyyy-MM-dd") });
      });
    } else if (blockMode === "recurring") {
      if (!blockStartDate || !blockEndDate) { toast({ title: "Selecione o período de recorrência", variant: "destructive" }); return; }
      const days = eachDayOfInterval({ start: blockStartDate, end: blockEndDate });
      const filtered = days.filter(day => {
        if (blockRecurrence === "daily") return true;
        if (blockRecurrence === "weekly") return blockWeekdays.includes(day.getDay());
        if (blockRecurrence === "monthly") return day.getDate() === blockStartDate.getDate();
        return true;
      });
      filtered.forEach(day => { blockMutation.mutate({ ...baseData, date: format(day, "yyyy-MM-dd") }); });
    }
  };

  const resetBlock = () => {
    setBlockOpen(false);
    setBlockReason("");
    setBlockTime("");
    setBlockEndTime("");
    setBlockCategory("personal");
    setBlockMode("single");
    setBlockStartDate(undefined);
    setBlockEndDate(undefined);
  };

  const aptsByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    appointments.forEach((apt: any) => {
      const d = getDateKey(apt.date);
      if (!map[d]) map[d] = [];
      map[d].push(apt);
    });
    return map;
  }, [appointments]);

  const getAptsForDate = (d: Date) => aptsByDate[format(d, "yyyy-MM-dd")] || [];

  const professionalsById = useMemo(() => {
    return new Map((Array.isArray(professionals) ? professionals : []).map((professional: any) => [professional.id, professional]));
  }, [professionals]);

  const pipelineAppointments = useMemo(() => {
    return appointments
      .filter((apt: any) => apt.type !== "blocked")
      .sort((a: any, b: any) => String(a.time || "").localeCompare(String(b.time || "")));
  }, [appointments]);

  const headerTitle = useMemo(() => {
    if (viewMode === "day") return format(selectedDate, "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR });
    if (viewMode === "pipeline") {
      if (pipelineFilter === "today") return "Hoje — " + format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
      if (pipelineFilter === "week") {
        const s = startOfWeek(new Date(), { weekStartsOn: 1 });
        const e = endOfWeek(new Date(), { weekStartsOn: 1 });
        return `${format(s, "dd MMM", { locale: ptBR })} — ${format(e, "dd MMM yyyy", { locale: ptBR })}`;
      }
      if (pipelineFilter === "month") return format(new Date(), "MMMM 'de' yyyy", { locale: ptBR });
      if (pipelineFilter === "custom" && pipelineCustomStart && pipelineCustomEnd) {
        return `${format(pipelineCustomStart, "dd/MM/yyyy")} — ${format(pipelineCustomEnd, "dd/MM/yyyy")}`;
      }
      return "Pipeline";
    }
    if (viewMode === "week") {
      const start = startOfWeek(selectedDate, { weekStartsOn: 1 });
      const end = endOfWeek(selectedDate, { weekStartsOn: 1 });
      return `${format(start, "dd MMM", { locale: ptBR })} — ${format(end, "dd MMM yyyy", { locale: ptBR })}`;
    }
    return format(selectedDate, "MMMM 'de' yyyy", { locale: ptBR });
  }, [selectedDate, viewMode, pipelineFilter, pipelineCustomStart, pipelineCustomEnd]);

  const totalCount = appointments.length;
  const scheduledCount = appointments.filter((a: any) => a.status === "scheduled" || a.status === "confirmed").length;
  const pendingCount = appointments.filter((a: any) => a.status === "pending").length;
  const blockedCount = appointments.filter((a: any) => a.status === "blocked" || a.type === "blocked").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Agenda</h1>
          <p className="text-muted-foreground text-sm capitalize">{headerTitle}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBlockOpen(true)} size="sm">
            <Ban className="w-4 h-4 mr-2" />Bloquear
          </Button>
          <Button onClick={() => openScheduleDialog(selectedDate)} size="sm">
            <Plus className="w-4 h-4 mr-2" />Nova Consulta
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)}><ChevronLeft className="w-4 h-4" /></Button>
          <Button variant="outline" onClick={() => setSelectedDate(new Date())} size="sm">Hoje</Button>
          <Button variant="outline" size="icon" onClick={() => navigate(1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          {([
            { mode: "day" as ViewMode, icon: List, label: "Dia" },
            { mode: "week" as ViewMode, icon: CalendarDays, label: "Semana" },
            { mode: "month" as ViewMode, icon: LayoutGrid, label: "Mês" },
            { mode: "pipeline" as ViewMode, icon: Users, label: "Pipeline" },
          ]).map(v => (
            <Button
              key={v.mode}
              variant={viewMode === v.mode ? "default" : "ghost"}
              size="sm"
              className={cn("gap-1.5 text-xs", viewMode !== v.mode && "text-muted-foreground")}
              onClick={() => setViewMode(v.mode)}
            >
              <v.icon className="w-3.5 h-3.5" />{v.label}
            </Button>
          ))}
        </div>
      </div>

      {canCreateForOthers && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border border-border">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Label className="text-sm font-medium">Profissional:</Label>
          <Select value={selectedProfessional} onValueChange={setSelectedProfessional}>
            <SelectTrigger className="w-[250px]"><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {(Array.isArray(professionals) ? professionals : []).map((p: any) => (
                <SelectItem key={p.id} value={p.id}><Users className="w-3 h-3 inline mr-1" />{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total", value: totalCount, color: "text-foreground" },
          { label: "Agendadas", value: scheduledCount, color: "text-green-600" },
          { label: "Pendentes", value: pendingCount, color: "text-yellow-600" },
          { label: "Bloqueados", value: blockedCount, color: "text-muted-foreground" },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-xl border border-border p-3 text-center">
            <p className={cn("text-xl font-bold", s.color)}>{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : viewMode === "month" ? (
        <MonthView
          selectedDate={selectedDate}
          aptsByDate={aptsByDate}
          onSelectDate={(d) => { setSelectedDate(d); setViewMode("day"); }}
          professionalColorMap={professionalColorMap}
          showProfessionalColors={canCreateForOthers}
        />
      ) : viewMode === "week" ? (
        <WeekView
          selectedDate={selectedDate}
          aptsByDate={aptsByDate}
          onSelectDate={(d) => { setSelectedDate(d); setViewMode("day"); }}
          onAttend={(id) => attendMutation.mutate(id)}
          onCreateAtSlot={openScheduleDialog}
          onSelectApt={openViewDialog}
          businessHours={businessHours}
          professionalColorMap={professionalColorMap}
          showProfessionalColors={canCreateForOthers}
          professionals={professionals}
        />
      ) : viewMode === "pipeline" ? (
        <PipelineView
          selectedDate={selectedDate}
          appointments={pipelineAppointments}
          professionalsById={professionalsById}
          professionalColorMap={professionalColorMap}
          showProfessionalColors={canCreateForOthers}
          pipelineFilter={pipelineFilter}
          onFilterChange={setPipelineFilter}
          customStart={pipelineCustomStart}
          customEnd={pipelineCustomEnd}
          onCustomStartChange={setPipelineCustomStart}
          onCustomEndChange={setPipelineCustomEnd}
          onSelectApt={openViewDialog}
        />
      ) : (
        <DayView
          selectedDate={selectedDate}
          appointments={getAptsForDate(selectedDate)}
          onAttend={(id) => attendMutation.mutate(id)}
          onCreateAtSlot={(time) => openScheduleDialog(selectedDate, time)}
          onSelectApt={openViewDialog}
          businessHours={businessHours}
          professionalColorMap={professionalColorMap}
          showProfessionalColors={canCreateForOthers}
        />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova Consulta</DialogTitle>
            <DialogDescription>Agende uma nova consulta</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {canCreateForOthers && (
              <div>
                <Label>Profissional *</Label>
                <Select value={selectedProfessional} onValueChange={setSelectedProfessional}>
                  <SelectTrigger><SelectValue placeholder="Selecione o profissional" /></SelectTrigger>
                  <SelectContent>
                    {(Array.isArray(professionals) ? professionals : []).map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tipo</Label>
                <Select value={form.type || "individual"} onValueChange={v => { set("type", v); if (v === "couple") set("patient_id", ""); else set("couple_id" as any, ""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Individual</SelectItem>
                    <SelectItem value="couple">Casal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                {form.type === "couple" ? (
                  <>
                    <Label>Casal *</Label>
                    <Select value={(form as any).couple_id || ""} onValueChange={v => set("couple_id" as any, v)}>
                      <SelectTrigger><SelectValue placeholder="Selecione o casal" /></SelectTrigger>
                      <SelectContent>
                        {(Array.isArray(couples) ? couples : []).map((c: Casal) => (
                          <SelectItem key={c.id} value={c.id}>
                            <Heart className="w-3 h-3 inline mr-1 text-primary" />{c.name || `${c.patient1?.name} & ${c.patient2?.name}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                ) : (
                  <>
                    <Label>Paciente *</Label>
                    <PatientSearchSelect
                      value={form.patient_id || ""}
                      onValueChange={(v) => set("patient_id", v)}
                      placeholder="Buscar paciente..."
                    />
                  </>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Data *</Label>
                <Input type="date" value={form.date || ""} onChange={e => set("date", e.target.value)} />
              </div>
              <div>
                <Label>Horário *</Label>
                <Input type="time" value={form.time || ""} onChange={e => set("time", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Duração (min)</Label>
                <Input type="number" value={form.duration || 50} onChange={e => set("duration", Number(e.target.value))} />
              </div>
              <div>
                <Label>Valor (R$)</Label>
                <Input type="number" value={form.value || 0} onChange={e => set("value", Number(e.target.value))} />
              </div>
              <div>
                <Label>Modalidade</Label>
                <Select value={form.mode || "in_person"} onValueChange={v => set("mode", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_person">Presencial</SelectItem>
                    <SelectItem value="video">Online</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={form.notes || ""} onChange={e => set("notes", e.target.value)} placeholder="Notas sobre a consulta..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Agendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={blockOpen} onOpenChange={(open) => { if (!open) resetBlock(); else setBlockOpen(true); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Ban className="w-5 h-5 text-muted-foreground" />Bloquear Horário</DialogTitle>
            <DialogDescription>Bloqueie horários — pontual, período ou recorrente</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {canCreateForOthers && (
              <div>
                <Label>Profissional</Label>
                <Select value={selectedProfessional} onValueChange={setSelectedProfessional}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {(Array.isArray(professionals) ? professionals : []).map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Categoria</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {blockCategories.map(cat => (
                  <button key={cat.value} onClick={() => setBlockCategory(cat.value)}
                    className={cn("flex items-center gap-1.5 text-xs p-2 rounded-lg border transition-all",
                      blockCategory === cat.value ? "border-primary bg-primary/5 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    <cat.icon className="w-3.5 h-3.5" />{cat.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Modo de bloqueio</Label>
              <Select value={blockMode} onValueChange={(v: any) => setBlockMode(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Dia único</SelectItem>
                  <SelectItem value="period">Período (férias)</SelectItem>
                  <SelectItem value="recurring">Recorrente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {blockMode !== "single" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Data inicial</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start text-left font-normal">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {blockStartDate ? format(blockStartDate, "dd/MM/yyyy") : "Selecione"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={blockStartDate} onSelect={setBlockStartDate} className="p-3 pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div>
                    <Label>Data final</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start text-left font-normal">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {blockEndDate ? format(blockEndDate, "dd/MM/yyyy") : "Selecione"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={blockEndDate} onSelect={setBlockEndDate} className="p-3 pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
                {blockMode === "recurring" && (
                  <div className="space-y-2">
                    <Label>Recorrência</Label>
                    <Select value={blockRecurrence} onValueChange={(v: any) => setBlockRecurrence(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Diária</SelectItem>
                        <SelectItem value="weekly">Semanal</SelectItem>
                        <SelectItem value="monthly">Mensal</SelectItem>
                      </SelectContent>
                    </Select>
                    {blockRecurrence === "weekly" && (
                      <div className="flex gap-1.5 flex-wrap">
                        {[{ day: 0, label: "Dom" }, { day: 1, label: "Seg" }, { day: 2, label: "Ter" },
                          { day: 3, label: "Qua" }, { day: 4, label: "Qui" }, { day: 5, label: "Sex" }, { day: 6, label: "Sáb" }
                        ].map(d => (
                          <button key={d.day} onClick={() => setBlockWeekdays(prev => prev.includes(d.day) ? prev.filter(x => x !== d.day) : [...prev, d.day])}
                            className={cn("w-10 h-10 rounded-lg text-xs font-medium transition-all border",
                              blockWeekdays.includes(d.day) ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/50"
                            )}
                          >{d.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Horário inicial *</Label>
                <Input type="time" value={blockTime} onChange={e => setBlockTime(e.target.value)} />
              </div>
              <div>
                <Label>Duração (min)</Label>
                <Input type="number" value={blockDuration} onChange={e => setBlockDuration(Number(e.target.value))} />
              </div>
            </div>
            <div>
              <Label>Descrição / Motivo</Label>
              <Textarea value={blockReason} onChange={e => setBlockReason(e.target.value)} placeholder="Detalhe o motivo..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetBlock}>Cancelar</Button>
            <Button onClick={handleBlock} disabled={blockMutation.isPending || !blockTime}>
              {blockMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Bloquear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View/Edit Appointment Dialog */}
      <Dialog open={!!viewApt} onOpenChange={(open) => { if (!open) { setViewApt(null); setEditMode(false); setEditApt(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editMode ? "Editar Consulta" : "Detalhes da Consulta"}</DialogTitle>
            <DialogDescription>
              {editMode ? "Altere os dados e salve" : "Visualize, edite ou cancele esta consulta"}
            </DialogDescription>
          </DialogHeader>
          {viewApt && !editMode && (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Paciente / Casal</p>
                  <p className="text-sm font-medium text-foreground">{getAppointmentDisplayName(viewApt)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Tipo</p>
                  <p className="text-sm font-medium text-foreground">{viewApt.type === "couple" ? "Casal" : viewApt.type === "blocked" ? "Bloqueio" : "Individual"}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Data</p>
                  <p className="text-sm font-medium text-foreground">
                    {(() => { try { const dk = getDateKey(viewApt.date); const [y,m,d] = dk.split("-").map(Number); return format(new Date(y,m-1,d), "dd/MM/yyyy"); } catch { return "—"; } })()}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Horário</p>
                  <p className="text-sm font-medium text-foreground">{viewApt.time || "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Duração</p>
                  <p className="text-sm font-medium text-foreground">{viewApt.duration || 50}min</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Modalidade</p>
                  <p className="text-sm font-medium text-foreground">{viewApt.mode === "video" ? "Online" : "Presencial"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge variant="outline" className="text-xs">{statusLabels[viewApt.status] || viewApt.status}</Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Valor</p>
                  <p className="text-sm font-medium text-foreground">{viewApt.value ? `R$ ${Number(viewApt.value).toFixed(2)}` : "—"}</p>
                </div>
              </div>
              {viewApt.notes && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Observações</p>
                  <p className="text-sm text-foreground bg-muted/50 rounded-lg p-3">{viewApt.notes}</p>
                </div>
              )}
              {viewApt.type !== "blocked" && (viewApt.status === "scheduled" || viewApt.status === "confirmed" || viewApt.status === "pending") && (
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <Button
                    variant="outline"
                    className="border-success text-success hover:bg-success hover:text-success-foreground"
                    onClick={() => attendMutation.mutate(viewApt.id)}
                    disabled={attendMutation.isPending}
                  >
                    {attendMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserCheck className="w-4 h-4 mr-2" />}
                    Compareceu
                  </Button>
                  <Button
                    variant="outline"
                    className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    onClick={() => missMutation.mutate(viewApt.id)}
                    disabled={missMutation.isPending}
                  >
                    {missMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Ban className="w-4 h-4 mr-2" />}
                    Faltou
                  </Button>
                </div>
              )}
              {viewApt.type !== "blocked" && viewApt.status !== "cancelled" && (
                <div className="flex flex-col gap-2 mt-4">
                  <Button
                    className="w-full gap-2"
                    onClick={() => {
                      const patientId = viewApt.patientId || viewApt.patient_id || "";
                      const appointmentId = viewApt.id || "";
                      routerNavigate(`/teleatendimento?patientId=${patientId}&appointmentId=${appointmentId}`);
                      setViewApt(null);
                    }}
                  >
                    <Video className="w-4 h-4" />
                    Iniciar Teleconsulta
                  </Button>
                  {viewApt.status === "pending_approval" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        onClick={() => approveMutation.mutate(viewApt.id)}
                        disabled={approveMutation.isPending}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        {approveMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                        <Check className="w-4 h-4 mr-1" />
                        Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => rejectMutation.mutate(viewApt.id)}
                        disabled={rejectMutation.isPending}
                      >
                        {rejectMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                        <Ban className="w-4 h-4 mr-1" />
                        Rejeitar
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" onClick={startEditing}>
                        Editar / Reagendar
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => cancelMutation.mutate(viewApt.id)}
                        disabled={cancelMutation.isPending}
                      >
                        {cancelMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                        <Ban className="w-4 h-4 mr-1" />
                        Cancelar
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {viewApt.type !== "blocked" && viewApt.status === "cancelled" && (
                <DialogFooter className="mt-4">
                  <Button size="sm" variant="outline" onClick={startEditing}>
                    Editar / Reagendar
                  </Button>
                </DialogFooter>
              )}
              {viewApt.type === "blocked" && (
                <DialogFooter className="mt-4">
                  <Button size="sm" onClick={startEditing}>
                    Editar
                  </Button>
                </DialogFooter>
              )}
            </div>
          )}
          {viewApt && editMode && editApt && (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Data *</Label>
                  <Input type="date" value={editApt.date || ""} onChange={e => setEditApt(prev => prev ? { ...prev, date: e.target.value } : prev)} />
                </div>
                <div>
                  <Label>Horário *</Label>
                  <Input type="time" value={editApt.time || ""} onChange={e => setEditApt(prev => prev ? { ...prev, time: e.target.value } : prev)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Duração (min)</Label>
                  <Input type="number" value={editApt.duration || 50} onChange={e => setEditApt(prev => prev ? { ...prev, duration: Number(e.target.value) } : prev)} />
                </div>
                <div>
                  <Label>Valor (R$)</Label>
                  <Input type="number" value={editApt.value || 0} onChange={e => setEditApt(prev => prev ? { ...prev, value: Number(e.target.value) } : prev)} />
                </div>
                <div>
                  <Label>Modalidade</Label>
                  <Select value={editApt.mode || "in_person"} onValueChange={v => setEditApt(prev => prev ? { ...prev, mode: v as "in_person" | "video" } : prev)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_person">Presencial</SelectItem>
                      <SelectItem value="video">Online</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={editApt.status || "scheduled"} onValueChange={v => setEditApt(prev => prev ? { ...prev, status: v as Consulta["status"] } : prev)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scheduled">Agendada</SelectItem>
                    <SelectItem value="confirmed">Confirmada</SelectItem>
                    <SelectItem value="completed">Concluída</SelectItem>
                    <SelectItem value="pending">Pendente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Observações</Label>
                <Textarea value={editApt.notes || ""} onChange={e => setEditApt(prev => prev ? { ...prev, notes: e.target.value } : prev)} placeholder="Notas..." />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setEditMode(false); setEditApt(null); }}>Voltar</Button>
                <Button onClick={handleEditSave} disabled={updateMutation.isPending}>
                  {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Salvar Alterações
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PipelineView({ selectedDate, appointments, professionalsById, professionalColorMap, showProfessionalColors, pipelineFilter, onFilterChange, customStart, customEnd, onCustomStartChange, onCustomEndChange, onSelectApt }: {
  selectedDate: Date;
  appointments: any[];
  professionalsById: Map<string, any>;
  professionalColorMap: Map<string, number>;
  showProfessionalColors: boolean;
  pipelineFilter: PipelineFilter;
  onFilterChange: (f: PipelineFilter) => void;
  customStart?: Date;
  customEnd?: Date;
  onCustomStartChange: (d: Date | undefined) => void;
  onCustomEndChange: (d: Date | undefined) => void;
  onSelectApt: (apt: any) => void;
}) {
  const groupedByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    appointments.forEach((apt: any) => {
      const d = getDateKey(apt.date);
      if (!map[d]) map[d] = [];
      map[d].push(apt);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [appointments]);

  const filterButtons: { value: PipelineFilter; label: string }[] = [
    { value: "today", label: "Hoje" },
    { value: "week", label: "Esta semana" },
    { value: "month", label: "Este mês" },
    { value: "custom", label: "Personalizado" },
  ];

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="border-b border-border px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Pipeline</h2>
            <p className="text-xs text-muted-foreground">{appointments.length} agendamento(s)</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {filterButtons.map(fb => (
            <Button
              key={fb.value}
              variant={pipelineFilter === fb.value ? "default" : "outline"}
              size="sm"
              className="text-xs h-7"
              onClick={() => onFilterChange(fb.value)}
            >
              {fb.label}
            </Button>
          ))}
        </div>
        {pipelineFilter === "custom" && (
          <div className="flex items-center gap-2 flex-wrap">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs h-7 gap-1">
                  <CalendarIcon className="w-3 h-3" />
                  {customStart ? format(customStart, "dd/MM/yyyy") : "Início"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customStart} onSelect={onCustomStartChange} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            <span className="text-xs text-muted-foreground">até</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs h-7 gap-1">
                  <CalendarIcon className="w-3 h-3" />
                  {customEnd ? format(customEnd, "dd/MM/yyyy") : "Fim"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customEnd} onSelect={onCustomEndChange} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      {appointments.length === 0 ? (
        <div className="px-4 py-10 text-sm text-muted-foreground text-center">Nenhum agendamento no período selecionado.</div>
      ) : (
        <div className="max-h-[600px] overflow-y-auto">
          {groupedByDate.map(([dateKey, dayApts]) => (
            <div key={dateKey}>
              {pipelineFilter !== "today" && (
                <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm px-4 py-1.5 text-xs font-semibold text-muted-foreground border-b border-border">
                  {(() => {
                    try {
                      const [y, m, d] = dateKey.split("-").map(Number);
                      return format(new Date(y, m - 1, d), "EEEE, dd 'de' MMMM", { locale: ptBR });
                    } catch { return dateKey; }
                  })()}
                  <span className="ml-2 text-[10px] font-normal">({dayApts.length})</span>
                </div>
              )}
              <div className="divide-y divide-border">
                {dayApts.map((apt: any) => {
                  const professional = apt.professional?.name
                    ? apt.professional
                    : (apt.professionalId ? professionalsById.get(apt.professionalId) : null);
                  const proColor = showProfessionalColors && apt.professionalId
                    ? getProfessionalColor(apt.professionalId, professionalColorMap)
                    : null;

                  return (
                    <div key={apt.id} className="flex items-center justify-between gap-4 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => onSelectApt(apt)}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-16 shrink-0">
                          <p className="text-sm font-semibold text-foreground">{apt.time}</p>
                          <p className="text-[10px] text-muted-foreground">{apt.duration}min</p>
                        </div>

                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{getAppointmentDisplayName(apt)}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{apt.type === "couple" ? "Casal" : "Individual"}</span>
                            <span>•</span>
                            <span>{apt.mode === "video" ? "Online" : "Presencial"}</span>
                            {professional?.name && (
                              <>
                                <span>•</span>
                                <span className={cn("font-medium", proColor?.text)}>
                                  Responsável: {professional.name}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {showProfessionalColors && proColor && (
                          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium", proColor.bg, proColor.text)}>
                            <span className={cn("h-2 w-2 rounded-full", proColor.dot)} />
                            {professional?.name?.split(" ")[0] || "Profissional"}
                          </span>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          {statusLabels[apt.status] || apt.status}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MonthView({ selectedDate, aptsByDate, onSelectDate, professionalColorMap, showProfessionalColors }: {
  selectedDate: Date;
  aptsByDate: Record<string, any[]>;
  onSelectDate: (d: Date) => void;
  professionalColorMap: Map<string, number>;
  showProfessionalColors: boolean;
}) {
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border">
        {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map(d => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const key = format(day, "yyyy-MM-dd");
          const apts = aptsByDate[key] || [];
          const inMonth = isSameMonth(day, selectedDate);
          const today = isToday(day);
          return (
            <button
              key={i}
              onClick={() => onSelectDate(day)}
              className={cn(
                "min-h-[80px] p-1.5 border-b border-r border-border text-left transition-colors hover:bg-accent/50",
                !inMonth && "opacity-40",
                today && "bg-primary/5"
              )}
            >
              <span className={cn(
                "text-xs font-medium inline-flex w-6 h-6 items-center justify-center rounded-full",
                today && "bg-primary text-primary-foreground"
              )}>
                {format(day, "d")}
              </span>
              <div className="mt-0.5 space-y-0.5">
                {apts.slice(0, 3).map((apt: any, j: number) => {
                  const aptStatus = apt.type === "blocked" ? "blocked" : apt.status;
                  const proColor = showProfessionalColors && apt.professionalId
                    ? getProfessionalColor(apt.professionalId, professionalColorMap)
                    : null;
                  return (
                    <div key={j} className={cn(
                      "text-[10px] px-1 py-0.5 rounded truncate",
                      proColor ? `${proColor.bg} ${proColor.text}` : `${statusColors[aptStatus]}/10 text-foreground`
                    )}>
                      <span className={cn("inline-block w-1.5 h-1.5 rounded-full mr-1",
                        proColor ? proColor.dot : statusColors[aptStatus]
                      )} />
                      {apt.time} {apt.type === "blocked" ? "Bloq." : apt.patient?.name?.split(" ")[0] || "—"}
                    </div>
                  );
                })}
                {apts.length > 3 && (
                  <span className="text-[10px] text-muted-foreground pl-1">+{apts.length - 3} mais</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ selectedDate, aptsByDate, onSelectDate, onAttend, onCreateAtSlot, onSelectApt, businessHours, professionalColorMap, showProfessionalColors, professionals = [] }: {
  selectedDate: Date;
  aptsByDate: Record<string, any[]>;
  onSelectDate: (d: Date) => void;
  onAttend: (id: string) => void;
  onCreateAtSlot: (date: Date, time: string) => void;
  onSelectApt: (apt: any) => void;
  businessHours: number[];
  professionalColorMap: Map<string, number>;
  showProfessionalColors: boolean;
  professionals?: any[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const displayDays = weekDays.filter((_, i) => i < 6);

  useEffect(() => {
    if (scrollRef.current && businessHours.length > 0) {
      const firstBizHour = businessHours[0];
      const rowIndex = ALL_HOURS.indexOf(firstBizHour);
      if (rowIndex > 0) {
        scrollRef.current.scrollTop = rowIndex * 48;
      }
    }
  }, [businessHours]);

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {showProfessionalColors && professionalColorMap.size > 1 && (
        <div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-muted/30 flex-wrap">
          <span className="text-[10px] font-medium text-muted-foreground">Profissionais:</span>
          {Array.from(professionalColorMap.entries()).map(([profId, idx]) => {
            const color = PROFESSIONAL_COLORS[idx % PROFESSIONAL_COLORS.length];
            const prof = professionals.find((p: any) => p.id === profId);
            const name = prof?.name || `Prof. ${idx + 1}`;
            return (
              <span key={profId} className="flex items-center gap-1 text-[10px]">
                <span className={cn("w-2.5 h-2.5 rounded-full", color.dot)} />
                <span className={color.text}>{name}</span>
              </span>
            );
          })}
        </div>
      )}
      <div className="grid border-b border-border" style={{ gridTemplateColumns: `60px repeat(${displayDays.length}, 1fr)` }}>
        <div className="p-2 border-r border-border" />
        {displayDays.map((day, i) => {
          const today = isToday(day);
          return (
            <button
              key={i}
              onClick={() => onSelectDate(day)}
              className={cn(
                "p-2 text-center border-r border-border last:border-r-0 hover:bg-accent/50 transition-colors",
                today && "bg-primary/5"
              )}
            >
              <p className="text-[10px] uppercase text-muted-foreground">{format(day, "EEE", { locale: ptBR })}</p>
              <p className={cn(
                "text-sm font-semibold inline-flex w-7 h-7 items-center justify-center rounded-full",
                today && "bg-primary text-primary-foreground"
              )}>
                {format(day, "d")}
              </p>
            </button>
          );
        })}
      </div>
      <div ref={scrollRef} className="max-h-[600px] overflow-y-auto">
        {ALL_HOURS.map(hour => {
          const isBusinessHour = businessHours.includes(hour);
          const slotTime = `${String(hour).padStart(2, "0")}:00`;
          return (
            <div key={hour} className={cn(
              "grid border-b border-border last:border-b-0",
              !isBusinessHour && "opacity-40 bg-muted/20"
            )} style={{ gridTemplateColumns: `60px repeat(${displayDays.length}, 1fr)` }}>
              <div className="p-1.5 text-[11px] text-muted-foreground text-right pr-3 border-r border-border font-mono">
                {slotTime}
              </div>
              {displayDays.map((day, di) => {
                const key = format(day, "yyyy-MM-dd");
                const hourApts = (aptsByDate[key] || []).filter((a: any) => {
                  if (!a.time) return false;
                  const h = parseInt(a.time.split(":")[0], 10);
                  return h === hour;
                });
                return (
                  <div
                    key={di}
                    onClick={() => onCreateAtSlot(day, slotTime)}
                    className={cn(
                      "min-h-[48px] p-0.5 border-r border-border last:border-r-0 relative cursor-pointer transition-colors hover:bg-accent/40",
                      isToday(day) && "bg-primary/[0.02]"
                    )}
                  >
                    {hourApts.length === 0 && (
                      <div className="flex h-full min-h-[44px] items-center px-2 text-[10px] text-muted-foreground/80 opacity-0 transition-opacity hover:opacity-100">
                        Clique para agendar
                      </div>
                    )}
                    {hourApts.map((apt: any, j: number) => {
                      const aptStatus = apt.type === "blocked" ? "blocked" : apt.status;
                      const proColor = showProfessionalColors && apt.professionalId
                        ? getProfessionalColor(apt.professionalId, professionalColorMap)
                        : null;
                      return (
                        <div
                          key={j}
                          onClick={(e) => { e.stopPropagation(); onSelectApt(apt); }}
                          className={cn(
                            "text-[10px] px-1.5 py-1 rounded border-l-2 mb-0.5 truncate cursor-pointer hover:opacity-80",
                            proColor
                              ? `${proColor.bg} ${proColor.border}`
                              : statusBgColors[aptStatus] || "bg-muted border-l-muted-foreground"
                          )}
                          title={`${apt.time} - ${apt.type === "blocked" ? apt.notes || "Bloqueado" : apt.patient?.name || "—"}`}
                        >
                          <span className="font-medium">{apt.time}</span>{" "}
                          {apt.type === "blocked" ? "Bloq." : apt.patient?.name?.split(" ")[0] || "—"}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayView({ selectedDate, appointments, onAttend, onCreateAtSlot, onSelectApt, businessHours, professionalColorMap, showProfessionalColors }: {
  selectedDate: Date;
  appointments: any[];
  onAttend: (id: string) => void;
  onCreateAtSlot: (time: string) => void;
  onSelectApt: (apt: any) => void;
  businessHours: number[];
  professionalColorMap: Map<string, number>;
  showProfessionalColors: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current && businessHours.length > 0) {
      const firstBizHour = businessHours[0];
      const rowIndex = ALL_HOURS.indexOf(firstBizHour);
      if (rowIndex > 0) {
        scrollRef.current.scrollTop = rowIndex * 56;
      }
    }
  }, [businessHours]);

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
        {format(selectedDate, "EEEE, dd 'de' MMMM", { locale: ptBR })}
      </div>
      <div ref={scrollRef} className="max-h-[600px] overflow-y-auto">
        {ALL_HOURS.map(hour => {
          const isBusinessHour = businessHours.includes(hour);
          const slotTime = `${String(hour).padStart(2, "0")}:00`;
          const hourApts = appointments.filter((a: any) => {
            if (!a.time) return false;
            return parseInt(a.time.split(":")[0], 10) === hour;
          });
          return (
            <div key={hour} className={cn(
              "flex border-b border-border last:border-b-0",
              !isBusinessHour && "opacity-40 bg-muted/20"
            )}>
              <div className="w-16 shrink-0 p-2 text-right pr-3 border-r border-border text-xs text-muted-foreground font-mono">
                {slotTime}
              </div>
              <div
                className="flex-1 min-h-[56px] p-1.5 space-y-1 cursor-pointer transition-colors hover:bg-accent/30"
                onClick={() => onCreateAtSlot(slotTime)}
              >
                {hourApts.length === 0 && (
                  <div className="flex min-h-[44px] items-center px-2 text-xs text-muted-foreground">
                    Clique no horário vazio para agendar
                  </div>
                )}
                {hourApts.map((apt: any, i: number) => {
                  const aptStatus = apt.type === "blocked" ? "blocked" : apt.status;
                  const patientName = apt.patient?.name || (apt.type === "blocked" ? apt.notes || "Bloqueado" : "Paciente");
                  const proColor = showProfessionalColors && apt.professionalId
                    ? getProfessionalColor(apt.professionalId, professionalColorMap)
                    : null;
                  return (
                    <motion.div
                      key={apt.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      onClick={(e) => { e.stopPropagation(); onSelectApt(apt); }}
                      className={cn(
                        "flex items-center justify-between p-2.5 rounded-lg border-l-3 transition-shadow hover:shadow-md",
                        proColor
                          ? `${proColor.bg} ${proColor.border}`
                          : statusBgColors[aptStatus] || "bg-muted border-l-muted-foreground"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{apt.time}</p>
                          <p className="text-[10px] text-muted-foreground">{apt.duration}min</p>
                        </div>
                        <div className="h-8 w-px bg-border" />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {apt.type === "blocked" ? (
                              <span className="flex items-center gap-1 text-muted-foreground"><Ban className="w-3 h-3" />{patientName}</span>
                            ) : patientName}
                          </p>
                          {apt.type !== "blocked" && (
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full",
                                apt.type === "couple" ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground"
                              )}>
                                {apt.type === "couple" ? "Casal" : "Individual"}
                              </span>
                              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                {apt.mode === "video" ? <Video className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
                                {apt.mode === "video" ? "Online" : "Presencial"}
                              </span>
                              {showProfessionalColors && proColor && apt.professional?.name && (
                                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", proColor.bg, proColor.text)}>
                                  {apt.professional.name.split(" ")[0]}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn("text-[10px]",
                          aptStatus === "scheduled" || aptStatus === "confirmed" ? "border-green-500/30 text-green-600" :
                          aptStatus === "pending" ? "border-yellow-500/30 text-yellow-600" :
                          aptStatus === "blocked" ? "border-muted text-muted-foreground" :
                          "border-destructive/30 text-destructive"
                        )}>
                          {statusLabels[aptStatus] || aptStatus}
                        </Badge>
                        {apt.type !== "blocked" && aptStatus !== "cancelled" && !apt.attended && (
                          <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={(e) => { e.stopPropagation(); onAttend(apt.id); }}>
                            <UserCheck className="w-3 h-3" />Compareceu
                          </Button>
                        )}
                        {apt.attended && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 font-medium">✓</span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
