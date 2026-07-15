import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Palette, Building2, Phone, Mail, MapPin, Save, Loader2, ImageIcon, Upload,
  UserPlus, Users, Power, PowerOff, Shield, CalendarIcon, Link2, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { orgSettingsApi, type OrgSettings } from "@/lib/portalApi";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
export default function Configuracoes() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const isProfessional = user?.role === "professional" || user?.role === "admin" || user?.role === "superadmin";
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Profile form
  const [profileForm, setProfileForm] = useState({
    name: user?.name || "",
    phone: user?.phone || "",
    crp: user?.crp || "",
    specialty: user?.specialty || "",
  });

  useEffect(() => {
    if (user) {
      setProfileForm({
        name: user.name || "",
        phone: (user as any).phone || "",
        crp: (user as any).crp || "",
        specialty: (user as any).specialty || "",
      });
    }
  }, [user]);

  const saveProfile = useMutation({
    mutationFn: () => apiRequest("/auth/profile", { method: "PATCH", body: profileForm }),
    onSuccess: () => {
      toast({ title: "Perfil atualizado!" });
      // Reload page to refresh auth context
      window.location.reload();
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const [form, setForm] = useState<Partial<OrgSettings>>({
    logo: "", primaryColor: "", secondaryColor: "", accentColor: "",
    businessName: "", businessPhone: "", businessEmail: "", businessAddress: "",
    allowPatientBooking: true, requireBookingApproval: false,
    sharedAgenda: false,
    scheduleStartHour: 8, scheduleEndHour: 19,
    patientBookingStartHour: 8, patientBookingEndHour: 18,
    sessionDuration: 50, bookingWeekdays: "1,2,3,4,5",
    timezone: "America/Sao_Paulo",
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ["org-settings"],
    queryFn: () => orgSettingsApi.get(),
  });

  useEffect(() => {
    if (settings) setForm({ ...settings });
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () => orgSettingsApi.update(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-settings"] });
      toast({ title: "Configurações salvas!" });
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const set = (field: keyof OrgSettings, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "Máximo 2MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      set("logo", reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Team management
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [teamForm, setTeamForm] = useState({ name: "", email: "", password: "", role: "professional", crp: "", phone: "", specialty: "" });

  const { data: teamData } = useQuery<{ data: any[]; total: number }>({
    queryKey: ["team"],
    queryFn: () => apiRequest("/team"),
    enabled: isProfessional,
  });

  const createTeamMember = useMutation({
    mutationFn: (data: any) => apiRequest("/team", { method: "POST", body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
      toast({ title: "Membro adicionado à equipe!" });
      setTeamDialogOpen(false);
      setTeamForm({ name: "", email: "", password: "", role: "professional", crp: "", phone: "", specialty: "" });
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const toggleTeamStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiRequest(`/team/${id}/status`, { method: "PATCH", body: { status } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
      toast({ title: "Status atualizado!" });
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const roleLabels: Record<string, string> = {
    admin: "Admin", professional: "Psicólogo(a)", secretary: "Secretária",
    financial: "Financeiro", secretary_financial: "Sec.+Fin.", superadmin: "Superadmin",
  };

  if (isLoading) return <div className="text-center py-16 text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Configurações</h1>
          <p className="text-sm text-muted-foreground">Seu perfil e personalização</p>
        </div>
      </div>

      {/* Meu Perfil - visible to ALL users */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5 text-primary" /> Meu Perfil</CardTitle>
                <CardDescription>Seus dados profissionais</CardDescription>
              </div>
              <Button size="sm" className="gap-2" onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}>
                {saveProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar Perfil
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Nome Completo</Label>
                <Input value={profileForm.name} onChange={e => setProfileForm({ ...profileForm, name: e.target.value })} />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input value={user?.email || ""} disabled className="opacity-60" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="flex items-center gap-1"><Phone className="w-3 h-3" /> Telefone / WhatsApp</Label>
                <Input value={profileForm.phone} onChange={e => setProfileForm({ ...profileForm, phone: e.target.value })} placeholder="(11) 99999-9999" />
              </div>
              {isProfessional && (
                <>
                  <div>
                    <Label>CRP</Label>
                    <Input value={profileForm.crp} onChange={e => setProfileForm({ ...profileForm, crp: e.target.value })} placeholder="CRP 06/123456" />
                  </div>
                  <div>
                    <Label>Especialidade</Label>
                    <Input value={profileForm.specialty} onChange={e => setProfileForm({ ...profileForm, specialty: e.target.value })} placeholder="TCC, Psicanálise..." />
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{roleLabels[user?.role || ""] || user?.role}</Badge>
              {user?.crp && <Badge variant="secondary">{user.crp}</Badge>}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Org Settings - visible to professionals+ */}
      {isProfessional && (
        <div className="flex items-end justify-end">
          <Button className="gap-2" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar Configurações
          </Button>
        </div>
      )}

      {isProfessional && (
      <div className="grid gap-6 md:grid-cols-2">
        {/* Identidade Visual */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Palette className="w-5 h-5 text-primary" /> Identidade Visual</CardTitle>
              <CardDescription>Personalize as cores e logo da sua clínica</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Logo Upload */}
              <div>
                <Label>Logo</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
                <div className="flex items-center gap-3 mt-1">
                  {form.logo ? (
                    <div className="relative group">
                      <img src={form.logo} alt="Logo" className="w-16 h-16 rounded-lg object-contain border border-border bg-muted p-1" />
                      <button
                        onClick={() => set("logo", "")}
                        className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >×</button>
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center bg-muted">
                      <ImageIcon className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="w-3.5 h-3.5 mr-1.5" />Enviar Logo
                    </Button>
                    <span className="text-xs text-muted-foreground">PNG, JPG ou SVG (máx. 2MB)</span>
                  </div>
                </div>
                <div className="mt-2">
                  <Label className="text-xs text-muted-foreground">Ou cole a URL:</Label>
                  <Input value={form.logo?.startsWith("data:") ? "" : form.logo || ""} onChange={e => set("logo", e.target.value)} placeholder="https://..." className="mt-1" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Cor Primária</Label>
                  <div className="flex gap-2">
                    <Input type="color" value={form.primaryColor || "#7c3aed"} onChange={e => set("primaryColor", e.target.value)} className="w-12 h-10 p-1 cursor-pointer" />
                    <Input value={form.primaryColor || ""} onChange={e => set("primaryColor", e.target.value)} placeholder="#7c3aed" className="flex-1" />
                  </div>
                </div>
                <div>
                  <Label>Cor Secundária</Label>
                  <div className="flex gap-2">
                    <Input type="color" value={form.secondaryColor || "#a78bfa"} onChange={e => set("secondaryColor", e.target.value)} className="w-12 h-10 p-1 cursor-pointer" />
                    <Input value={form.secondaryColor || ""} onChange={e => set("secondaryColor", e.target.value)} placeholder="#a78bfa" className="flex-1" />
                  </div>
                </div>
                <div>
                  <Label>Cor de Destaque</Label>
                  <div className="flex gap-2">
                    <Input type="color" value={form.accentColor || "#ec4899"} onChange={e => set("accentColor", e.target.value)} className="w-12 h-10 p-1 cursor-pointer" />
                    <Input value={form.accentColor || ""} onChange={e => set("accentColor", e.target.value)} placeholder="#ec4899" className="flex-1" />
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="p-4 rounded-xl border border-border" style={{
                background: `linear-gradient(135deg, ${form.primaryColor || '#7c3aed'}, ${form.secondaryColor || '#a78bfa'})`
              }}>
                <div className="flex items-center gap-3">
                  {form.logo ? (
                    <img src={form.logo} alt="Preview" className="w-10 h-10 rounded-lg object-contain bg-white/20 p-1" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
                      <ImageIcon className="w-5 h-5 text-white" />
                    </div>
                  )}
                  <div>
                    <p className="font-display font-bold text-white">{form.businessName || "Sua Clínica"}</p>
                    <p className="text-xs text-white/70">Preview da marca</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Dados da Clínica */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5 text-primary" /> Dados da Clínica</CardTitle>
              <CardDescription>Informações exibidas para pacientes e em relatórios</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Nome da Clínica / Profissional</Label>
                <Input value={form.businessName || ""} onChange={e => set("businessName", e.target.value)} placeholder="Clínica Psicologia Integrada" />
                <p className="text-xs text-muted-foreground mt-1">Este nome será exibido no app do paciente</p>
              </div>

              {/* Portal Slug */}
              <div>
                <Label className="flex items-center gap-1"><Link2 className="w-3 h-3" />Link do Portal (slug)</Label>
                <div className="flex gap-2 mt-1">
                  <div className="flex items-center bg-muted rounded-md px-3 text-xs text-muted-foreground whitespace-nowrap border border-border">
                    {window.location.origin}/p/
                  </div>
                  <Input
                    value={form.portalSlug || ""}
                    onChange={e => set("portalSlug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="minha-clinica"
                    className="font-mono text-sm"
                  />
                </div>
                {form.portalSlug && (
                  <div className="flex items-center gap-2 mt-2 p-2 bg-muted/50 rounded-lg">
                    <span className="text-xs text-muted-foreground truncate flex-1">
                      {window.location.origin}/p/{form.portalSlug}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/p/${form.portalSlug}`);
                        toast({ title: "Link copiado!" });
                      }}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">Este será o link de login dos seus pacientes e seu PWA</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="flex items-center gap-1"><Phone className="w-3 h-3" />Telefone</Label>
                  <Input value={form.businessPhone || ""} onChange={e => set("businessPhone", e.target.value)} placeholder="(11) 99999-9999" />
                </div>
                <div>
                  <Label className="flex items-center gap-1"><Mail className="w-3 h-3" />E-mail</Label>
                  <Input type="email" value={form.businessEmail || ""} onChange={e => set("businessEmail", e.target.value)} placeholder="contato@clinica.com" />
                </div>
              </div>
              <div>
                <Label className="flex items-center gap-1"><MapPin className="w-3 h-3" />Endereço</Label>
                <Input value={form.businessAddress || ""} onChange={e => set("businessAddress", e.target.value)} placeholder="Rua das Flores, 123" />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
      )}

      {/* Portal do Paciente + Horários */}
      {isProfessional && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarIcon className="w-5 h-5 text-primary" />
                Agendamento e Horários
              </CardTitle>
              <CardDescription>Configure os horários da sua agenda e do portal do paciente</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Toggle agendamento */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <p className="text-sm font-medium text-foreground">Agendamento pelo paciente</p>
                  <p className="text-xs text-muted-foreground">Permitir que pacientes agendem consultas pelo app</p>
                </div>
                <button
                  onClick={() => setForm(prev => ({ ...prev, allowPatientBooking: !prev.allowPatientBooking }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${form.allowPatientBooking ? 'bg-primary' : 'bg-muted'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.allowPatientBooking ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Toggle aprovação */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <p className="text-sm font-medium text-foreground">Aprovação obrigatória</p>
                  <p className="text-xs text-muted-foreground">Exigir aprovação do psicólogo para agendamentos feitos pelo paciente</p>
                </div>
                <button
                  onClick={() => setForm(prev => ({ ...prev, requireBookingApproval: !prev.requireBookingApproval }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${form.requireBookingApproval ? 'bg-primary' : 'bg-muted'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.requireBookingApproval ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Toggle agenda compartilhada (sala única) */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <p className="text-sm font-medium text-foreground">Agenda compartilhada (sala única)</p>
                  <p className="text-xs text-muted-foreground">Todos os profissionais da clínica veem a mesma agenda e o horário é bloqueado para todos quando alguém agenda — ideal quando há apenas 1 sala de atendimento.</p>
                </div>
                <button
                  onClick={() => setForm(prev => ({ ...prev, sharedAgenda: !prev.sharedAgenda }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${form.sharedAgenda ? 'bg-primary' : 'bg-muted'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.sharedAgenda ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>


              <div className="p-4 rounded-lg border border-border space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">🗓️ Horário da Agenda (Profissional / Secretária)</p>
                  <p className="text-xs text-muted-foreground">Horário visível para agendar consultas internamente</p>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs">Início</Label>
                    <Select value={String(form.scheduleStartHour ?? 8)} onValueChange={v => setForm(prev => ({ ...prev, scheduleStartHour: Number(v) }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 16 }, (_, i) => i + 5).map(h => (
                          <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Término</Label>
                    <Select value={String(form.scheduleEndHour ?? 19)} onValueChange={v => setForm(prev => ({ ...prev, scheduleEndHour: Number(v) }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 16 }, (_, i) => i + 8).map(h => (
                          <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Duração da sessão</Label>
                    <Select value={String(form.sessionDuration ?? 50)} onValueChange={v => setForm(prev => ({ ...prev, sessionDuration: Number(v) }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[30, 40, 45, 50, 60, 90, 120].map(d => (
                          <SelectItem key={d} value={String(d)}>{d} min</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Horários do paciente */}
              <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">📱 Horário visível para o Paciente</p>
                  <p className="text-xs text-muted-foreground">Faixa de horários que o paciente vê para agendar pelo app</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Início</Label>
                    <Select value={String(form.patientBookingStartHour ?? 8)} onValueChange={v => setForm(prev => ({ ...prev, patientBookingStartHour: Number(v) }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 16 }, (_, i) => i + 5).map(h => (
                          <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Término</Label>
                    <Select value={String(form.patientBookingEndHour ?? 18)} onValueChange={v => setForm(prev => ({ ...prev, patientBookingEndHour: Number(v) }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 16 }, (_, i) => i + 8).map(h => (
                          <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {/* Weekdays */}
                <div>
                  <Label className="text-xs">Dias da semana para agendamento</Label>
                  <div className="flex gap-1.5 mt-1">
                    {[
                      { day: 1, label: "Seg" }, { day: 2, label: "Ter" }, { day: 3, label: "Qua" },
                      { day: 4, label: "Qui" }, { day: 5, label: "Sex" }, { day: 6, label: "Sáb" }, { day: 0, label: "Dom" }
                    ].map(d => {
                      const weekdays = (form.bookingWeekdays || "1,2,3,4,5").split(",").map(Number);
                      const active = weekdays.includes(d.day);
                      return (
                        <button key={d.day} onClick={() => {
                          const current = (form.bookingWeekdays || "1,2,3,4,5").split(",").map(Number);
                          const updated = active ? current.filter(x => x !== d.day) : [...current, d.day];
                          setForm(prev => ({ ...prev, bookingWeekdays: updated.sort().join(",") }));
                        }}
                          className={`w-10 h-10 rounded-lg text-xs font-medium transition-all border ${
                            active ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/50"
                          }`}
                        >{d.label}</button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Timezone */}
              <div className="p-4 rounded-lg border border-border space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">🌐 Fuso Horário</p>
                  <p className="text-xs text-muted-foreground">Defina o fuso horário da sua clínica</p>
                </div>
                <Select value={form.timezone || "America/Sao_Paulo"} onValueChange={v => setForm(prev => ({ ...prev, timezone: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/Sao_Paulo">São Paulo (BRT, UTC-3)</SelectItem>
                    <SelectItem value="America/Manaus">Manaus (AMT, UTC-4)</SelectItem>
                    <SelectItem value="America/Belem">Belém (BRT, UTC-3)</SelectItem>
                    <SelectItem value="America/Fortaleza">Fortaleza (BRT, UTC-3)</SelectItem>
                    <SelectItem value="America/Recife">Recife (BRT, UTC-3)</SelectItem>
                    <SelectItem value="America/Bahia">Salvador (BRT, UTC-3)</SelectItem>
                    <SelectItem value="America/Cuiaba">Cuiabá (AMT, UTC-4)</SelectItem>
                    <SelectItem value="America/Campo_Grande">Campo Grande (AMT, UTC-4)</SelectItem>
                    <SelectItem value="America/Rio_Branco">Rio Branco (ACT, UTC-5)</SelectItem>
                    <SelectItem value="America/Noronha">Fernando de Noronha (FNT, UTC-2)</SelectItem>
                    <SelectItem value="America/Porto_Velho">Porto Velho (AMT, UTC-4)</SelectItem>
                    <SelectItem value="America/Boa_Vista">Boa Vista (AMT, UTC-4)</SelectItem>
                    <SelectItem value="America/Buenos_Aires">Buenos Aires (ART, UTC-3)</SelectItem>
                    <SelectItem value="America/Santiago">Santiago (CLT, UTC-4)</SelectItem>
                    <SelectItem value="America/Bogota">Bogotá (COT, UTC-5)</SelectItem>
                    <SelectItem value="America/Lima">Lima (PET, UTC-5)</SelectItem>
                    <SelectItem value="America/New_York">Nova York (EST, UTC-5)</SelectItem>
                    <SelectItem value="Europe/Lisbon">Lisboa (WET, UTC+0)</SelectItem>
                    <SelectItem value="Europe/London">Londres (GMT, UTC+0)</SelectItem>
                    <SelectItem value="Europe/Paris">Paris (CET, UTC+1)</SelectItem>
                    <SelectItem value="Asia/Tokyo">Tóquio (JST, UTC+9)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button size="sm" className="gap-1" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Salvar Configurações de Horário
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {isProfessional && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> Equipe</CardTitle>
                  <CardDescription>Gerencie psicólogos, secretárias e financeiros da sua organização</CardDescription>
                </div>
                <Button size="sm" onClick={() => setTeamDialogOpen(true)}>
                  <UserPlus className="w-4 h-4 mr-2" />Novo Membro
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!teamData?.data?.length ? (
                <p className="text-sm text-muted-foreground text-center py-6">Nenhum membro na equipe ainda</p>
              ) : (
                <div className="space-y-2">
                  {teamData.data.map((member: any) => (
                    <div key={member.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-xs font-bold text-primary">
                            {member.name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{member.name}</p>
                            <Badge variant="outline" className="text-xs">{roleLabels[member.role] || member.role}</Badge>
                            <Badge variant={member.status === "active" ? "default" : "secondary"} className="text-xs">
                              {member.status === "active" ? "Ativo" : "Inativo"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {member.email}
                            {member.crp && <> · <span className="text-primary">{member.crp}</span></>}
                            {member.specialty && <> · {member.specialty}</>}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleTeamStatus.mutate({ id: member.id, status: member.status === "active" ? "inactive" : "active" })}
                      >
                        {member.status === "active" ? <PowerOff className="w-4 h-4 text-destructive" /> : <Power className="w-4 h-4 text-green-600" />}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Create Team Member Dialog */}
          <Dialog open={teamDialogOpen} onOpenChange={setTeamDialogOpen}>
            <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
              <DialogHeader>
                <DialogTitle>Novo Membro da Equipe</DialogTitle>
                <DialogDescription>Adicione um psicólogo, secretária ou financeiro à sua organização</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Nome *</Label>
                    <Input value={teamForm.name} onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} placeholder="Nome completo" />
                  </div>
                  <div>
                    <Label>Email *</Label>
                    <Input type="email" value={teamForm.email} onChange={(e) => setTeamForm({ ...teamForm, email: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Senha *</Label>
                    <Input type="password" value={teamForm.password} onChange={(e) => setTeamForm({ ...teamForm, password: e.target.value })} />
                  </div>
                  <div>
                    <Label>Perfil *</Label>
                    <Select value={teamForm.role} onValueChange={(v) => setTeamForm({ ...teamForm, role: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="professional">Psicólogo(a)</SelectItem>
                        <SelectItem value="secretary">Secretária</SelectItem>
                        <SelectItem value="financial">Financeiro</SelectItem>
                        <SelectItem value="secretary_financial">Secretária + Financeiro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {teamForm.role === "professional" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>CRP</Label>
                      <Input value={teamForm.crp} onChange={(e) => setTeamForm({ ...teamForm, crp: e.target.value })} placeholder="CRP 06/123456" />
                    </div>
                    <div>
                      <Label>Especialidade</Label>
                      <Input value={teamForm.specialty} onChange={(e) => setTeamForm({ ...teamForm, specialty: e.target.value })} placeholder="TCC, Psicanálise..." />
                    </div>
                  </div>
                )}
                <div>
                  <Label>Telefone</Label>
                  <Input value={teamForm.phone} onChange={(e) => setTeamForm({ ...teamForm, phone: e.target.value })} placeholder="(11) 99999-9999" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTeamDialogOpen(false)}>Cancelar</Button>
                <Button
                  onClick={() => createTeamMember.mutate({
                    ...teamForm,
                    crp: teamForm.crp || undefined,
                    phone: teamForm.phone || undefined,
                    specialty: teamForm.specialty || undefined,
                  })}
                  disabled={createTeamMember.isPending || !teamForm.name || !teamForm.email || !teamForm.password}
                >
                  {createTeamMember.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Criar Membro
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </motion.div>
      )}
    </div>
  );
}
