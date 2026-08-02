import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { CalendarClock, TrendingUp, HeartPulse, ArrowRight, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { useFinancialHealth } from "@/hooks/useDashboard";

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const levelMeta = {
  saudavel: { label: "Saudável", cls: "text-success", bar: "bg-success" },
  atencao: { label: "Atenção", cls: "text-warning", bar: "bg-warning" },
  critico: { label: "Crítico", cls: "text-destructive", bar: "bg-destructive" },
} as const;

export default function FinancialHealthCards() {
  const { data, isLoading, isError } = useFinancialHealth();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-xl flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-destructive" />
        <p className="text-sm text-muted-foreground">Não foi possível carregar os indicadores financeiros.</p>
      </div>
    );
  }

  const meta = levelMeta[data.health.level] ?? levelMeta.atencao;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="grid grid-cols-1 md:grid-cols-3 gap-4"
    >
      {/* Receber hoje */}
      <Card className="shadow-card">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <CalendarClock className="w-4 h-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">A receber hoje</CardTitle>
              <CardDescription className="text-xs">Cobranças com vencimento hoje</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-display font-bold text-foreground">{brl(data.today.value)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {data.today.count} cobrança(s) em aberto
          </p>
          {data.overdue.value > 0 && (
            <p className="text-xs text-destructive font-medium mt-2">
              {brl(data.overdue.value)} em atraso ({data.overdue.count})
            </p>
          )}
          <Link to="/financeiro" className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-3">
            Ver financeiro <ArrowRight className="w-3 h-3" />
          </Link>
        </CardContent>
      </Card>

      {/* Receber futuro */}
      <Card className="shadow-card">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-success/10">
              <TrendingUp className="w-4 h-4 text-success" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">A receber (futuro)</CardTitle>
              <CardDescription className="text-xs">Vencimentos a partir de amanhã</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-display font-bold text-foreground">{brl(data.future.value)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {data.future.count} cobrança(s) programada(s)
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Próximos 30 dias: <span className="font-semibold text-foreground">{brl(data.future.next30)}</span>
          </p>
          <Link to="/financeiro" className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-3">
            Ver projeção <ArrowRight className="w-3 h-3" />
          </Link>
        </CardContent>
      </Card>

      {/* Saúde financeira */}
      <Card className="shadow-card">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-info/10">
              <HeartPulse className="w-4 h-4 text-info" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Saúde financeira</CardTitle>
              <CardDescription className="text-xs">Baseada nos dados do sistema</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-between">
            <p className="text-2xl font-display font-bold text-foreground">{data.health.score}<span className="text-sm text-muted-foreground">/100</span></p>
            <span className={`text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
          </div>
          <div className="h-2 mt-2 w-full rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${data.health.score}%` }} />
          </div>

          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            <p>
              Saldo previsto (30d):{" "}
              <span className={`font-semibold ${data.health.projected_balance_30 >= 0 ? "text-success" : "text-destructive"}`}>
                {brl(data.health.projected_balance_30)}
              </span>
            </p>
            <p>Inadimplência: <span className="font-semibold text-foreground">{data.health.default_rate}%</span></p>
            <p>Despesas previstas (30d): <span className="font-semibold text-foreground">{brl(data.payable.next30)}</span></p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
