import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { recordsApi, type RecordData } from "@/lib/recordsApi";
import { moodApi } from "@/lib/portalApi";
import { pacientesApi, type Patient, type Consulta, consultasApi } from "@/lib/api";
import { goalsApi } from "@/lib/goalsApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, Brain, Calendar, CheckCircle2, ChevronRight,
  Clock, FileText, Heart, Lightbulb, Target, TrendingUp, User, Users,
  Zap, BookOpen, Frown, Meh, Smile, Sparkles, Map, ListTodo, ShieldAlert,
  Flame, Briefcase, Users2, Link2, Search, Plus, Filter, MessageSquare,
  Lock, History, Info, BarChart3, ArrowRight, Tag, LayoutGrid, Loader2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import HomeworkManager from "./HomeworkManager";


interface PremiumClinicalRecordProps {
  patientId: string;
  patientName: string;
  onNavigate?: (tab: string) => void;
}

const MOOD_LABELS = ["", "Muito ruim", "Ruim", "Neutro", "Bom", "Ótimo"];
const MOOD_COLORS = ["", "text-destructive", "text-orange-500", "text-amber-500", "text-emerald-500", "text-emerald-600"];

export default function PremiumClinicalRecord({ patientId, patientName }: PremiumClinicalRecordProps) {
  const [activeView, setActiveView] = useState("overview");
  const queryClient = useQueryClient();

  // Data fetching
  const { data: patient, isLoading: loadingPatient } = useQuery<Patient>({
    queryKey: ["patient", patientId],
    queryFn: () => pacientesApi.get(patientId),
    enabled: !!patientId,
  });

  const generateHypotheses = useMutation({
    mutationFn: async () => {
      const response = await recordsApi.patientAnalysis(patientId);
      const { analysis } = response;
      
      if (!analysis) throw new Error("Não foi possível gerar a análise.");

      // Update patient record with the new insights
      const updateData: Partial<Patient> = {
        emotional_patterns: analysis.identifiedPatterns?.join('\n'),
        triggers: analysis.attentionPoints?.join('\n'), // Using attention points as triggers or similar
        defense_mechanisms: analysis.patternChanges?.join('\n'),
      };

      await pacientesApi.update(patientId, updateData);
      return analysis;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient", patientId] });
      toast.success("Hipóteses Clínicas geradas com sucesso!");
      setActiveView("map");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao gerar hipóteses clínicas. Certifique-se de que há pelo menos 2 sessões registradas.");
    }
  });

  const { data: timeline } = useQuery({
    queryKey: ["patient-timeline", patientId],
    queryFn: () => recordsApi.patientTimeline(patientId),
    enabled: !!patientId,
  });

  const { data: moodData } = useQuery({
    queryKey: ["patient-mood-hub", patientId],
    queryFn: () => moodApi.patientMood(patientId, 30),
    enabled: !!patientId,
  });

  const { data: patientApts = [] } = useQuery<Consulta[]>({
    queryKey: ["patient-appointments-premium", patientId],
    queryFn: () => consultasApi.list({ patientId }),
    enabled: !!patientId,
  });

  const { data: therapeuticGoals = [] } = useQuery({
    queryKey: ["patient-goals-premium", patientId],
    queryFn: () => goalsApi.list(patientId),
    enabled: !!patientId,
  });

  const stats = useMemo(() => {
    const completed = patientApts.filter((a: any) => a.status === "completed" || a.attended === true);
    const cancelled = patientApts.filter((a: any) => a.status === "cancelled");
    const totalSessions = timeline?.totalSessions ?? completed.length;
    const adherenceRate = patientApts.length > 0 ? Math.round((completed.length / patientApts.length) * 100) : 0;
    
    return {
      totalSessions,
      cancelledCount: cancelled.length,
      adherenceRate,
      lastSession: timeline?.records?.[0],
    };
  }, [patientApts, patientId, timeline]);

  // Premium derived data (Mocked or extrapolated from existing data)
  const clinicalMap = useMemo(() => ({
    emotionalPatterns: patient?.emotional_patterns?.split('\n').filter(Boolean) || ["Não registrados"],
    triggers: patient?.triggers?.split('\n').filter(Boolean) || ["Não registrados"],
    defenseMechanisms: patient?.defense_mechanisms?.split('\n').filter(Boolean) || ["Não registrados"],
    dominantThemes: timeline?.themes?.slice(0, 4).map(t => t.name) || ["Nenhum tema identificado"],
  }), [patient, timeline]);

  // Removed hardcoded therapeuticGoals as they are now fetched from goalsApi


  return (
    <div className="space-y-6">
      {/* Header Premium */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="relative">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 via-primary to-primary/80 flex items-center justify-center text-white text-3xl font-display font-bold shadow-xl shadow-primary/20 ring-4 ring-white dark:ring-slate-900 overflow-hidden">
              <span className="relative z-10">{patientName.split(" ").map(n => n[0]).slice(0, 2).join("")}</span>
              <div className="absolute inset-0 bg-white/10 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-emerald-500 border-4 border-white dark:border-slate-900 flex items-center justify-center shadow-lg" title="Paciente Ativo">
              <Activity className="w-3.5 h-3.5 text-white" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">{patientName}</h1>
              <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-800 uppercase tracking-widest text-[10px] font-bold px-2 py-0.5">Premium</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-primary" /> {stats.totalSessions} {stats.totalSessions === 1 ? "sessão" : "sessões"} {stats.totalSessions === 0 ? "" : "totais"}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            className="h-11 rounded-xl gap-2 border-border/60 hover:bg-muted/50 transition-all"
            onClick={() => generateHypotheses.mutate()}
            disabled={generateHypotheses.isPending}
          >
            {generateHypotheses.isPending ? (
              <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
            ) : (
              <Brain className="w-4 h-4 text-indigo-500" />
            )}
            {generateHypotheses.isPending ? "Gerando..." : "Hipóteses Clínicas"}
          </Button>
          <Button className="h-11 rounded-xl gradient-primary border-0 shadow-lg shadow-primary/20 gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all">
            <Plus className="w-4 h-4" /> Nova Sessão
          </Button>
        </div>
      </div>

      {/* Navigation Tabs Premium */}
      <Tabs value={activeView} onValueChange={setActiveView} className="w-full">
        <TabsList className="w-full justify-start bg-transparent h-auto p-0 gap-1 overflow-x-auto no-scrollbar border-b border-border/40 pb-px">
          <TabTrigger value="overview" icon={LayoutGrid} label="Visão Geral" />
          <TabTrigger value="map" icon={Map} label="Mapa Clínico" />
          <TabTrigger value="evolution" icon={TrendingUp} label="Evolução & Objetivos" />
          <TabTrigger value="tasks" icon={ListTodo} label="Tarefas & Vida" />
          <TabTrigger value="ai" icon={Sparkles} label="IA Assistente" />
          <TabTrigger value="timeline" icon={History} label="Timeline Rica" />
        </TabsList>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeView}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="mt-8"
          >
            {/* OVERVIEW */}
            <TabsContent value="overview" className="space-y-6 mt-0 focus-visible:outline-none">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <PremiumKpiCard title="Adesão" value={`${stats.adherenceRate}%`} trend={stats.totalSessions > 0 ? "Calculado" : "Sem dados"} icon={Activity} color="indigo" />
                <PremiumKpiCard title="Último Humor" value={moodData?.entries?.[0] ? MOOD_LABELS[moodData.entries[0].mood] : "Sem registro"} trend={moodData?.entries?.[0] ? "Atualizado" : "Sem dados"} icon={Smile} color="emerald" />
                <PremiumKpiCard title="Faltas" value={stats.cancelledCount} trend={stats.cancelledCount > 0 ? "Atenção" : "Sem dados"} icon={AlertTriangle} color="amber" />
                <PremiumKpiCard title="Sessões" value={stats.totalSessions} trend={stats.totalSessions > 0 ? "Registradas" : "Sem dados"} icon={Flame} color="rose" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2 border-border/60 shadow-sm overflow-hidden bg-card/50 backdrop-blur-sm">
                  <CardHeader className="flex flex-row items-center justify-between pb-4">
                    <div className="space-y-1">
                      <CardTitle className="text-lg font-display flex items-center gap-2">
                        <Brain className="w-5 h-5 text-primary" /> IA Leitura Clínica Atual
                      </CardTitle>
                      <CardDescription>Resumo executivo consolidado das últimas sessões</CardDescription>
                    </div>
                    {stats.totalSessions > 0 && (
                      <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">{stats.totalSessions} {stats.totalSessions === 1 ? "sessão" : "sessões"}</Badge>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {stats.totalSessions === 0 ? (
                      <div className="p-6 rounded-2xl bg-muted/20 border border-dashed border-border/60 text-sm text-muted-foreground text-center">
                        <Brain className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p className="font-medium text-foreground/80">Sem sessões registradas</p>
                        <p className="text-xs mt-1">A leitura clínica da IA aparecerá aqui após o registro de sessões deste paciente.</p>
                      </div>
                    ) : (
                      <>
                        <div className="p-4 rounded-2xl bg-muted/20 border border-dashed border-border/60 text-sm text-muted-foreground text-center">
                          <p>Use o botão <span className="font-semibold text-foreground">"Hipóteses Clínicas"</span> acima para gerar uma leitura clínica baseada nas sessões registradas.</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Padrões Ativos</p>
                            <ul className="space-y-1.5">
                              {clinicalMap.emotionalPatterns.slice(0, 2).map((p, i) => (
                                <li key={i} className="text-xs flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" /> {p}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div className="space-y-2">
                            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Temas Dominantes</p>
                            <ul className="space-y-1.5">
                              {clinicalMap.dominantThemes.slice(0, 2).map((t, i) => (
                                <li key={i} className="text-xs flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-primary" /> {t}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/60 shadow-sm bg-card/50 backdrop-blur-sm">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg font-display flex items-center gap-2">
                      <Target className="w-5 h-5 text-primary" /> Objetivos Cruciais
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {therapeuticGoals.slice(0, 3).map(goal => (
                      <div key={goal.id} className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-foreground/80">{goal.title}</span>
                          <span className="font-bold text-primary">{goal.progress}%</span>
                        </div>
                        <Progress value={goal.progress} className="h-1.5" />
                      </div>
                    ))}
                    <Button variant="ghost" className="w-full text-xs text-primary hover:text-primary/80 gap-2 h-8" onClick={() => setActiveView("evolution")}>
                      Ver todos os objetivos <ChevronRight className="w-3 h-3" />
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* MAPA CLÍNICO */}
            <TabsContent value="map" className="space-y-6 mt-0 focus-visible:outline-none">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <MapSection title="Padrões Emocionais" items={clinicalMap.emotionalPatterns} icon={TrendingUp} color="indigo" />
                <MapSection title="Gatilhos Recorrentes" items={clinicalMap.triggers} icon={Zap} color="rose" />
                <MapSection title="Mecanismos de Defesa" items={clinicalMap.defenseMechanisms} icon={ShieldAlert} color="amber" />
                <MapSection title="Temas Dominantes" items={clinicalMap.dominantThemes} icon={Tag} color="primary" />
              </div>
            </TabsContent>

            {/* EVOLUÇÃO & OBJETIVOS */}
            <TabsContent value="evolution" className="space-y-6 mt-0 focus-visible:outline-none">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  <Card className="border-border/60">
                    <CardHeader className="pb-4 flex flex-row items-center justify-between">
                      <CardTitle className="text-lg font-display flex items-center gap-2">
                        <ListTodo className="w-5 h-5 text-primary" /> Lista de Objetivos Terapêuticos
                      </CardTitle>
                      <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs gap-1.5">
                        <Plus className="w-3.5 h-3.5" /> Adicionar
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {therapeuticGoals.map(goal => (
                        <div key={goal.id} className="p-4 rounded-xl border border-border/40 bg-muted/20 flex items-center justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              {goal.status === "completed" ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                              ) : (
                                <div className="w-4 h-4 rounded-full border-2 border-primary/30" />
                              )}
                              <h4 className={cn("text-sm font-semibold truncate", goal.status === "completed" && "text-muted-foreground line-through")}>{goal.title}</h4>
                            </div>
                            <Progress value={goal.progress} className="h-1.5 w-32" />
                          </div>
                          <Badge variant={goal.status === "completed" ? "default" : "outline"} className={cn("text-[10px]", goal.status === "completed" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "text-primary")}>
                            {goal.status === "completed" ? "Concluído" : "Em Progresso"}
                          </Badge>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-6">
                  <Card className="border-border/60 bg-gradient-to-br from-primary/5 to-transparent">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-primary" /> Mudanças Recentes
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <EvolutionItem type="gain" label="Melhora na qualidade do sono" date="Há 3 dias" />
                      <EvolutionItem type="relapse" label="Oscilação de humor após reunião" date="Ontem" />
                      <EvolutionItem type="gain" label="Primeiro limite verbalizado com a mãe" date="Há 1 semana" />
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* TAREFAS & VIDA */}
            <TabsContent value="tasks" className="space-y-6 mt-0 focus-visible:outline-none">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="lg:col-span-1">
                  <HomeworkManager patientId={patientId} />
                </div>

                <Card className="border-border/60">
                  <CardHeader>
                    <CardTitle className="text-lg font-display flex items-center gap-2">
                      <Users2 className="w-5 h-5 text-primary" /> Ecossistema Relacional
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-4">
                    <RelationshipCard type="Família" status="conflict" label="Conflituoso" icon={Heart} />
                    <RelationshipCard type="Trabalho" status="stress" label="Estressante" icon={Briefcase} />
                    <RelationshipCard type="Conjugal" status="stable" label="Estável" icon={Heart} />
                    <RelationshipCard type="Social" status="withdrawn" label="Retraído" icon={Users} />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* IA ASSISTENTE */}
            <TabsContent value="ai" className="space-y-6 mt-0 focus-visible:outline-none">
              <Card className="border-primary/30 shadow-glow/10 bg-gradient-to-br from-primary/5 via-transparent to-indigo-500/5">
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl font-display flex items-center gap-2">
                    <Sparkles className="w-6 h-6 text-primary animate-pulse" /> IA Assistente Clínica Premium
                  </CardTitle>
                  <CardDescription>Análise profunda e sugestões baseadas no histórico completo do paciente</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <AiFeatureCard icon={Search} title="Leitura Clínica" description="Análise de nuances emocionais das últimas sessões." />
                    <AiFeatureCard icon={TrendingUp} title="Padrões Ocultos" description="Identifica conexões entre eventos de vida e humor." />
                    <AiFeatureCard icon={Lightbulb} title="Sugestão de Foco" description="Temas prioritários para o próximo atendimento." />
                  </div>
                  
                  <Separator className="bg-primary/10" />
                  
                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-primary flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" /> Resumo Executivo da IA
                    </h4>
                    <div className="p-5 rounded-2xl bg-white/40 dark:bg-slate-900/40 border border-primary/20 backdrop-blur-md text-sm leading-relaxed prose prose-sm max-w-none">
                      <p>Baseado nas últimas 12 semanas, <strong>{patientName}</strong> demonstra uma transição da fase de estabilização sintomática para a fase de exploração de traumas secundários. A adesão às tarefas terapêuticas caiu 15% após a introdução de temas relacionados à figura materna, sugerindo uma resistência inconsciente que pode ser o foco da próxima sessão.</p>
                      <p><strong>Ponto Crítico:</strong> Oscilação emocional acentuada nas noites de domingo, possivelmente ligada à antecipação do ambiente laboral estressante.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TIMELINE RICA */}
            <TabsContent value="timeline" className="mt-0 focus-visible:outline-none">
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-display font-bold">Timeline Interativa</h3>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5"><Filter className="w-3.5 h-3.5" /> Filtrar</Button>
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Visualizar Dados</Button>
                  </div>
                </div>
                
                <div className="relative pl-8 space-y-8 before:absolute before:inset-y-0 before:left-[11px] before:w-0.5 before:bg-gradient-to-b before:from-primary before:via-indigo-500 before:to-muted">
                  <TimelineEvent type="session" title="Sessão #42 — Exploração de Limites" date="Hoje, 14:00" description="Trabalhamos a diferenciação emocional entre as demandas do chefe e o senso de valor próprio." icon={FileText} />
                  <TimelineEvent type="mood" title="Humor: Muito Bom" date="Ontem, 20:30" description="Relatou sensação de alívio após finalizar projeto importante." icon={Smile} />
                  <TimelineEvent type="task" title="Tarefa Concluída: Diário" date="15 Abr, 09:00" description="Completou 7 dias consecutivos de registro." icon={CheckCircle2} />
                  <TimelineEvent type="event" title="Evento Crítico: Discussão Familiar" date="12 Abr, 18:15" description="Paciente reportou via mensagem evento de estresse agudo com o irmão." icon={AlertTriangle} isCritical />
                  <TimelineEvent type="test" title="Teste Aplicado: BDI-II" date="10 Abr, 11:00" description="Pontuação: 14 (Depressão leve). Queda de 5 pontos em relação ao mês anterior." icon={BarChart3} />
                </div>
              </div>
            </TabsContent>
          </motion.div>
        </AnimatePresence>
      </Tabs>
    </div>
  );
}

// Helper Components
function TabTrigger({ value, icon: Icon, label }: { value: string; icon: any; label: string }) {
  return (
    <TabsTrigger
      value={value}
      className="px-4 py-3 text-sm font-medium transition-all data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary border-transparent rounded-none bg-transparent hover:text-primary/70 gap-2"
    >
      <Icon className="w-4 h-4" />
      {label}
    </TabsTrigger>
  );
}

function PremiumKpiCard({ title, value, trend, icon: Icon, color }: { title: string; value: string | number; trend: string; icon: any; color: "indigo" | "emerald" | "amber" | "rose" }) {
  const colors = {
    indigo: "from-indigo-500/10 to-indigo-500/5 text-indigo-600 border-indigo-200 dark:border-indigo-900/50",
    emerald: "from-emerald-500/10 to-emerald-500/5 text-emerald-600 border-emerald-200 dark:border-emerald-900/50",
    amber: "from-amber-500/10 to-amber-500/5 text-amber-600 border-amber-200 dark:border-amber-900/50",
    rose: "from-rose-500/10 to-rose-500/5 text-rose-600 border-rose-200 dark:border-rose-900/50",
  };

  return (
    <Card className={cn("border shadow-sm overflow-hidden bg-gradient-to-br", colors[color])}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className={cn("p-2 rounded-xl bg-white dark:bg-slate-900 shadow-sm")}>
            <Icon className="w-5 h-5" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">{trend}</span>
        </div>
        <div>
          <p className="text-2xl font-display font-bold text-slate-900 dark:text-white leading-tight">{value}</p>
          <p className="text-xs font-medium opacity-70 mt-1 uppercase tracking-wide">{title}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function MapSection({ title, items, icon: Icon, color }: { title: string; items: string[]; icon: any; color: string }) {
  return (
    <Card className="border-border/60 hover:shadow-md transition-all group overflow-hidden">
      <div className={cn("h-1 w-full bg-primary", color === "rose" && "bg-rose-500", color === "amber" && "bg-amber-500", color === "indigo" && "bg-indigo-500")} />
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">
          <Icon className="w-4 h-4" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/40 border border-transparent hover:border-border/60 transition-all cursor-default">
            <div className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />
            <span className="text-sm text-foreground/80 font-medium">{item}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EvolutionItem({ type, label, date }: { type: "gain" | "relapse"; label: string; date: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-border/40 hover:bg-muted/30 transition-all group">
      <div className={cn("p-2 rounded-lg shrink-0", type === "gain" ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600")}>
        {type === "gain" ? <Flame className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{label}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5 uppercase font-bold tracking-wider">{date}</p>
      </div>
    </div>
  );
}

function TaskItem({ title, adherence, status, date }: { title: string; adherence: number; status: "high" | "low" | "completed"; date: string }) {
  return (
    <div className="flex items-center justify-between p-3.5 rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm group hover:border-indigo-500/30 transition-all">
      <div className="flex items-center gap-3">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center bg-muted text-muted-foreground", status === "high" && "bg-indigo-100 text-indigo-600", status === "completed" && "bg-emerald-100 text-emerald-600")}>
          <ListTodo className="w-5 h-5" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-foreground truncate">{title}</h4>
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{date}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm font-bold text-foreground">{adherence}%</p>
        <div className="w-16 h-1 bg-muted rounded-full mt-1 overflow-hidden">
          <div className={cn("h-full bg-primary", adherence < 50 && "bg-rose-500", adherence === 100 && "bg-emerald-500")} style={{ width: `${adherence}%` }} />
        </div>
      </div>
    </div>
  );
}

function RelationshipCard({ type, status, label, icon: Icon }: { type: string; status: string; label: string; icon: any }) {
  const statusColors = {
    conflict: "border-rose-200 bg-rose-50/30 text-rose-700",
    stress: "border-amber-200 bg-amber-50/30 text-amber-700",
    stable: "border-emerald-200 bg-emerald-50/30 text-emerald-700",
    withdrawn: "border-indigo-200 bg-indigo-50/30 text-indigo-700",
  };
  
  return (
    <div className={cn("p-3 rounded-2xl border flex flex-col items-center text-center gap-1.5 hover:scale-[1.02] transition-transform cursor-default", statusColors[status as keyof typeof statusColors])}>
      <Icon className="w-5 h-5 opacity-70" />
      <p className="text-xs font-bold uppercase tracking-wider">{type}</p>
      <Badge variant="outline" className="text-[9px] py-0 border-current opacity-80">{label}</Badge>
    </div>
  );
}

function AiFeatureCard({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <div className="p-4 rounded-2xl bg-white/40 dark:bg-slate-900/40 border border-border/40 hover:border-primary/40 transition-all text-left group">
      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
        <Icon className="w-5 h-5" />
      </div>
      <h4 className="text-sm font-bold text-foreground mb-1">{title}</h4>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}

function TimelineEvent({ type, title, date, description, icon: Icon, isCritical }: { type: string; title: string; date: string; description: string; icon: any; isCritical?: boolean }) {
  const typeColors = {
    session: "bg-indigo-500 text-white shadow-indigo-500/20",
    mood: "bg-emerald-500 text-white shadow-emerald-500/20",
    task: "bg-amber-500 text-white shadow-amber-500/20",
    event: "bg-rose-500 text-white shadow-rose-500/20",
    test: "bg-primary text-white shadow-primary/20",
  };

  return (
    <div className="relative group">
      <div className={cn(
        "absolute -left-[29px] top-0 w-8 h-8 rounded-full flex items-center justify-center z-10 shadow-lg transition-transform group-hover:scale-110",
        typeColors[type as keyof typeof typeColors],
        isCritical && "animate-pulse"
      )}>
        <Icon className="w-4 h-4" />
      </div>
      <div className={cn(
        "p-4 rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm group-hover:border-primary/40 group-hover:shadow-md transition-all",
        isCritical && "border-rose-200 bg-rose-50/20 dark:border-rose-900/20"
      )}>
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-sm font-bold text-foreground">{title}</h4>
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{date}</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

