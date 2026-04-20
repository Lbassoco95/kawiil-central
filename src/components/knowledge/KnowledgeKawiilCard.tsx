import { useMemo } from "react";
import {
  Sparkles,
  Building2,
  FolderKanban,
  Users,
  Bot,
  BarChart3,
  Lightbulb,
  ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KAWIIL_AI_GRADIENT, KAWIIL_AI_HEADER_BG } from "@/lib/kawiilAi";

export type KnowledgeTab =
  | "clientes"
  | "proyectos"
  | "celulas"
  | "agentes"
  | "estadisticas"
  | "sugerencias";

interface Props {
  activeTab: KnowledgeTab;
  onGoToTab: (tab: KnowledgeTab) => void;
}

/**
 * Hero AI card v2.4 para Base de Conocimiento. Sigue el mismo patrón visual que
 * `NotificationsKawiilCard` / `FinanceKawiilCard`: header con `KAWIIL_AI_HEADER_BG`,
 * badge `v2.4`, mensaje contextual + chips para saltar entre vistas.
 *
 * El "resumen" aquí es heurístico (no hay snapshot AI dedicado): explica al usuario
 * para qué sirve cada vista de aprendizaje y propone la próxima acción según el tab
 * actual. Cuando el dashboard tenga una métrica resumida (clientes con embeddings,
 * proyectos con summary, etc.) se puede inyectar como datos numéricos vía props.
 */
export function KnowledgeKawiilCard({ activeTab, onGoToTab }: Props) {
  const summary = useMemo(() => {
    switch (activeTab) {
      case "clientes":
        return "Estás viendo qué ha aprendido Kawiil de cada cliente: contexto, hitos y conversaciones indexadas. Si encuentras gaps, abre la ficha y agrega documentos o notas.";
      case "proyectos":
        return "Aprendizaje a nivel proyecto: alcance, hitos, riesgos y entregables capturados. Útil para onboarding rápido de nuevos integrantes.";
      case "celulas":
        return "Conocimiento operativo por célula (cumplimiento, fiscal, gobierno corporativo, etc.): plantillas, criterios y manuales que Kawiil puede usar como contexto.";
      case "agentes":
        return "Agentes Kawiil disponibles, sus roles y áreas de especialidad. Activa o ajusta los que tu equipo más necesite.";
      case "estadisticas":
        return "Métricas de adopción: cuánto se está usando Kawiil AI, qué módulos consumen más contexto y cuáles necesitan más datos.";
      case "sugerencias":
        return "Sugerencias automáticas para enriquecer el conocimiento: documentos pendientes de indexar, fichas incompletas y patrones detectados.";
    }
  }, [activeTab]);

  const next: { label: string; tab: KnowledgeTab; reason: string } = useMemo(() => {
    switch (activeTab) {
      case "clientes":
        return { label: "Ver por proyecto", tab: "proyectos", reason: "comparar cliente vs proyectos en curso" };
      case "proyectos":
        return { label: "Ver por célula", tab: "celulas", reason: "ver qué célula está más involucrada" };
      case "celulas":
        return { label: "Ver agentes", tab: "agentes", reason: "ver qué agentes apoyan estas células" };
      case "agentes":
        return { label: "Ver estadísticas", tab: "estadisticas", reason: "medir adopción de agentes" };
      case "estadisticas":
        return { label: "Ver sugerencias", tab: "sugerencias", reason: "atender lo que falta indexar" };
      case "sugerencias":
        return { label: "Ver por cliente", tab: "clientes", reason: "regresar al detalle por cliente" };
    }
  }, [activeTab]);

  const chips: { key: KnowledgeTab; label: string; icon: typeof Building2 }[] = [
    { key: "clientes", label: "Clientes", icon: Building2 },
    { key: "proyectos", label: "Proyectos", icon: FolderKanban },
    { key: "celulas", label: "Células", icon: Users },
    { key: "agentes", label: "Agentes", icon: Bot },
    { key: "estadisticas", label: "Estadísticas", icon: BarChart3 },
    { key: "sugerencias", label: "Sugerencias", icon: Lightbulb },
  ];

  return (
    <section
      className="overflow-hidden rounded-2xl border border-sky-200/70 shadow-sm dark:border-sky-800/40"
      aria-label="Resumen de Base de Conocimiento por Kawiil AI"
    >
      <div
        className="flex items-center justify-between gap-3 border-b border-sky-200/40 px-4 py-3 dark:border-sky-800/30"
        style={{ background: KAWIIL_AI_HEADER_BG }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white shadow-sm"
            style={{ background: KAWIIL_AI_GRADIENT }}
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold leading-tight tracking-tight text-foreground">
              KAWIIL AI · Conocimiento
              <Badge
                variant="outline"
                className="ml-1 h-4 border-sky-300/70 bg-sky-50/70 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300"
              >
                v2.4
              </Badge>
            </p>
            <p className="mt-0.5 text-[10.5px] leading-tight text-muted-foreground">
              Qué está aprendiendo Kawiil y qué te conviene revisar después
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 px-2.5 text-[11px] text-muted-foreground hover:bg-white/60 hover:text-foreground dark:hover:bg-white/10"
          onClick={() => onGoToTab(next.tab)}
          title={next.reason}
        >
          {next.label}
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="space-y-3 bg-gradient-to-br from-sky-50/70 via-white to-blue-50/40 px-4 py-3 dark:from-sky-950/20 dark:via-card dark:to-blue-950/15">
        <p className="text-[13px] leading-relaxed text-foreground">{summary}</p>

        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => {
            const isActive = chip.key === activeTab;
            const Icon = chip.icon;
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => onGoToTab(chip.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  isActive
                    ? "border-sky-400/70 bg-sky-100/80 text-sky-700 dark:border-sky-400/60 dark:bg-sky-400/15 dark:text-sky-300"
                    : "border-border/60 bg-white/70 text-muted-foreground hover:border-sky-300/70 hover:bg-sky-50/70 hover:text-sky-700 dark:bg-white/5 dark:hover:bg-sky-500/10 dark:hover:text-sky-300"
                }`}
              >
                <Icon className="h-3 w-3" />
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
