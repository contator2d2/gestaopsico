import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Plus, Search, Filter, MoreHorizontal, Phone, Trash2, Edit,
  Key, Bell, DollarSign, Copy, Loader2, CheckCircle2, XCircle, MapPin, FileText, Link2, Send
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInputInternational } from "@/components/PhoneInputInternational";
import { Skeleton } from "@/components/ui/skeleton";
import { usePatients, useCreatePatient, useDeletePatient, useUpdatePatient } from "@/hooks/usePatients";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { patientPortalApi, orgSettingsApi } from "@/lib/portalApi";
import { pacientesApi, apiRequest, type Patient } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

// CPF validation (client-side)
function isValidCPF(cpf: string): boolean {
  const cleaned = (cpf || "").replace(/\D/g, "");
  if (cleaned.length !== 11 || /^(\d)\1{10}$/.test(cleaned)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cleaned[i]) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (parseInt(cleaned[9]) !== d1) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cleaned[i]) * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  return parseInt(cleaned[10]) === d2;
}

// CPF mask
function maskCPF(value: string): string {
  const v = value.replace(/\D/g, "").slice(0, 11);
  if (v.length <= 3) return v;
  if (v.length <= 6) return `${v.slice(0, 3)}.${v.slice(3)}`;
  if (v.length <= 9) return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6)}`;
  return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
}

// Phone mask
function maskPhone(value: string): string {
  const v = value.replace(/\D/g, "").slice(0, 11);
  if (v.length <= 2) return `(${v}`;
  if (v.length <= 7) return `(${v.slice(0, 2)}) ${v.slice(2)}`;
  return `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
}

// CEP mask
function maskCEP(value: string): string {
  const v = value.replace(/\D/g, "").slice(0, 8);
  if (v.length <= 5) return v;
  return `${v.slice(0, 5)}-${v.slice(5)}`;
}

const emptyForm = (): Partial<Patient> => ({
  name: "", nickname: "", cpf: "", phone: "", email: "", gender: "",
  birth_date: "", address: "", emergency_contact: "",
  cep: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "",
  clinical_notes: "", health_history: "", medications: "", allergies: "",
  status: "active", billing_mode: "per_session", session_value: undefined,
  monthly_value: undefined, charge_notification_mode: "whatsapp",
  charge_day: 5, charge_time: "10:00", charge_enabled: false,
});

export default function Pacientes() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role || "professional";
  const isSecretaryOrAdmin = role === "secretary" || role === "admin" || role === "superadmin" || role === "secretary_financial";
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessPatient, setAccessPatient] = useState<Patient | null>(null);
  const [accessEmail, setAccessEmail] = useState("");
  const [accessPassword, setAccessPassword] = useState("");
  const [billingOpen, setBillingOpen] = useState(false);
  const [billingPatient, setBillingPatient] = useState<Patient | null>(null);
  const [form, setForm] = useState<Partial<Patient>>(emptyForm());
  const [cpfStatus, setCpfStatus] = useState<"idle" | "valid" | "invalid" | "exists" | "checking">("idle");
  const [cepLoading, setCepLoading] = useState(false);
  const [cepFound, setCepFound] = useState(false);

  const { data: patients = [], isLoading, isError, error } = usePatients(search || undefined);
  const createPatient = useCreatePatient();
  const updatePatient = useUpdatePatient();
  const deletePatient = useDeletePatient();

  const createAccessMutation = useMutation({
    mutationFn: (data: { patientId: string; email: string; password: string }) =>
      patientPortalApi.createAccess(data),
    onSuccess: () => {
      toast({ title: "Acesso criado!", description: "O paciente já pode acessar o portal." });
      setAccessOpen(false);
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const set = (field: string, value: any) =>
    setForm(prev => ({ ...prev, [field]: value }));

  // CEP lookup
  const handleCepBlur = useCallback(async () => {
    const cep = (form.cep || "").replace(/\D/g, "");
    if (cep.length !== 8) return;
    setCepLoading(true);
    setCepFound(false);
    try {
      const data = await pacientesApi.lookupCep(cep);
      setForm(prev => ({
        ...prev,
        street: data.street || prev.street,
        neighborhood: data.neighborhood || prev.neighborhood,
        city: data.city || prev.city,
        state: data.state || prev.state,
        complement: data.complement || prev.complement,
      }));
      setCepFound(true);
      toast({ title: "CEP encontrado!", description: `${data.street}, ${data.city} - ${data.state}` });
    } catch {
      toast({ title: "CEP não encontrado", variant: "destructive" });
    } finally {
      setCepLoading(false);
    }
  }, [form.cep]);

  // CPF validation
  const handleCpfBlur = useCallback(async () => {
    const cpf = (form.cpf || "").replace(/\D/g, "");
    if (cpf.length !== 11) { setCpfStatus("idle"); return; }
    if (!isValidCPF(cpf)) { setCpfStatus("invalid"); return; }
    setCpfStatus("checking");
    try {
      const result = await pacientesApi.validateCpf(cpf);
      if (!result.valid) setCpfStatus("invalid");
      else if (result.exists && !editingId) setCpfStatus("exists");
      else setCpfStatus("valid");
    } catch {
      setCpfStatus(isValidCPF(cpf) ? "valid" : "invalid");
    }
  }, [form.cpf, editingId]);

  const openEdit = (p: Patient) => {
    setEditingId(p.id);
    setForm({
      name: p.name, nickname: p.nickname || "", cpf: p.cpf || "", phone: p.phone || "", email: p.email || "",
      gender: p.gender || "", birth_date: p.birth_date ? String(p.birth_date).slice(0, 10) : "",
      address: p.address || "", cep: p.cep || "", street: p.street || "",
      number: p.number || "", complement: p.complement || "",
      neighborhood: p.neighborhood || "", city: p.city || "", state: p.state || "",
      emergency_contact: p.emergency_contact || "",
      clinical_notes: p.clinical_notes || "", health_history: p.health_history || "",
      medications: p.medications || "", allergies: p.allergies || "",
      status: p.status || "active",
      billing_mode: p.billing_mode || "per_session",
      session_value: p.session_value, monthly_value: p.monthly_value,
      charge_notification_mode: p.charge_notification_mode || "whatsapp",
      charge_day: p.charge_day || 5, charge_time: p.charge_time || "10:00",
      charge_enabled: p.charge_enabled || false,
    });
    setCpfStatus("idle");
    setCepFound(false);
    setDialogOpen(true);
  };

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm());
    setCpfStatus("idle");
    setCepFound(false);
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name?.trim()) {
      toast({ title: "Nome é obrigatório", variant: "destructive" });
      return;
    }
    if (form.cpf && !isValidCPF(form.cpf)) {
      toast({ title: "CPF inválido", variant: "destructive" });
      return;
    }
    if (cpfStatus === "exists") {
      toast({ title: "CPF já cadastrado", variant: "destructive" });
      return;
    }

    if (editingId) {
      updatePatient.mutate({ id: editingId, data: form }, {
        onSuccess: () => {
          setDialogOpen(false);
          setEditingId(null);
        },
      });
    } else {
      createPatient.mutate(form, {
        onSuccess: () => {
          setForm(emptyForm());
          setDialogOpen(false);
        },
      });
    }
  };

  const handleDelete = () => {
    if (deleteId) {
      deletePatient.mutate(deleteId, { onSuccess: () => setDeleteId(null) });
    }
  };

  const openAccess = (p: Patient) => {
    setAccessPatient(p);
    setAccessEmail(p.email || "");
    setAccessPassword("");
    setAccessOpen(true);
  };

  const openBilling = (p: Patient) => {
    setBillingPatient(p);
    setForm({
      billing_mode: p.billing_mode || "per_session",
      session_value: p.session_value,
      monthly_value: p.monthly_value,
      charge_notification_mode: p.charge_notification_mode || "whatsapp",
      charge_day: p.charge_day || 5,
      charge_time: p.charge_time || "10:00",
      charge_enabled: p.charge_enabled || false,
    });
    setBillingOpen(true);
  };

  const handleSaveBilling = () => {
    if (!billingPatient) return;
    updatePatient.mutate({
      id: billingPatient.id,
      data: {
        billing_mode: form.billing_mode,
        session_value: form.session_value,
        monthly_value: form.monthly_value,
        charge_notification_mode: form.charge_notification_mode,
        charge_day: form.charge_day,
        charge_time: form.charge_time,
        charge_enabled: form.charge_enabled,
      },
    }, {
      onSuccess: () => setBillingOpen(false),
    });
  };

  const { data: orgSettings } = useQuery({
    queryKey: ["org-settings"],
    queryFn: () => orgSettingsApi.get(),
  });
  const sharedAgenda = !!orgSettings?.sharedAgenda;
  const canPickProfessional = isSecretaryOrAdmin || sharedAgenda;

  const { data: professionals = [] } = useQuery<any[]>({
    queryKey: ["professionals"],
    queryFn: () => apiRequest<any[]>("/settings/professionals"),
    enabled: canPickProfessional,
  });

  const portalSlug = orgSettings?.portalSlug;
  const portalUrl = portalSlug
    ? `${window.location.origin}/p/${portalSlug}`
    : `${window.location.origin}/login`;
  const patientList = Array.isArray(patients) ? patients : (patients as any)?.data || [];
  const isPending = editingId ? updatePatient.isPending : createPatient.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Pacientes</h1>
          <p className="text-muted-foreground mt-1">{patientList.length} pacientes cadastrados</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            navigator.clipboard.writeText(portalUrl);
            toast({ title: "Link do portal copiado!" });
          }}>
            <Copy className="w-4 h-4 mr-1" />Link Portal
          </Button>
          <Button onClick={openNew}>
            <Plus className="w-4 h-4 mr-2" />Novo Paciente
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, CPF ou e-mail..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Button variant="outline" size="icon"><Filter className="w-4 h-4" /></Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : isError ? (
        <div className="text-center py-12 bg-destructive/5 rounded-xl border border-destructive/20">
          <XCircle className="w-12 h-12 mx-auto mb-3 text-destructive opacity-50" />
          <p className="text-lg font-medium text-destructive">Erro ao carregar pacientes</p>
          <p className="text-sm mt-1 text-muted-foreground">{(error as Error)?.message || "Não foi possível conectar ao servidor"}</p>
          <Button variant="outline" className="mt-4" onClick={() => qc.invalidateQueries({ queryKey: ["patients"] })}>
            Tentar novamente
          </Button>
        </div>
      ) : patientList.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium">Nenhum paciente encontrado</p>
          <p className="text-sm mt-1">Cadastre seu primeiro paciente clicando no botão acima.</p>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">Paciente</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">Contato</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">Cobrança</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {patientList.map((p: Patient, i: number) => (
                <motion.tr key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => openEdit(p)}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-secondary-foreground">{p.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {p.name}
                          {p.nickname && <span className="text-xs text-muted-foreground ml-1">({p.nickname})</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">{p.cpf || "—"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">{p.phone || "—"}</span>
                      {p.whatsapp_valid && <CheckCircle2 className="w-3.5 h-3.5 text-success" />}
                    </div>
                    {p.city && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{p.city}/{p.state}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {p.billing_mode === "monthly" ? "Mensal" : "Por Sessão"}
                    </span>
                    {p.charge_enabled && (
                      <span className="text-xs ml-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                        <Bell className="w-3 h-3 inline" />
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${p.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                      {p.status === "active" ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 rounded hover:bg-muted transition-colors">
                          <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(p)}>
                          <Edit className="w-4 h-4 mr-2" />Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openAccess(p)}>
                          <Key className="w-4 h-4 mr-2" />Criar Acesso ao Portal
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openBilling(p)}>
                          <DollarSign className="w-4 h-4 mr-2" />Cobrança e Notificação
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate(`/prontuarios?patientId=${p.id}`)}>
                          <FileText className="w-4 h-4 mr-2" />Prontuários
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(p.id)}>
                          <Trash2 className="w-4 h-4 mr-2" />Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      )}

      {/* Create/Edit Patient Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingId(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Paciente" : "Cadastrar Novo Paciente"}</DialogTitle>
            <DialogDescription>Preencha os dados do paciente abaixo</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="pessoal" className="mt-2">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="pessoal">Pessoal</TabsTrigger>
              <TabsTrigger value="contato">Contato</TabsTrigger>
              <TabsTrigger value="endereco">Endereço</TabsTrigger>
              <TabsTrigger value="clinico">Clínico</TabsTrigger>
              <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
            </TabsList>

            <TabsContent value="pessoal" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Nome Completo *</Label>
                  <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Nome do paciente" />
                </div>
                <div>
                  <Label>Apelido</Label>
                  <Input value={form.nickname || ""} onChange={e => set("nickname", e.target.value)} placeholder="Como prefere ser chamado(a)" />
                </div>
                <div>
                  <Label>CPF</Label>
                  <div className="relative">
                    <Input
                      value={form.cpf}
                      onChange={e => { set("cpf", maskCPF(e.target.value)); setCpfStatus("idle"); }}
                      onBlur={handleCpfBlur}
                      placeholder="000.000.000-00"
                      maxLength={14}
                      className={
                        cpfStatus === "invalid" || cpfStatus === "exists" ? "border-destructive pr-9" :
                        cpfStatus === "valid" ? "border-success pr-9" : "pr-9"
                      }
                    />
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                      {cpfStatus === "checking" && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                      {cpfStatus === "valid" && <CheckCircle2 className="w-4 h-4 text-success" />}
                      {(cpfStatus === "invalid" || cpfStatus === "exists") && <XCircle className="w-4 h-4 text-destructive" />}
                    </div>
                  </div>
                  {cpfStatus === "invalid" && <p className="text-xs text-destructive mt-1">CPF inválido</p>}
                  {cpfStatus === "exists" && <p className="text-xs text-destructive mt-1">CPF já cadastrado</p>}
                </div>
                <div>
                  <Label>Data de Nascimento</Label>
                  <Input type="date" value={form.birth_date} onChange={e => set("birth_date", e.target.value)} />
                </div>
                <div>
                  <Label>Gênero</Label>
                  <Select value={form.gender || ""} onValueChange={v => set("gender", v)}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="masculino">Masculino</SelectItem>
                      <SelectItem value="feminino">Feminino</SelectItem>
                      <SelectItem value="nao-binario">Não-binário</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                      <SelectItem value="prefiro-nao-informar">Prefiro não informar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={form.status || "active"} onValueChange={v => set("status", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="inactive">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="contato" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Telefone / WhatsApp</Label>
                  <PhoneInputInternational
                    value={form.phone || ""}
                    onChange={v => set("phone", v)}
                    placeholder="Número do telefone"
                  />
                </div>
                <div>
                  <Label>E-mail</Label>
                  <Input type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="email@exemplo.com" />
                </div>
                <div className="col-span-2">
                  <Label>Contato de Emergência</Label>
                  <Input value={form.emergency_contact} onChange={e => set("emergency_contact", e.target.value)} placeholder="Nome e telefone" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="endereco" className="space-y-4 mt-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>CEP</Label>
                  <div className="relative">
                    <Input
                      value={form.cep}
                      onChange={e => { set("cep", maskCEP(e.target.value)); setCepFound(false); }}
                      onBlur={handleCepBlur}
                      placeholder="00000-000"
                      maxLength={9}
                      className={cepFound ? "border-success pr-9" : "pr-9"}
                    />
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                      {cepLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                      {cepFound && <CheckCircle2 className="w-4 h-4 text-success" />}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Preencha e saia do campo para buscar</p>
                </div>
                <div className="col-span-2">
                  <Label>Rua / Logradouro</Label>
                  <Input value={form.street} onChange={e => set("street", e.target.value)} placeholder="Rua, Avenida..." />
                </div>
                <div>
                  <Label>Número</Label>
                  <Input value={form.number} onChange={e => set("number", e.target.value)} placeholder="123" />
                </div>
                <div>
                  <Label>Complemento</Label>
                  <Input value={form.complement} onChange={e => set("complement", e.target.value)} placeholder="Apt, Sala..." />
                </div>
                <div>
                  <Label>Bairro</Label>
                  <Input value={form.neighborhood} onChange={e => set("neighborhood", e.target.value)} placeholder="Bairro" />
                </div>
                <div>
                  <Label>Cidade</Label>
                  <Input value={form.city} onChange={e => set("city", e.target.value)} placeholder="Cidade" />
                </div>
                <div>
                  <Label>Estado</Label>
                  <Select value={form.state || ""} onValueChange={v => set("state", v)}>
                    <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                    <SelectContent>
                      {["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map(uf => (
                        <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="clinico" className="space-y-4 mt-4">
              <div>
                <Label>Histórico de Saúde</Label>
                <Textarea value={form.health_history} onChange={e => set("health_history", e.target.value)} placeholder="Histórico médico relevante..." rows={3} />
              </div>
              <div>
                <Label>Medicações em Uso</Label>
                <Textarea value={form.medications} onChange={e => set("medications", e.target.value)} placeholder="Medicações atuais..." rows={2} />
              </div>
              <div>
                <Label>Alergias</Label>
                <Textarea value={form.allergies} onChange={e => set("allergies", e.target.value)} placeholder="Alergias conhecidas..." rows={2} />
              </div>
              <div>
                <Label>Notas Clínicas</Label>
                <Textarea value={form.clinical_notes} onChange={e => set("clinical_notes", e.target.value)} placeholder="Observações clínicas iniciais..." rows={3} />
              </div>
            </TabsContent>

            <TabsContent value="financeiro" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Modo de Cobrança</Label>
                  <Select value={form.billing_mode || "per_session"} onValueChange={v => set("billing_mode", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="per_session">Por Sessão</SelectItem>
                      <SelectItem value="monthly">Mensal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.billing_mode === "monthly" ? (
                  <div>
                    <Label>Valor Mensal (R$)</Label>
                    <Input type="number" step="0.01" value={form.monthly_value ?? ""} onChange={e => set("monthly_value", e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="500.00" />
                  </div>
                ) : (
                  <div>
                    <Label>Valor por Sessão (R$)</Label>
                    <Input type="number" step="0.01" value={form.session_value ?? ""} onChange={e => set("session_value", e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="250.00" />
                  </div>
                )}
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <Label className="text-base font-semibold">Notificação de Cobrança</Label>
                    <p className="text-xs text-muted-foreground">Enviar lembrete automático de pagamento</p>
                  </div>
                  <Switch checked={form.charge_enabled || false} onCheckedChange={v => set("charge_enabled", v)} />
                </div>

                {form.charge_enabled && (
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label>Canal</Label>
                      <Select value={form.charge_notification_mode || "whatsapp"} onValueChange={v => set("charge_notification_mode", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="whatsapp">WhatsApp</SelectItem>
                          <SelectItem value="email">E-mail</SelectItem>
                          <SelectItem value="sms">SMS</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Dia do Mês</Label>
                      <Input type="number" min={1} max={28} value={form.charge_day || 5} onChange={e => set("charge_day", parseInt(e.target.value))} />
                    </div>
                    <div>
                      <Label>Horário</Label>
                      <Input type="time" value={form.charge_time || "10:00"} onChange={e => set("charge_time", e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {editingId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mr-auto"
                onClick={async () => {
                  try {
                    const result = await pacientesApi.generateRegistrationLink(editingId);
                    await navigator.clipboard.writeText(result.link);
                    toast({ title: "Link copiado!", description: "O link de cadastro foi copiado para a área de transferência. Envie ao paciente via WhatsApp." });
                  } catch (err: any) {
                    toast({ title: "Erro ao gerar link", description: err.message, variant: "destructive" });
                  }
                }}
              >
                <Link2 className="w-4 h-4 mr-1" />
                Enviar link de cadastro
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={isPending || !form.name?.trim() || cpfStatus === "invalid" || cpfStatus === "exists"}>
              {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</> : (editingId ? "Salvar Alterações" : "Cadastrar Paciente")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Patient Access Dialog */}
      <Dialog open={accessOpen} onOpenChange={setAccessOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar Acesso ao Portal</DialogTitle>
            <DialogDescription>
              Defina e-mail e senha para {accessPatient?.name} acessar o portal do paciente
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!accessPatient || !accessEmail || accessPassword.length < 6) {
                toast({ title: "Preencha e-mail e senha (mín. 6 caracteres)", variant: "destructive" });
                return;
              }
              createAccessMutation.mutate({
                patientId: accessPatient.id,
                email: accessEmail,
                password: accessPassword,
              });
            }}
          >
            <div className="p-3 bg-muted/50 rounded-lg">
              <Label className="text-xs text-muted-foreground">Link do Portal</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input readOnly value={portalUrl} className="text-xs" />
                <Button type="button" variant="outline" size="sm" onClick={() => {
                  navigator.clipboard.writeText(portalUrl);
                  toast({ title: "Link copiado!" });
                }}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div>
              <Label>E-mail de Login</Label>
              <Input type="email" value={accessEmail} onChange={e => setAccessEmail(e.target.value)} placeholder="paciente@email.com" autoComplete="username" />
            </div>
            <div>
              <Label>Senha</Label>
              <Input type="password" value={accessPassword} onChange={e => setAccessPassword(e.target.value)} placeholder="Mínimo 6 caracteres" autoComplete="new-password" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAccessOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={createAccessMutation.isPending}>
                {createAccessMutation.isPending ? "Criando..." : "Criar Acesso"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Billing & Notification Dialog */}
      <Dialog open={billingOpen} onOpenChange={setBillingOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Cobrança e Notificações</DialogTitle>
            <DialogDescription>
              Configure o modo de cobrança e notificação para {billingPatient?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Modo de Cobrança</Label>
                <Select value={form.billing_mode || "per_session"} onValueChange={v => set("billing_mode", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_session">Por Sessão</SelectItem>
                    <SelectItem value="monthly">Mensal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.billing_mode === "monthly" ? (
                <div>
                  <Label>Valor Mensal (R$)</Label>
                  <Input type="number" step="0.01" value={form.monthly_value ?? ""} onChange={e => set("monthly_value", e.target.value ? parseFloat(e.target.value) : undefined)} />
                </div>
              ) : (
                <div>
                  <Label>Valor por Sessão (R$)</Label>
                  <Input type="number" step="0.01" value={form.session_value ?? ""} onChange={e => set("session_value", e.target.value ? parseFloat(e.target.value) : undefined)} />
                </div>
              )}
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <Label className="text-base font-semibold">Notificação de Cobrança</Label>
                  <p className="text-xs text-muted-foreground">Enviar lembrete automático de pagamento</p>
                </div>
                <Switch checked={form.charge_enabled || false} onCheckedChange={v => set("charge_enabled", v)} />
              </div>

              {form.charge_enabled && (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>Canal</Label>
                    <Select value={form.charge_notification_mode || "whatsapp"} onValueChange={v => set("charge_notification_mode", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                        <SelectItem value="email">E-mail</SelectItem>
                        <SelectItem value="sms">SMS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Dia do Mês</Label>
                    <Input type="number" min={1} max={28} value={form.charge_day || 5} onChange={e => set("charge_day", parseInt(e.target.value))} />
                  </div>
                  <div>
                    <Label>Horário</Label>
                    <Input type="time" value={form.charge_time || "10:00"} onChange={e => set("charge_time", e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBillingOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveBilling} disabled={updatePatient.isPending}>
              {updatePatient.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja excluir este paciente? Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deletePatient.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
