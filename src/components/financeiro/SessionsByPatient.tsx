import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight, ChevronLeft,
  CalendarDays, ArrowDownToLine, AlertCircle, RotateCcw, DollarSign,
  Search, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { consultasApi } from "@/lib/api";
import { accountsApi } from "@/lib/portalApi";

const fmt = (v: number) =>
  (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type SessionStatus =
  | "scheduled"
  | "completed"
  | "missed_charged"
  | "missed_free"
  | "cancelled";

const statusBadge: Record<string, { label: string; className: string; icon: any }> = {
  completed: { label: "Compareceu", className: "bg-success/10 text-success border-success/30", icon: CheckCircle2 },
  scheduled: { label: "Pendente", className: "bg-warning/10 text-warning border-warning/30", icon: Clock },
  missed_charged: { label: "Faltou (cobra)", className: "bg-destructive/10 text-destructive border-destructive/30", icon: XCircle },
  missed_free: { label: "Faltou", className: "bg-muted text-muted-foreground border-border", icon: XCircle },
  cancelled: { label: "Cancelada", className: "bg-muted text-muted-foreground border-border", icon: XCircle },
};

const accountBadge: Record<string, { label: string; className: string }> = {
  paid: { label: "Pago", className: "bg-success/10 text-success border-success/30" },
  pending: { label: "A receber", className: "bg-warning/10 text-warning border-warning/30" },
  overdue: { label: "Vencido", className: "bg-destructive/10 text-destructive border-destructive/30" },
};

export default function SessionsByPatient() {
  const qc = useQueryClient();
  const now = new Date();
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  );
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["sessions-by-patient", month],
    queryFn: () => consultasApi.sessionsByPatient(month),
  });

  const invalidate = () => {
    refetch();
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["accounts-summary"] });
    qc.invalidateQueries({ queryKey: ["accounts-tab-summary"] });
    qc.invalidateQueries({ queryKey: ["appointments"] });
  };

  const attendMut = useMutation({
    mutationFn: (id: string) => consultasApi.attend(id),
    onSuccess: (r: any) => {
      toast.success(r?.message || "Comparecimento registrado");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Erro"),
  });

  const missMut = useMutation({
    mutationFn: ({ id, charge }: { id: string; charge: boolean }) =>
      consultasApi.miss(id, charge),
    onSuccess: (r: any) => {
      toast.success(r?.message || "Falta registrada");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Erro"),
  });

  const resetMut = useMutation({
    mutationFn: (id: string) => consultasApi.resetStatus(id),
    onSuccess: () => {
      toast.success("Status revertido");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Erro"),
  });

  const bulkPay = useMutation({
    mutationFn: (ids: string[]) => accountsApi.bulkPay({ ids, paymentMethod: "pix" }),
    onSuccess: (res: any) => {
      toast.success(`${res.count} pagamento(s) baixado(s)`);
      setSelectedAccounts(new Set());
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Erro ao dar baixa"),
  });

  const markPaid = useMutation({
    mutationFn: (id: string) => accountsApi.update(id, { status: "paid" }),
    onSuccess: () => {
      toast.success("Pagamento confirmado");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Erro"),
  });

  const patients = useMemo(() => {
    const list = data?.patients || [];
    if (!search.trim()) return list;
    const s = search.toLowerCase();
    return list.filter((p) => p.name.toLowerCase().includes(s));
  }, [data, search]);

  const monthLabel = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return format(new Date(y, m - 1, 1), "MMMM 'de' yyyy", { locale: ptBR });
  }, [month]);

  const prevMonth = () => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const nextMonth = () => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const toggleExpand = (id: string) => {
    setExpanded((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const expandAll = () => setExpanded(new Set(patients.map((p) => p.id)));
  const collapseAll = () => setExpanded(new Set());

  const toggleAccount = (id: string) => {
    setSelectedAccounts((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const totals = useMemo(() => {
    let attended = 0, missed = 0, pending = 0, due = 0, paid = 0;
    patients.forEach((p) => {
      attended += p.totals.attended;
      missed += p.totals.missed;
      pending += p.totals.pending;
      due += p.totals.dueValue;
      paid += p.totals.paidValue;
    });
    return { attended, missed, pending, due, paid };
  }, [patients]);

  return (
    <div className="space-y-4">
      {/* Header / month nav */}
      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevMonth} className="h-9 w-9">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/40 border border-border min-w-[200px] justify-center">
            <CalendarDays className="w-4 h-4 text-primary" />
            <span className="capitalize text-sm font-medium">{monthLabel}</span>
          </div>
          <Button variant="outline" size="icon" onClick={nextMonth} className="h-9 w-9">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-1 md:max-w-md md:ml-auto">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar paciente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={expanded.size === patients.length ? collapseAll : expandAll}>
            {expanded.size === patients.length ? "Recolher" : "Expandir"}
          </Button>
        </div>
      </div>

      {/* Quick totals */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MiniStat label="Comparecidas" value={totals.attended} icon={CheckCircle2} accent="success" />
        <MiniStat label="Faltas" value={totals.missed} icon={XCircle} accent="destructive" />
        <MiniStat label="Pendentes" value={totals.pending} icon={Clock} accent="warning" />
        <MiniStat label="A receber" value={fmt(totals.due)} icon={DollarSign} accent="warning" />
        <MiniStat label="Recebido" value={fmt(totals.paid)} icon={CheckCircle2} accent="success" />
      </div>

      {/* Bulk action bar */}
      {selectedAccounts.size > 0 && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-3 px-4 flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm">
                <Badge className="gradient-primary border-0 mr-2">
                  {selectedAccounts.size} selecionada(s)
                </Badge>
                Dar baixa em lote
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSelectedAccounts(new Set())}>
                  Limpar
                </Button>
                <Button
                  size="sm"
                  className="bg-success hover:bg-success/90 text-success-foreground border-0"
                  onClick={() => bulkPay.mutate(Array.from(selectedAccounts))}
                  disabled={bulkPay.isPending}
                >
                  <ArrowDownToLine className="w-3.5 h-3.5 mr-1.5" />
                  Confirmar Pagamentos
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : patients.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            <User className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhuma sessão neste mês.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {patients.map((p) => {
            const isOpen = expanded.has(p.id);
            return (
              <Card key={p.id} className="border-border/60 overflow-hidden">
                <button
                  onClick={() => toggleExpand(p.id)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors"
                >
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground truncate">{p.name}</span>
                      {p.billingMode === "monthly" && (
                        <Badge variant="outline" className="text-[10px]">Mensal</Badge>
                      )}
                      {p.sessionValue && p.billingMode !== "monthly" && (
                        <span className="text-[11px] text-muted-foreground">
                          · {fmt(p.sessionValue)}/sessão
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1 text-success">
                        <CheckCircle2 className="w-3 h-3" /> {p.totals.attended}
                      </span>
                      <span className="flex items-center gap-1 text-destructive">
                        <XCircle className="w-3 h-3" /> {p.totals.missed}
                      </span>
                      <span className="flex items-center gap-1 text-warning">
                        <Clock className="w-3 h-3" /> {p.totals.pending}
                      </span>
                      {p.totals.dueValue > 0 && (
                        <span className="font-medium text-warning">
                          A receber: {fmt(p.totals.dueValue)}
                        </span>
                      )}
                      {p.totals.paidValue > 0 && (
                        <span className="font-medium text-success">
                          Pago: {fmt(p.totals.paidValue)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <span className="font-semibold text-foreground">
                      {p.sessions.length}
                    </span>
                    <span className="text-muted-foreground"> sessão(ões)</span>
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="border-t border-border bg-muted/20"
                    >
                      <div className="divide-y divide-border">
                        {p.sessions.map((s) => {
                          const sb = statusBadge[s.status] || statusBadge.scheduled;
                          const Icon = sb.icon;
                          const ab = s.accountStatus ? accountBadge[s.accountStatus] : null;
                          const isOpenAccount =
                            !!s.accountId && s.accountStatus !== "paid" && s.accountStatus !== "cancelled";
                          return (
                            <div
                              key={s.id}
                              className="px-4 py-3 flex items-center gap-3 flex-wrap"
                            >
                              {isOpenAccount && (
                                <input
                                  type="checkbox"
                                  className="w-4 h-4 accent-primary"
                                  checked={selectedAccounts.has(s.accountId!)}
                                  onChange={() => toggleAccount(s.accountId!)}
                                />
                              )}
                              <div className="flex-1 min-w-[180px]">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium">
                                    {format(parseISO(s.date), "dd/MM", { locale: ptBR })}
                                    <span className="text-muted-foreground ml-1">
                                      {s.time}
                                    </span>
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] ${sb.className}`}
                                  >
                                    <Icon className="w-3 h-3 mr-1" />
                                    {sb.label}
                                  </Badge>
                                  {ab && (
                                    <Badge
                                      variant="outline"
                                      className={`text-[10px] ${ab.className}`}
                                    >
                                      {ab.label}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {s.duration}min ·{" "}
                                  {s.type === "couple" ? "Casal" : "Individual"}
                                  {s.value > 0 && (
                                    <span className="ml-2 font-medium text-foreground">
                                      {fmt(s.value)}
                                    </span>
                                  )}
                                </p>
                              </div>

                              <div className="flex items-center gap-1">
                                {/* Quick mark paid */}
                                {isOpenAccount && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 text-success border-success/40 hover:bg-success/10"
                                    onClick={() => markPaid.mutate(s.accountId!)}
                                    disabled={markPaid.isPending}
                                  >
                                    <ArrowDownToLine className="w-3.5 h-3.5 mr-1" />
                                    Baixar
                                  </Button>
                                )}

                                {/* Status dropdown */}
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="ghost" className="h-8">
                                      Alterar status
                                      <ChevronDown className="w-3.5 h-3.5 ml-1" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() => attendMut.mutate(s.id)}
                                    >
                                      <CheckCircle2 className="w-4 h-4 mr-2 text-success" />
                                      Compareceu
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        missMut.mutate({ id: s.id, charge: true })
                                      }
                                    >
                                      <XCircle className="w-4 h-4 mr-2 text-destructive" />
                                      Faltou (com cobrança)
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        missMut.mutate({ id: s.id, charge: false })
                                      }
                                    >
                                      <AlertCircle className="w-4 h-4 mr-2 text-muted-foreground" />
                                      Faltou (sem cobrança)
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => resetMut.mutate(s.id)}
                                    >
                                      <RotateCcw className="w-4 h-4 mr-2" />
                                      Voltar para pendente
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: any;
  accent: "success" | "destructive" | "warning" | "primary";
}) {
  const accentClasses: Record<string, string> = {
    success: "text-success bg-success/10",
    destructive: "text-destructive bg-destructive/10",
    warning: "text-warning bg-warning/10",
    primary: "text-primary bg-primary/10",
  };
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-md flex items-center justify-center ${accentClasses[accent]}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold text-foreground truncate">{value}</p>
      </div>
    </div>
  );
}
