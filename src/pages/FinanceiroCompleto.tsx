import { useState, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DollarSign, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  Plus, CheckCircle, AlertCircle, Clock, Wallet, Download,
  MoreHorizontal, Edit, Trash2, PiggyBank, FileText,
  Users, Calendar, ChevronLeft, ChevronRight, Loader2, Receipt,
  Upload, Search, Filter
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import StatCard from "@/components/StatCard";
import { accountsApi, type Account, type AccountsSummary } from "@/lib/portalApi";
import { invoicesApi, pacientesApi, importApi, type Patient } from "@/lib/api";
import { usePatients } from "@/hooks/usePatients";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const statusConfig: Record<string, { label: string; class: string; icon: typeof CheckCircle }> = {
  pending: { label: "Pendente", class: "bg-warning/10 text-warning", icon: Clock },
  paid: { label: "Pago", class: "bg-green-500/10 text-green-600", icon: CheckCircle },
  overdue: { label: "Vencido", class: "bg-destructive/10 text-destructive", icon: AlertCircle },
  cancelled: { label: "Cancelado", class: "bg-muted text-muted-foreground", icon: AlertCircle },
};

const categories = [
  "Consulta", "Aluguel", "Materiais", "Software", "Marketing",
  "Salário", "Impostos", "Manutenção", "Outros"
];

export default function FinanceiroCompleto() {
  const qc = useQueryClient();
  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [tab, setTab] = useState("overview");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoiceDesc, setInvoiceDesc] = useState("");
  const [form, setForm] = useState<Partial<Account>>({
    type: "receivable", description: "", value: 0, dueDate: "",
    category: "", paymentMethod: "", notes: "", status: "pending"
  });
  const [importOpen, setImportOpen] = useState(false);
  const [importBankName, setImportBankName] = useState("");
  const [dateFilterStart, setDateFilterStart] = useState("");
  const [dateFilterEnd, setDateFilterEnd] = useState("");
  const [showDateFilter, setShowDateFilter] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: patients = [] } = usePatients();
  const patientList: Patient[] = Array.isArray(patients) ? patients : (patients as any)?.data || [];

  // Monthly report
  const { data: report, isLoading: reportLoading, isError: reportError, refetch: refetchReport } = useQuery({
    queryKey: ["monthly-report", currentMonth],
    queryFn: () => invoicesApi.monthlyReport(currentMonth),
    retry: 1,
  });

  // Accounts list per tab
  const accountType = tab === "payable" ? "payable" : "receivable";
  const { data: accountsData, isLoading: accLoading } = useQuery({
    queryKey: ["accounts", accountType, currentMonth],
    queryFn: () => accountsApi.list({ 
      type: accountType,
      period: currentMonth // Passando o mês selecionado para a API
    }),
    enabled: tab === "receivable" || tab === "payable",
  });

  // Patient sessions for invoice
  const { data: patientSessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ["patient-sessions", selectedPatientId],
    queryFn: () => invoicesApi.patientSessions(selectedPatientId, { unbilledOnly: "true" }),
    enabled: !!selectedPatientId && invoiceOpen,
  });

  const saveMutation = useMutation({
    mutationFn: (data: Partial<Account>) =>
      editId ? accountsApi.update(editId, data) : accountsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["monthly-report"] });
      toast({ title: editId ? "Conta atualizada!" : "Conta criada!" });
      closeDialog();
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => accountsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["monthly-report"] });
      toast({ title: "Conta removida" });
    },
  });

  const markPaid = useMutation({
    mutationFn: (id: string) => accountsApi.update(id, { status: "paid" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["monthly-report"] });
      toast({ title: "Baixa realizada!" });
    },
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: () => invoicesApi.generate({
      patientId: selectedPatientId,
      sessionIds: selectedSessions,
      description: invoiceDesc,
      dueDate: invoiceDueDate,
    }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["monthly-report"] });
      qc.invalidateQueries({ queryKey: ["patient-sessions"] });
      toast({ title: `Fatura gerada: ${fmt(data.totalValue)} (${data.sessions.length} sessões)` });
      setInvoiceOpen(false);
      setSelectedSessions([]);
      // Trigger PDF download
      generatePdfReport(data);
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const ext = file.name.split('.').pop()?.toLowerCase();

      if (ext === 'ofx' || ext === 'ofc') {
        return importApi.ofx({ content: text, bankName: importBankName });
      }

      // CSV parsing
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) throw new Error('Arquivo CSV vazio ou inválido');
      
      const header = lines[0].split(/[,;]/).map(h => h.trim().toLowerCase().replace(/"/g, ''));
      const dateCol = header.findIndex(h => ['data', 'date', 'dt', 'data_lancamento'].includes(h));
      const descCol = header.findIndex(h => ['descricao', 'descrição', 'description', 'desc', 'historico', 'histórico', 'memo'].includes(h));
      const valueCol = header.findIndex(h => ['valor', 'value', 'amount', 'vlr', 'quantia'].includes(h));

      if (valueCol === -1) throw new Error('Coluna de valor não encontrada. Use: valor, value ou amount');

      const rows = lines.slice(1).map(line => {
        const cols = line.split(/[,;]/).map(c => c.trim().replace(/"/g, ''));
        return {
          date: dateCol >= 0 ? cols[dateCol] : new Date().toISOString().slice(0, 10),
          description: descCol >= 0 ? cols[descCol] : 'Transação importada',
          value: cols[valueCol]?.replace(/[R$\s.]/g, '').replace(',', '.') || '0',
        };
      }).filter(r => parseFloat(r.value) !== 0);

      return importApi.csv({ rows, bankName: importBankName });
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["monthly-report"] });
      toast({ 
        title: "Importação concluída!",
        description: `${data.imported} transações importadas${data.balance != null ? `. Saldo: R$ ${data.balance.toFixed(2)}` : ''}`,
      });
      setImportOpen(false);
      setImportBankName("");
    },
    onError: (err: Error) => toast({ title: "Erro na importação", description: err.message, variant: "destructive" }),
  });

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importMutation.mutate(file);
    e.target.value = '';
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditId(null);
    setForm({ type: "receivable", description: "", value: 0, dueDate: "", category: "", paymentMethod: "", notes: "", status: "pending" });
  };

  const openNew = (type: "receivable" | "payable") => {
    setForm({ ...form, type });
    setEditId(null);
    setDialogOpen(true);
  };

  const openEdit = (acc: Account) => {
    setEditId(acc.id);
    setForm({ ...acc, dueDate: acc.dueDate?.split("T")[0] || "" });
    setDialogOpen(true);
  };

  const handleSave = () => saveMutation.mutate(form);
  const set = (field: keyof Account, value: unknown) => setForm(prev => ({ ...prev, [field]: value }));
  const fmt = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const accounts = accountsData?.data || [];

  // Month navigation
  const prevMonth = () => {
    const [y, m] = currentMonth.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const nextMonth = () => {
    const [y, m] = currentMonth.split("-").map(Number);
    const d = new Date(y, m, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const monthLabel = useMemo(() => {
    const [y, m] = currentMonth.split("-").map(Number);
    return format(new Date(y, m - 1, 1), "MMMM yyyy", { locale: ptBR });
  }, [currentMonth]);

  // Toggle session selection
  const toggleSession = (id: string) => {
    setSelectedSessions(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };
  const toggleAll = () => {
    if (selectedSessions.length === patientSessions.length) setSelectedSessions([]);
    else setSelectedSessions(patientSessions.map((s: any) => s.id));
  };

  // Calculate selected total
  const selectedTotal = useMemo(() => {
    return patientSessions
      .filter((s: any) => selectedSessions.includes(s.id))
      .reduce((sum: number, s: any) => {
        const val = s.patient?.sessionValue ? Number(s.patient.sessionValue) : (s.value ? Number(s.value) : 0);
        return sum + val;
      }, 0);
  }, [selectedSessions, patientSessions]);

  // Generate PDF invoice report
  const generatePdfReport = (invoiceData: any) => {
    const patient = patientList.find(p => p.id === selectedPatientId);
    const patientName = patient?.name || invoiceData.sessions?.[0]?.patientName || "Paciente";

    const lines = [
      `RELATÓRIO DE COBRANÇA`,
      ``,
      `Paciente: ${patientName}`,
      `Data de emissão: ${new Date().toLocaleDateString("pt-BR")}`,
      `Vencimento: ${invoiceDueDate ? new Date(invoiceDueDate + "T12:00:00").toLocaleDateString("pt-BR") : "À vista"}`,
      ``,
      `${"─".repeat(60)}`,
      `SESSÕES`,
      `${"─".repeat(60)}`,
    ];

    (invoiceData.sessions || []).forEach((s: any, i: number) => {
      const dt = new Date(s.date);
      lines.push(
        `${i + 1}. ${dt.toLocaleDateString("pt-BR")} às ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} - ${s.type === "couple" ? "Casal" : "Individual"} (${s.duration || 50}min) - ${fmt(s.value)}`
      );
    });

    lines.push(`${"─".repeat(60)}`);
    lines.push(`TOTAL: ${fmt(invoiceData.totalValue)}`);
    lines.push(`Sessões: ${invoiceData.sessions?.length || 0}`);
    lines.push(`${"─".repeat(60)}`);
    lines.push(``);
    lines.push(`Documento gerado automaticamente pelo Psico Gleego.`);

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cobranca_${patientName.replace(/\s+/g, "_")}_${currentMonth}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export monthly report as text
  const exportMonthlyReport = () => {
    if (!report) {
      toast({ title: "Erro", description: "Dados do relatório não disponíveis. Tente recarregar a página.", variant: "destructive" });
      refetchReport();
      return;
    }
    const lines = [
      `RELATÓRIO FINANCEIRO MENSAL`,
      `Período: ${monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}`,
      `Gerado em: ${new Date().toLocaleDateString("pt-BR")}`,
      ``,
      `═══════════════════════════════════`,
      `RESUMO`,
      `═══════════════════════════════════`,
      `Receita Total: ${fmt(report.revenue?.total || 0)}`,
      `  ├ Recebido: ${fmt(report.revenue?.received || 0)}`,
      `  ├ Pendente: ${fmt(report.revenue?.pending || 0)}`,
      `  └ Vencido: ${fmt(report.revenue?.overdue || 0)}`,
      ``,
      `Despesas Total: ${fmt(report.expenses?.total || 0)}`,
      `  ├ Pago: ${fmt(report.expenses?.paid || 0)}`,
      `  └ Pendente: ${fmt(report.expenses?.pending || 0)}`,
      ``,
      `Fluxo de Caixa: ${fmt(report.cashFlow || 0)}`,
      `Receita Futura: ${fmt(report.futureRevenue || 0)}`,
      `Total de Sessões: ${report.sessionCount || 0}`,
      ``,
      `═══════════════════════════════════`,
      `RECEITA POR PACIENTE`,
      `═══════════════════════════════════`,
    ];

    (report.patientBreakdown || []).forEach((p: any) => {
      lines.push(`\n${p.patientName} (${p.billingMode === "monthly" ? "Mensal" : "Por Sessão"})`);
      lines.push(`  Sessões: ${p.sessions?.length || 0} | Total: ${fmt(p.totalValue)}`);
      (p.sessions || []).forEach((s: any, i: number) => {
        const dt = new Date(s.date);
        lines.push(`    ${i + 1}. ${dt.toLocaleDateString("pt-BR")} ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} - ${fmt(s.value)}`);
      });
    });

    if ((report.accounts || []).length > 0) {
      lines.push(``);
      lines.push(`═══════════════════════════════════`);
      lines.push(`LANÇAMENTOS DO MÊS`);
      lines.push(`═══════════════════════════════════`);
      (report.accounts || []).forEach((a: any) => {
        const statusLabel = a.status === "paid" ? "✓ Pago" : a.status === "overdue" ? "⚠ Vencido" : "○ Pendente";
        const typeLabel = a.type === "receivable" ? "Receita" : "Despesa";
        lines.push(`  ${typeLabel} | ${a.description} | ${fmt(a.value)} | ${statusLabel} | ${a.dueDate ? new Date(a.dueDate).toLocaleDateString("pt-BR") : "-"}`);
      });
    }

    lines.push(``);
    lines.push(`Documento gerado automaticamente pelo Psico Gleego.`);

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio_financeiro_${currentMonth}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Relatório exportado!", description: `relatorio_financeiro_${currentMonth}.txt` });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Financeiro</h1>
          <p className="text-muted-foreground mt-1">Receitas, despesas, faturas e fluxo de caixa</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setShowDateFilter(!showDateFilter)}>
            <Filter className="w-4 h-4 mr-2" />Filtros
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="w-4 h-4 mr-2" />Importar
          </Button>
          <Button variant="outline" size="sm" onClick={exportMonthlyReport} disabled={reportLoading}>
            {reportLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            {reportError ? "Tentar Novamente" : "Relatório"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setInvoiceOpen(true)}>
            <Receipt className="w-4 h-4 mr-2" />Gerar Fatura
          </Button>
          <Button onClick={() => openNew("receivable")} size="sm" className="gap-2">
            <Plus className="w-4 h-4" />Nova Entrada
          </Button>
          <Button onClick={() => openNew("payable")} size="sm" variant="outline" className="gap-2">
            <Plus className="w-4 h-4" />Nova Saída
          </Button>
        </div>
      </div>

      {/* Date Range Filter */}
      {showDateFilter && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="overflow-hidden">
          <Card className="border-primary/20">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-end gap-4 flex-wrap">
                <div>
                  <Label className="text-xs text-muted-foreground">Data Inicial</Label>
                  <Input type="date" value={dateFilterStart} onChange={e => setDateFilterStart(e.target.value)} className="w-40" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Data Final</Label>
                  <Input type="date" value={dateFilterEnd} onChange={e => setDateFilterEnd(e.target.value)} className="w-40" />
                </div>
                <Button size="sm" variant="outline" onClick={() => { setDateFilterStart(""); setDateFilterEnd(""); }}>
                  Limpar
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Month Navigator */}
      <div className="flex items-center justify-center gap-4">
        <Button variant="ghost" size="icon" onClick={prevMonth}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <span className="text-lg font-semibold text-foreground capitalize min-w-[180px] text-center">
          {monthLabel}
        </span>
        <Button variant="ghost" size="icon" onClick={nextMonth}>
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {reportLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : (
          <>
            <StatCard icon={ArrowUpRight} label="Receita do Mês" value={fmt(report?.revenue?.total ?? 0)} change={`${fmt(report?.revenue?.received ?? 0)} recebido`} changeType="positive" />
            <StatCard icon={ArrowDownRight} label="Despesas" value={fmt(report?.expenses?.total ?? 0)} change={`${fmt(report?.expenses?.paid ?? 0)} pago`} changeType="negative" />
            <StatCard icon={Wallet} label="Fluxo de Caixa" value={fmt(report?.cashFlow ?? 0)} changeType={(report?.cashFlow ?? 0) >= 0 ? "positive" : "negative"} change="Entradas - Saídas" />
            <StatCard icon={TrendingUp} label="Receita Futura" value={fmt(report?.futureRevenue ?? 0)} change="Próximos 3 meses" changeType="positive" />
            <StatCard icon={AlertCircle} label="Vencido" value={fmt(report?.revenue?.overdue ?? 0)} change={`${fmt(report?.revenue?.pending ?? 0)} pendente`} changeType="negative" />
          </>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full md:w-auto">
          <TabsTrigger value="overview" className="gap-2">
            <DollarSign className="w-4 h-4" />Visão Geral
          </TabsTrigger>
          <TabsTrigger value="receivable" className="gap-2">
            <ArrowUpRight className="w-4 h-4" />A Receber
          </TabsTrigger>
          <TabsTrigger value="payable" className="gap-2">
            <ArrowDownRight className="w-4 h-4" />A Pagar
          </TabsTrigger>
          <TabsTrigger value="patients" className="gap-2">
            <Users className="w-4 h-4" />Por Paciente
          </TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {reportLoading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
          ) : (
            <>
              {/* Recent transactions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Movimentações do Mês</CardTitle>
                </CardHeader>
                <CardContent>
                  {(report?.accounts || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">Nenhuma movimentação neste mês</p>
                  ) : (
                    <div className="space-y-2">
                      {(report?.accounts || []).slice(0, 15).map((acc: any) => {
                        const sc = statusConfig[acc.status] || statusConfig.pending;
                        return (
                          <div key={acc.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                            <div className="flex items-center gap-3">
                              {acc.type === "receivable" ? (
                                <ArrowUpRight className="w-4 h-4 text-green-600" />
                              ) : (
                                <ArrowDownRight className="w-4 h-4 text-destructive" />
                              )}
                              <div>
                                <p className="text-sm font-medium text-foreground">{acc.description}</p>
                                <p className="text-xs text-muted-foreground">
                                  {acc.patientName || acc.category || "—"} • {acc.dueDate ? new Date(acc.dueDate).toLocaleDateString("pt-BR") : "—"}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sc.class}`}>{sc.label}</span>
                              <span className={`text-sm font-semibold ${acc.type === "receivable" ? "text-green-600" : "text-destructive"}`}>
                                {acc.type === "payable" ? "- " : ""}{fmt(acc.value)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Receivable / Payable tabs */}
        {["receivable", "payable"].map(t => (
          <TabsContent key={t} value={t} className="mt-4">
            <div className="flex justify-end mb-3">
              <Button size="sm" onClick={() => openNew(t as "receivable" | "payable")}>
                <Plus className="w-4 h-4 mr-2" />Nova {t === "receivable" ? "Receita" : "Despesa"}
              </Button>
            </div>
            {accLoading ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
            ) : accounts.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <PiggyBank className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p>Nenhuma conta {t === "receivable" ? "a receber" : "a pagar"}</p>
              </div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">Descrição</th>
                      <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">Paciente</th>
                      <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">Vencimento</th>
                      <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">Valor</th>
                      <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">Categoria</th>
                      <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">Status</th>
                      <th className="px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {accounts.map((acc) => {
                      const sc = statusConfig[acc.status] || statusConfig.pending;
                      return (
                        <tr key={acc.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-5 py-3.5 text-sm font-medium text-foreground">{acc.description}</td>
                          <td className="px-5 py-3.5 text-sm text-muted-foreground">{acc.patient?.name || "—"}</td>
                          <td className="px-5 py-3.5 text-sm text-muted-foreground">
                            {acc.dueDate ? new Date(acc.dueDate).toLocaleDateString("pt-BR") : "—"}
                          </td>
                          <td className="px-5 py-3.5 text-sm font-semibold text-foreground">{fmt(acc.value)}</td>
                          <td className="px-5 py-3.5 text-sm text-muted-foreground">{acc.category || "—"}</td>
                          <td className="px-5 py-3.5">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${sc.class}`}>{sc.label}</span>
                          </td>
                          <td className="px-5 py-3.5">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="p-1 rounded hover:bg-muted"><MoreHorizontal className="w-4 h-4 text-muted-foreground" /></button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {acc.status === "pending" && (
                                  <DropdownMenuItem onClick={() => markPaid.mutate(acc.id)}>
                                    <CheckCircle className="w-4 h-4 mr-2" />Dar Baixa
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => openEdit(acc)}>
                                  <Edit className="w-4 h-4 mr-2" />Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive" onClick={() => deleteMutation.mutate(acc.id)}>
                                  <Trash2 className="w-4 h-4 mr-2" />Excluir
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </motion.div>
            )}
          </TabsContent>
        ))}

        {/* By Patient Tab */}
        <TabsContent value="patients" className="mt-4">
          {reportLoading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
          ) : (report?.patientBreakdown || []).length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>Nenhuma sessão registrada neste mês</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {(report?.patientBreakdown || []).map((p: any) => (
                <motion.div key={p.patientId} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{p.patientName}</CardTitle>
                        <Badge variant={p.billingMode === "monthly" ? "default" : "outline"} className="text-xs">
                          {p.billingMode === "monthly" ? "Mensal" : "Por Sessão"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="w-4 h-4" />
                          {p.sessions?.length || 0} sessões
                        </div>
                        <span className="text-lg font-bold text-foreground">{fmt(p.totalValue)}</span>
                      </div>
                      <div className="space-y-1">
                        {(p.sessions || []).map((s: any, i: number) => {
                          const dt = new Date(s.date);
                          return (
                            <div key={s.id || i} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                              <span className="text-muted-foreground">
                                {dt.toLocaleDateString("pt-BR")} {dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                              <span className="font-medium text-foreground">{fmt(s.value)}</span>
                            </div>
                          );
                        })}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-3 gap-2"
                        onClick={() => {
                          setSelectedPatientId(p.patientId);
                          setInvoiceOpen(true);
                          setSelectedSessions([]);
                          setInvoiceDesc("");
                          setInvoiceDueDate("");
                        }}
                      >
                        <Receipt className="w-3.5 h-3.5" />Gerar Fatura
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create/Edit Account Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v) closeDialog(); else setDialogOpen(true); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar Conta" : `Nova ${form.type === "receivable" ? "Receita" : "Despesa"}`}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {!editId && (
              <div>
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={v => set("type", v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="receivable">Receita (A Receber)</SelectItem>
                    <SelectItem value="payable">Despesa (A Pagar)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Descrição *</Label>
              <Input value={form.description} onChange={e => set("description", e.target.value)} placeholder="Consulta individual" />
            </div>
            {form.type === "receivable" && (
              <div>
                <Label>Paciente</Label>
                <Select value={(form as any).patientId || ""} onValueChange={v => set("patientId" as any, v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione (opcional)" /></SelectTrigger>
                  <SelectContent>
                    {patientList.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Valor (R$) *</Label>
                <Input type="number" step="0.01" value={form.value} onChange={e => set("value", parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <Label>Vencimento *</Label>
                <Input type="date" value={form.dueDate} onChange={e => set("dueDate", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Categoria</Label>
                <Select value={form.category || ""} onValueChange={v => set("category", v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Pagamento</Label>
                <Select value={form.paymentMethod || ""} onValueChange={v => set("paymentMethod", v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pix">Pix</SelectItem>
                    <SelectItem value="card">Cartão</SelectItem>
                    <SelectItem value="cash">Dinheiro</SelectItem>
                    <SelectItem value="transfer">Transferência</SelectItem>
                    <SelectItem value="insurance">Convênio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={form.notes || ""} onChange={e => set("notes", e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending || !form.description || !form.value || !form.dueDate}>
              {saveMutation.isPending ? "Salvando..." : editId ? "Atualizar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate Invoice Dialog */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-primary" />
              Gerar Fatura / Cobrança
            </DialogTitle>
            <DialogDescription>
              Selecione as sessões para agrupar em uma fatura. O relatório será gerado automaticamente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label>Paciente *</Label>
              <Select value={selectedPatientId} onValueChange={(v) => { setSelectedPatientId(v); setSelectedSessions([]); }}>
                <SelectTrigger><SelectValue placeholder="Selecione o paciente" /></SelectTrigger>
                <SelectContent>
                  {patientList.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.billing_mode === "monthly" && <Badge variant="outline" className="ml-2 text-[10px]">Mensal</Badge>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedPatientId && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Descrição da Fatura</Label>
                    <Input value={invoiceDesc} onChange={e => setInvoiceDesc(e.target.value)} placeholder="Ex: Sessões de março/2026" />
                  </div>
                  <div>
                    <Label>Vencimento</Label>
                    <Input type="date" value={invoiceDueDate} onChange={e => setInvoiceDueDate(e.target.value)} />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-medium">Sessões não faturadas</Label>
                    {patientSessions.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs h-7">
                        {selectedSessions.length === patientSessions.length ? "Desmarcar Todas" : "Selecionar Todas"}
                      </Button>
                    )}
                  </div>

                  {sessionsLoading ? (
                    <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
                  ) : patientSessions.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground bg-muted/30 rounded-lg">
                      <Calendar className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">Nenhuma sessão não faturada encontrada</p>
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-[300px] overflow-y-auto border border-border rounded-lg">
                      {patientSessions.map((s: any) => {
                        const dt = new Date(s.date);
                        const val = s.patient?.sessionValue ? Number(s.patient.sessionValue) : (s.value ? Number(s.value) : 0);
                        const checked = selectedSessions.includes(s.id);
                        return (
                          <label
                            key={s.id}
                            className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                              checked ? "bg-primary/5" : "hover:bg-muted/30"
                            } border-b border-border/50 last:border-0`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleSession(s.id)}
                            />
                            <div className="flex-1 flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium text-foreground">
                                  {dt.toLocaleDateString("pt-BR")} às {dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {s.type === "couple" ? "Casal" : "Individual"} • {s.duration || 50}min
                                </p>
                              </div>
                              <span className="text-sm font-semibold text-foreground">{fmt(val)}</span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {selectedSessions.length > 0 && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-primary/5 border border-primary/20 rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">{selectedSessions.length} sessões selecionadas</p>
                        <p className="text-xs text-muted-foreground">Fatura será gerada como conta a receber</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-primary">{fmt(selectedTotal)}</p>
                        <p className="text-xs text-muted-foreground">Total da fatura</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => generateInvoiceMutation.mutate()}
              disabled={generateInvoiceMutation.isPending || !selectedPatientId || selectedSessions.length === 0}
              className="gap-2"
            >
              {generateInvoiceMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileText className="w-4 h-4" />
              )}
              Gerar Fatura e Relatório
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-primary" />
              Importar Extrato Bancário
            </DialogTitle>
            <DialogDescription>
              Importe arquivos CSV ou OFX do seu banco. Valores positivos serão lançados como entradas e negativos como saídas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nome do Banco (opcional)</Label>
              <Input value={importBankName} onChange={e => setImportBankName(e.target.value)} placeholder="Ex: Itaú, Bradesco, Nubank..." />
            </div>
            <div className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary/50 transition-colors">
              <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">Arraste ou clique para selecionar</p>
              <p className="text-xs text-muted-foreground mb-4">Formatos aceitos: CSV, OFX</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.ofx,.ofc"
                onChange={handleFileImport}
                className="hidden"
              />
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importMutation.isPending}>
                {importMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                {importMutation.isPending ? "Importando..." : "Selecionar Arquivo"}
              </Button>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs font-medium text-foreground mb-1">Formato CSV esperado:</p>
              <p className="text-[10px] text-muted-foreground font-mono">data;descricao;valor</p>
              <p className="text-[10px] text-muted-foreground font-mono">2026-03-15;Pagamento consulta;150.00</p>
              <p className="text-[10px] text-muted-foreground font-mono">2026-03-16;Aluguel sala;-800.00</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
