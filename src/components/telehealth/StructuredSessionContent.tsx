import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  FileText, Brain, ClipboardList, Target, Eye, TestTube, Activity,
  Lightbulb, ArrowRight, BookOpen, Stethoscope, Copy, Check, ListChecks
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface StructuredData {
  // New format
  subjetivo?: {
    queixa_principal?: string[];
    sentimentos_percepcoes?: string[];
  };
  objetivo?: {
    observacoes_clinicas?: string[];
    testes_psicologicos?: string[];
  };
  avaliacao?: {
    analise_clinica?: string;
    sugestoes_cid?: string[];
  };
  planos?: {
    intervencoes?: string[];
    encaminhamento?: string[];
    proxima_consulta?: string[];
    objetivos_terapeuticos?: string[];
  };
  estrategias_especificas?: Array<{ categoria: string; itens: string[] }>;
  resumo_profissional?: string;
  temas_abordados?: string[];

  // Legacy format support
  registro_consulta?: {
    historico_paciente?: {
      queixas_previas?: string[];
      consultas_previas?: string[];
      condicoes_psiquiatricas?: string[];
      medicacoes_em_uso?: string[];
    };
  };
  queixa_principal?: string[];
  observacoes?: string[];
  testes_psicologicos?: string[];
  avaliacao_texto?: string; // mapping to string avaliacao if it's legacy
  estrategias?: {
    categorias?: Array<{ titulo: string; itens: string[] }>;
  };
  sugestoes_cid?: string | string[];
  resumo?: string;
  motivo_sessao?: string;
  observacoes_relevantes?: string | string[];
  evolucao?: string | string[];
  encaminhamentos?: string | string[];
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
    </Button>
  );
}

function SectionHeader({ icon, title, copyText }: { icon: React.ReactNode; title: string; copyText?: string }) {
  return (
    <div className="flex items-center justify-between group">
      <h3 className="text-base font-bold text-foreground flex items-center gap-2 uppercase tracking-wide">
        {icon}
        {title}
      </h3>
      {copyText && <CopyButton text={copyText} />}
    </div>
  );
}

function ListSection({ title, items, icon }: { title: string; items?: string[]; icon?: React.ReactNode }) {
  if (!items || items.length === 0 || (items.length === 1 && items[0].toLowerCase().includes("não mencionado"))) {
    return null;
  }
  return (
    <div className="space-y-2">
      {title && <h4 className="text-sm font-semibold text-primary/80 flex items-center gap-2">{icon}{title}</h4>}
      <ul className="list-disc list-inside space-y-1.5 ml-1">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-foreground leading-relaxed">{item}</li>
        ))}
      </ul>
    </div>
  );
}

function toArray(val?: string | string[]): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

export default function StructuredSessionContent({ data, compact = false }: { data: string | object; compact?: boolean }) {
  let sc: any;
  try {
    sc = typeof data === "string" ? JSON.parse(data) : data;
  } catch {
    return null;
  }

  // Check if it's the new format
  const isNewProfessionalFormat = !!(sc.subjetivo || sc.resumo_profissional || sc.estrategias_especificas);
  const isLegacyStructuredFormat = !!(sc.registro_consulta || sc.queixa_principal);

  if (!isNewProfessionalFormat && !isLegacyStructuredFormat) {
    // Basic format rendering
    return (
      <div className="space-y-3 bg-accent/30 border border-border rounded-xl p-4">
        <SectionHeader icon={<Brain className="h-4 w-4 text-primary" />} title="Conteúdo Organizado pela IA" />
        <div className="space-y-3">
          {sc.motivo_sessao && (
            <div><p className="text-xs font-medium text-primary uppercase">Motivo da Sessão</p><p className="text-sm text-foreground">{sc.motivo_sessao}</p></div>
          )}
          {sc.temas_abordados && sc.temas_abordados.length > 0 && (
            <div><p className="text-xs font-medium text-primary uppercase">Temas Abordados</p><div className="flex flex-wrap gap-1 mt-1">{sc.temas_abordados.map((t: string, i: number) => <Badge key={i} variant="secondary">{t}</Badge>)}</div></div>
          )}
          {sc.observacoes_relevantes && (
            <div><p className="text-xs font-medium text-primary uppercase">Observações</p><p className="text-sm text-foreground">{typeof sc.observacoes_relevantes === "string" ? sc.observacoes_relevantes : toArray(sc.observacoes_relevantes).join("; ")}</p></div>
          )}
          {sc.evolucao && (
            <div><p className="text-xs font-medium text-primary uppercase">Evolução</p><p className="text-sm text-foreground">{typeof sc.evolucao === "string" ? sc.evolucao : toArray(sc.evolucao).join("; ")}</p></div>
          )}
          {sc.resumo && (
            <div><p className="text-xs font-medium text-primary uppercase">Resumo</p><p className="text-sm text-foreground">{sc.resumo}</p></div>
          )}
        </div>
      </div>
    );
  }

  // Normalize data for rendering
  const subjetivo = sc.subjetivo || { 
    queixa_principal: toArray(sc.queixa_principal || sc.motivo_sessao),
    sentimentos_percepcoes: []
  };
  
  const objetivo = sc.objetivo || {
    observacoes_clinicas: toArray(sc.observacoes || sc.observacoes_relevantes),
    testes_psicologicos: toArray(sc.testes_psicologicos)
  };
  
  const avaliacao = sc.avaliacao || {
    analise_clinica: typeof sc.avaliacao === 'string' ? sc.avaliacao : (sc.evolucao || ""),
    sugestoes_cid: toArray(sc.sugestoes_cid)
  };
  
  const planos = sc.planos || {
    intervencoes: toArray(sc.planos?.intervencoes),
    encaminhamento: toArray(sc.planos?.encaminhamento || sc.encaminhamentos),
    proxima_consulta: [],
    objetivos_terapeuticos: toArray(sc.objetivo_terapeutico)
  };
  
  const estrategias = sc.estrategias_especificas || (sc.estrategias?.categorias?.map((c: any) => ({ categoria: c.titulo, itens: c.itens })) || []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Brain className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold text-foreground">Prontuário Estruturado</h2>
        <Badge variant="outline" className="ml-auto text-xs font-mono uppercase">IA Professional</Badge>
      </div>

      {/* # SUBJETIVO */}
      {(subjetivo.queixa_principal?.length > 0 || subjetivo.sentimentos_percepcoes?.length > 0) && (
        <Card className="border-primary/10 shadow-sm overflow-hidden group">
          <div className="bg-primary/5 px-4 py-2 border-b border-primary/10">
            <SectionHeader icon={<ClipboardList className="h-4 w-4 text-primary" />} title="Subjetivo" />
          </div>
          <CardContent className="p-4 space-y-4">
            <ListSection title="Queixa Principal" items={subjetivo.queixa_principal} />
            <ListSection title="Sentimentos e Percepções" items={subjetivo.sentimentos_percepcoes} />
          </CardContent>
        </Card>
      )}

      {/* # OBJETIVO */}
      {(objetivo.observacoes_clinicas?.length > 0 || objetivo.testes_psicologicos?.length > 0) && (
        <Card className="border-primary/10 shadow-sm overflow-hidden group">
          <div className="bg-primary/5 px-4 py-2 border-b border-primary/10">
            <SectionHeader icon={<Eye className="h-4 w-4 text-primary" />} title="Objetivo" />
          </div>
          <CardContent className="p-4 space-y-4">
            <ListSection title="Observações Clínicas" items={objetivo.observacoes_clinicas} />
            <ListSection title="Testes Psicológicos" items={objetivo.testes_psicologicos} icon={<TestTube className="h-3 w-3" />} />
          </CardContent>
        </Card>
      )}

      {/* # AVALIAÇÃO */}
      {(avaliacao.analise_clinica || (avaliacao.sugestoes_cid && avaliacao.sugestoes_cid.length > 0)) && (
        <Card className="border-primary/10 shadow-sm overflow-hidden group">
          <div className="bg-primary/5 px-4 py-2 border-b border-primary/10">
            <SectionHeader icon={<Activity className="h-4 w-4 text-primary" />} title="Avaliação" />
          </div>
          <CardContent className="p-4 space-y-4">
            {avaliacao.analise_clinica && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-primary/80">Análise Clínica</h4>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{avaliacao.analise_clinica}</p>
              </div>
            )}
            <ListSection title="Sugestões de CID / Hipóteses" items={avaliacao.sugestoes_cid} icon={<Stethoscope className="h-3 w-3" />} />
          </CardContent>
        </Card>
      )}

      {/* # PLANOS */}
      {(planos.intervencoes?.length > 0 || planos.encaminhamento?.length > 0 || planos.proxima_consulta?.length > 0 || planos.objetivos_terapeuticos?.length > 0) && (
        <Card className="border-primary/10 shadow-sm overflow-hidden group">
          <div className="bg-primary/5 px-4 py-2 border-b border-primary/10">
            <SectionHeader icon={<ArrowRight className="h-4 w-4 text-primary" />} title="Planos" />
          </div>
          <CardContent className="p-4 space-y-4">
            <ListSection title="Intervenções" items={planos.intervencoes} />
            <ListSection title="Próxima Consulta" items={planos.proxima_consulta} />
            <ListSection title="Objetivos Terapêuticos" items={planos.objetivos_terapeuticos} icon={<Target className="h-3 w-3" />} />
            <ListSection title="Encaminhamento" items={planos.encaminhamento} />
          </CardContent>
        </Card>
      )}

      {/* ESTRATÉGIAS ESPECÍFICAS */}
      {estrategias.length > 0 && (
        <Card className="border-primary/10 shadow-sm overflow-hidden group">
          <div className="bg-primary/5 px-4 py-2 border-b border-primary/10">
            <SectionHeader icon={<ListChecks className="h-4 w-4 text-primary" />} title="Estratégias" />
          </div>
          <CardContent className="p-4 space-y-4">
            {estrategias.map((est: any, i: number) => (
              <ListSection key={i} title={est.categoria || est.titulo} items={est.itens} icon={<Lightbulb className="h-3 w-3 text-warning" />} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* RESUMO PROFISSIONAL */}
      {(sc.resumo_profissional || sc.resumo) && !compact && (
        <Card className="border-primary/10 shadow-sm overflow-hidden group bg-primary/5">
          <div className="px-4 py-2 border-b border-primary/10">
            <SectionHeader icon={<FileText className="h-4 w-4 text-primary" />} title="Resumo Profissional" />
          </div>
          <CardContent className="p-4">
            <p className="text-sm text-foreground leading-relaxed italic">{sc.resumo_professional || sc.resumo}</p>
          </CardContent>
        </Card>
      )}

      {/* TEMAS */}
      {sc.temas_abordados && sc.temas_abordados.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-2">
          {sc.temas_abordados.map((t: string, i: number) => (
            <Badge key={i} variant="secondary" className="text-[10px] uppercase tracking-tighter">{t}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}
