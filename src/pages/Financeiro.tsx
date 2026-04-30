import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  DollarSign, TrendingUp, AlertCircle, CheckCircle, Filter, Wallet,
  CalendarClock, Send, ArrowDownToLine, Search, FileText, Clock, Plus, User,
} from "lucide-react";
import PatientSearchSelect from "@/components/PatientSearchSelect";
import StatCard from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { accountsApi, type Account, type ConsolidatedCharge } from "@/lib/portalApi";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SessionsByPatient from "@/components/financeiro/SessionsByPatient";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const PERIODS = [
  { value: "this_month", label: "Este mês" },
  { value: "next_month", label: "Próximo mês" },
  { value: "last_month", label: "Mês passado" },
  { value: "open", label: "Em aberto" },
  { value: "overdue", label: "Vencidas" },
  { value: "all", label: "Todas" },
] as const;

const statusConfig: Record<string, { label: string; class: string }> = {
  paid: { label: "Pago", class: "bg-success/10 text-success border-success/20" },
  pending: { label: "Pendente", class: "bg-warning/10 text-warning border-warning/20" },
  overdue: { label: "Vencido", class: "bg-destructive/10 text-destructive border-destructive/20" },
  cancelled: { label: "Cancelado", class: "bg-muted text-muted-foreground" },
};

export default function Financeiro() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<string>("this_month");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [entryForm, setEntryForm] = useState({
    patientId: "", description: "", value: "", dueDate: new Date().toISOString().split("T")[0], type: "receivable" as "receivable" | "payable"
  });
  const [chargeData, setChargeData] = useState<{ charges: ConsolidatedCharge[]; totalAmount: number } | null>(null);

  const queryParams = useMemo(() => {
    const p: Record<string, string> = { type: "receivable" };
    if (period !== "all") p.period = period;
    if (statusFilter !== "all") p.status = statusFilter;
    if (selectedPatientId) p.patientId = selectedPatientId;
    return p;
  }, [period, statusFilter, selectedPatientId]);

  const { data: accountsData, isLoading } = useQuery({
    queryKey: ["accounts", queryParams],
    queryFn: () => accountsApi.list(queryParams),
  });

  const summaryMonth = useMemo(() => {
    const now = new Date();
    let d = now;
    if (period === "next_month") d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    else if (period === "last_month") d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    else if (period === "this_month" || period === "all" || period === "open" || period === "overdue") d = now;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, [period]);

  const { data: summary } = useQuery({
    queryKey: ["accounts-summary", summaryMonth],
    queryFn: () => accountsApi.summary(summaryMonth),
  });
  
  const { data: tabSummary } = useQuery({
    queryKey: ["accounts-tab-summary"],
    queryFn: () => accountsApi.tabSummary(),
  });

  const accounts = accountsData?.data || [];

  const filteredAccounts = useMemo(() => {
    if (!search) return accounts;
    const s = search.toLowerCase();
    return accounts.filter(a =>
      a.description.toLowerCase().includes(s) ||
      a.patient?.name?.toLowerCase().includes(s)
    );
  }, [accounts, search]);

  const totals = useMemo(() => {
    const open = filteredAccounts.filter(a => a.status === "pending" || a.status === "overdue");
    const paid = filteredAccounts.filter(a => a.status === "paid");
    return {
      openTotal: open.reduce((s, a) => s + Number(a.value), 0),
      openCount: open.length,
      paidTotal: paid.reduce((s, a) => s + Number(a.value), 0),
      paidCount: paid.length,
      overdueTotal: filteredAccounts.filter(a => a.status === "overdue").reduce((s, a) => s + Number(a.value), 0),
    };
  }, [filteredAccounts]);

  const selectedAccounts = filteredAccounts.filter(a => selected.has(a.id));
  const selectedTotal = selectedAccounts.reduce((s, a) => s + Number(a.value), 0);
  const selectedOpen = selectedAccounts.filter(a => a.status !== "paid" && a.status !== "cancelled");

  const toggle = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    const open = filteredAccounts.filter(a => a.status !== "paid" && a.status !== "cancelled");
    if (selected.size === open.length && open.length > 0) setSelected(new Set());
    else setSelected(new Set(open.map(a => a.id)));
  };

  const bulkPay = useMutation({
    mutationFn: (ids: string[]) => accountsApi.bulkPay({ ids, paymentMethod }),
    onSuccess: (res) => {
      toast.success(`${res.count} pagamento(s) baixado(s)`);
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts-summary"] });
      queryClient.invalidateQueries({ queryKey: ["accounts-tab-summary"] });
      setSelected(new Set());
      setPayDialogOpen(false);
    },
    onError: (e: any) => toast.error(e.message || "Erro ao baixar pagamentos"),
  });

  const bulkCharge = useMutation({
    mutationFn: (ids: string[]) => accountsApi.bulkCharge({ ids }),
    onSuccess: (res) => {
      setChargeData(res);
      setChargeDialogOpen(true);
    },
    onError: (e: any) => toast.error(e.message || "Erro ao gerar cobrança"),
  });

  const markPaid = useMutation({
    mutationFn: (id: string) => accountsApi.update(id, { status: "paid" }),
    onSuccess: () => {
      toast.success("Pagamento confirmado");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts-summary"] });
      queryClient.invalidateQueries({ queryKey: ["accounts-tab-summary"] });
    },
    onError: (e: any) => toast.error(e.message || "Erro"),
  });

  const createEntry = useMutation({
    mutationFn: (data: any) => accountsApi.create({ ...data, value: Number(data.value) }),
    onSuccess: () => {
      toast.success("Lançamento criado");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts-summary"] });
      queryClient.invalidateQueries({ queryKey: ["accounts-tab-summary"] });
      setEntryDialogOpen(false);
      setEntryForm({
        patientId: "", description: "", value: "", dueDate: new Date().toISOString().split("T")[0], type: "receivable"
      });
    },
    onError: (e: any) => toast.error(e.message || "Erro ao criar lançamento"),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Financeiro</h1>
          <p className="text-muted-foreground mt-1 text-sm">Gestão de cobranças, baixas e previsão</p>
        </div>
        <Button className="gradient-primary border-0 shadow-glow" onClick={() => setEntryDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> Novo Lançamento
        </Button>
      </div>

      <Tabs defaultValue="sessoes" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="sessoes">Sessões do Mês</TabsTrigger>
          <TabsTrigger value="cobrancas">Cobranças</TabsTrigger>
        </TabsList>

        <TabsContent value="sessoes" className="mt-6">
          <SessionsByPatient />
        </TabsContent>

        <TabsContent value="cobrancas" className="mt-6 space-y-6">

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

        <StatCard
          icon={Wallet}
          label={`A Receber (${PERIODS.find(p => p.value === period)?.label || "mês"})`}
          value={fmt(summary?.pendingReceivable ?? 0)}
          change={summary?.overdueReceivable ? `${fmt(summary.overdueReceivable)} vencido` : ""}
          changeType="negative"
        />
        <StatCard
          icon={CheckCircle}
          label={`Recebido (${PERIODS.find(p => p.value === period)?.label || "mês"})`}
          value={fmt(summary?.receivedAmount ?? 0)}
          change=""
          changeType="positive"
        />
        <StatCard
          icon={TrendingUp}
          label="Fluxo de Caixa"
          value={fmt(summary?.cashFlow ?? 0)}
          change=""
          changeType={(summary?.cashFlow ?? 0) >= 0 ? "positive" : "negative"}
        />
        <StatCard
          icon={AlertCircle}
          label={`A Pagar (${PERIODS.find(p => p.value === period)?.label || "mês"})`}
          value={fmt(summary?.pendingPayable ?? 0)}
          change=""
          changeType="negative"
        />
      </div>

      {/* Filter bar */}
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {PERIODS.map(p => {
              const stats = tabSummary?.[p.value];
              return (
                <Button
                  key={p.value}
                  size="sm"
                  variant={period === p.value ? "default" : "outline"}
                  onClick={() => setPeriod(p.value)}
                  className={`h-auto py-1.5 px-3 flex flex-col items-center gap-0.5 min-w-[100px] ${
                    period === p.value ? "gradient-primary border-0" : "hover:bg-accent/50"
                  }`}
                >
                  <span className="text-xs font-medium">{p.label}</span>
                  {stats && (
                    <span className={`text-[10px] ${period === p.value ? "text-white/80" : "text-muted-foreground"}`}>
                      {stats.count} · {fmt(stats.total)}
                    </span>
                  )}
                </Button>
              );
            })}
          </div>
          <div className="flex flex-col md:flex-row gap-3">
            <div className="w-full md:w-[280px]">
              <PatientSearchSelect 
                value={selectedPatientId} 
                onValueChange={setSelectedPatientId}
                placeholder="Filtrar por paciente..."
              />
            </div>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar paciente ou descrição..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="paid">Pago</SelectItem>
                <SelectItem value="overdue">Vencido</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="sticky top-2 z-10"
        >
          <Card className="border-primary/30 bg-primary/5 shadow-lg">
            <CardContent className="py-3 px-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Badge className="gradient-primary border-0">{selected.size} selecionado(s)</Badge>
                <span className="text-sm font-semibold text-foreground">
                  Total: {fmt(selectedTotal)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => bulkCharge.mutate(Array.from(selected))}
                  disabled={bulkCharge.isPending}
                >
                  <Send className="w-3.5 h-3.5 mr-1.5" />
                  Emitir Cobrança
                </Button>
                <Button
                  size="sm"
                  className="bg-success hover:bg-success/90 text-success-foreground border-0"
                  onClick={() => setPayDialogOpen(true)}
                  disabled={selectedOpen.length === 0}
                >
                  <ArrowDownToLine className="w-3.5 h-3.5 mr-1.5" />
                  Dar Baixa
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Limpar
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Accounts list */}
      <Card className="border-border/60">
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              Cobranças {totals.openCount > 0 && (
                <span className="text-xs text-muted-foreground font-normal">
                  · {totals.openCount} em aberto · {fmt(totals.openTotal)}
                </span>
              )}
            </CardTitle>
          </div>
          {filteredAccounts.length > 0 && (
            <Button variant="outline" size="sm" onClick={toggleAll}>
              {selected.size > 0 ? "Limpar" : "Selecionar abertas"}
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : filteredAccounts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nenhuma cobrança neste filtro.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredAccounts.map((a, idx) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  selected={selected.has(a.id)}
                  onToggle={() => toggle(a.id)}
                  onMarkPaid={() => markPaid.mutate(a.id)}
                  delay={idx * 0.015}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk Pay dialog */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowDownToLine className="w-5 h-5 text-success" /> Confirmar Recebimento
            </DialogTitle>
            <DialogDescription>
              {selectedOpen.length} cobrança(s) — Total: <strong className="text-foreground">{fmt(selectedOpen.reduce((s, a) => s + Number(a.value), 0))}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Forma de Pagamento</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pix">PIX</SelectItem>
                <SelectItem value="card">Cartão</SelectItem>
                <SelectItem value="cash">Dinheiro</SelectItem>
                <SelectItem value="insurance">Convênio</SelectItem>
                <SelectItem value="transfer">Transferência</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPayDialogOpen(false)}>Cancelar</Button>
            <Button
              className="bg-success hover:bg-success/90 text-success-foreground border-0"
              onClick={() => bulkPay.mutate(selectedOpen.map(a => a.id))}
              disabled={bulkPay.isPending}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Confirmar Pagamentos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Consolidated Charge dialog */}
      <Dialog open={chargeDialogOpen} onOpenChange={setChargeDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-5 h-5 text-primary" /> Cobranças Consolidadas
            </DialogTitle>
            <DialogDescription>
              {chargeData?.charges.length} paciente(s) — Total: <strong className="text-foreground">{fmt(chargeData?.totalAmount || 0)}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {chargeData?.charges.map((c, i) => (
              <Card key={i} className="border-primary/20">
                <CardContent className="pt-4 pb-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{c.patient?.name || "—"}</p>
                      {c.patient?.phone && <p className="text-xs text-muted-foreground">{c.patient.phone}</p>}
                    </div>
                    <span className="text-lg font-bold text-primary">{fmt(c.total)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    {c.items.map(it => (
                      <div key={it.id} className="flex justify-between">
                        <span className="truncate">{it.description}</span>
                        <span className="ml-2 shrink-0">{fmt(it.value)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => {
                      const txt = `*Cobrança ${c.patient?.name}*\n\n${c.items.map(it => `• ${it.description} — ${fmt(it.value)}`).join("\n")}\n\n*Total: ${fmt(c.total)}*`;
                      const phone = (c.patient?.phone || "").replace(/\D/g, "");
                      const url = phone
                        ? `https://wa.me/55${phone}?text=${encodeURIComponent(txt)}`
                        : `https://wa.me/?text=${encodeURIComponent(txt)}`;
                      window.open(url, "_blank");
                    }}>
                      Enviar via WhatsApp
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => {
                      const txt = `Cobrança ${c.patient?.name}\n\n${c.items.map(it => `• ${it.description} — ${fmt(it.value)}`).join("\n")}\n\nTotal: ${fmt(c.total)}`;
                      navigator.clipboard.writeText(txt);
                      toast.success("Cobrança copiada");
                    }}>
                      Copiar Texto
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setChargeDialogOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* New Entry Dialog */}
      <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" /> Novo Lançamento
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Paciente (opcional)</Label>
              <PatientSearchSelect 
                value={entryForm.patientId} 
                onValueChange={(id) => setEntryForm({ ...entryForm, patientId: id })} 
              />
            </div>
            <div>
              <Label>Descrição</Label>
              <Input 
                value={entryForm.description} 
                onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })} 
                placeholder="Ex: Sessão avulsa, Pacote 4 sessões..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valor (R$)</Label>
                <Input 
                  type="number" 
                  value={entryForm.value} 
                  onChange={(e) => setEntryForm({ ...entryForm, value: e.target.value })} 
                  placeholder="0,00"
                />
              </div>
              <div>
                <Label>Vencimento</Label>
                <Input 
                  type="date" 
                  value={entryForm.dueDate} 
                  onChange={(e) => setEntryForm({ ...entryForm, dueDate: e.target.value })} 
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEntryDialogOpen(false)}>Cancelar</Button>
            <Button 
              className="gradient-primary border-0" 
              onClick={() => createEntry.mutate(entryForm)}
              disabled={createEntry.isPending || !entryForm.description || !entryForm.value}
            >
              {createEntry.isPending ? "Salvando..." : "Criar Lançamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AccountRow({
  account: a, selected, onToggle, onMarkPaid, delay,
}: {
  account: Account; selected: boolean; onToggle: () => void; onMarkPaid: () => void; delay: number;
}) {
  const sc = statusConfig[a.status] || statusConfig.pending;
  const open = a.status !== "paid" && a.status !== "cancelled";
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay }}
      className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors ${selected ? "bg-primary/5" : ""}`}
    >
      <Checkbox checked={selected} onCheckedChange={onToggle} disabled={!open} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{a.description}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
              {a.patient?.name && <span>{a.patient.name}</span>}
              <span className="flex items-center gap-1">
                <CalendarClock className="w-3 h-3" />
                Vence {format(new Date(a.dueDate), "dd 'de' MMM", { locale: ptBR })}
              </span>
              {a.paidAt && (
                <span className="text-success flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Pago {format(new Date(a.paidAt), "dd/MM")}
                </span>
              )}
              {a.paymentMethod && <span className="capitalize">{a.paymentMethod}</span>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="font-semibold text-foreground">{fmt(Number(a.value))}</p>
            <Badge variant="outline" className={`text-[10px] mt-0.5 ${sc.class}`}>{sc.label}</Badge>
          </div>
          {open && (
            <Button
              variant="ghost"
              size="sm"
              className="text-success h-8 px-2"
              onClick={onMarkPaid}
              title="Dar baixa"
            >
              <CheckCircle className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
