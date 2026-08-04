import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutGrid, AlertTriangle, Loader2, RefreshCw, FileText, Scale, Sparkles } from "lucide-react";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import { cn } from "@/lib/utils";
import { useAiModuleBriefing, sha256Hex, briefingJsonInstructions } from "@/hooks/useAiModuleBriefing";
import { PROYECTOS_METRIC_KEYS } from "@/components/dashboard/AiHeroV24";
import { MetricInsightChips } from "@/components/dashboard/MetricInsightChips";
import { AiFeedback } from "@/components/ai/AiFeedback";
import { aiFeedbackKey } from "@/lib/aiFeedbackKey";

const PROYECTOS_METRIC_LABELS: Record<string, string> = {
  proyectos_activos: "Activos",
  en_riesgo: "En riesgo",
  sin_actividad: "Sin actividad",
};

interface ProjectBriefRow {
  id: string;
  name: string;
  status: string;
  area?: string | null;
  client_name?: string | null;
  criticality_level?: string | null;
  delay_category?: string | null;
  progress_pct?: number | null;
  updated_at?: string | null;
}

interface Props {
  /** Lista filtrada de proyectos visibles para el usuario (tras filtros activos). */
  projects: ProjectBriefRow[];
  /** (Legacy) cacheKey — ya no se usa. El cache ahora vive en Supabase. Se mantiene por compat. */
  cacheKey?: string;
  /** True cuando ya hay datos cargados; evita disparar IA en hidratación inicial. */
  ready: boolean;
  className?: string;
  /** Callbacks para los CTAs. Si no se pasan, se navega al asistente con prompt. */
  onSeeRisks?: () => void;
  onRebalance?: () => void;
  onGenerateReport?: () => void;
}

/**
 * Card "Briefing · Tus proyectos" del módulo Proyectos.
 * Genera un resumen IA de 2-3 líneas focalizado en proyectos en riesgo y oportunidades
 * de adelanto. El resumen se cachea en `public.ai_module_briefings` (módulo `proyectos`)
 * por día y usuario, con invalidación por `payload_hash` cuando cambian los proyectos.
 */
export function ProjectsBriefingCard({
  projects,
  ready,
  className,
  onSeeRisks,
  onRebalance,
  onGenerateReport,
}: Props) {
  const navigate = useNavigate();

  // Conteos para fallback / pre-aviso (siempre disponibles aunque IA falle).
  const counts = useMemo(() => {
    const activos = projects.filter((p) => p.status === "activo");
    const enRiesgo = activos.filter(
      (p) => p.criticality_level === "critico" || p.delay_category === "retrasado",
    );
    const sinActividad = activos.filter((p) => {
      if (!p.updated_at) return false;
      const days = Math.floor((Date.now() - new Date(p.updated_at).getTime()) / (24 * 60 * 60 * 1000));
      return days >= 7;
    });
    return { activos, enRiesgo, sinActividad };
  }, [projects]);

  const payload = useMemo(
    () => ({
      v: 1,
      module: "proyectos",
      activos: counts.activos.length,
      enRiesgo: counts.enRiesgo.length,
      sinActividad: counts.sinActividad.length,
      topIds: counts.enRiesgo.slice(0, 8).map((p) => p.id),
    }),
    [counts],
  );

  const [payloadHash, setPayloadHash] = useState("");
  useEffect(() => {
    if (!ready) return;
    void sha256Hex(JSON.stringify(payload)).then(setPayloadHash);
  }, [payload, ready]);

  const briefing = useAiModuleBriefing({
    module: "proyectos",
    payloadHash,
    // On-demand: el usuario dispara la generación con el botón "Generar briefing".
    // Si ya existe fila del día para este usuario, se sirve del cache sin llamar a IA.
    autoFetch: false,
    enabled: ready && !!payloadHash,
    buildMessages: () => {
      const sample = counts.enRiesgo
        .slice(0, 8)
        .map((p) => {
          const parts = [p.name];
          if (p.client_name) parts.push(`cliente ${p.client_name}`);
          if (p.criticality_level === "critico") parts.push("CRÍTICO");
          if (p.delay_category === "retrasado") parts.push("RETRASADO");
          if (typeof p.progress_pct === "number") parts.push(`${Math.round(p.progress_pct)}% avance`);
          return `- ${parts.join(" · ")}`;
        })
        .join("\n");
      const prompt = [
        "Eres un copiloto operativo de un despacho fiscal/legal. Genera un BRIEFING ULTRA CORTO (máximo 2 párrafos cortos, sin listas, sin saludos).",
        "Tono directo, ejecutivo, español de México. NO repitas conteos ya visibles, NO inventes datos.",
        "",
        "Contexto:",
        `- Proyectos activos: ${counts.activos.length}`,
        `- En riesgo (crítico o retrasado): ${counts.enRiesgo.length}`,
        `- Sin actividad ≥ 7 días: ${counts.sinActividad.length}`,
        counts.enRiesgo.length > 0 ? `\nProyectos en riesgo (top):\n${sample}` : "",
        "",
        "INSTRUCCIONES PARA \"markdown\":",
        "Estructura: 1) qué proyecto(s) atender PRIMERO y por qué (con nombre concreto), 2) si aplica, una oportunidad de adelantar otro proyecto. Si todo está bien, dilo y sugiere una mejora marginal.",
        "",
        "INSTRUCCIONES PARA \"metric_insights\":",
        "- proyectos_activos: 1 frase sobre el estado general de la cartera activa.",
        "- en_riesgo: 1 frase con el proyecto concreto que más urge; omite si es 0.",
        "- sin_actividad: 1 frase con la acción para reactivar; omite si es 0.",
        briefingJsonInstructions({ metricKeys: [...PROYECTOS_METRIC_KEYS] }),
      ].join("\n");
      return [{ role: "user", content: prompt }];
    },
  });

  const handleSeeRisks = useCallback(() => {
    if (onSeeRisks) return onSeeRisks();
    navigate(
      `/asistente?prompt=${encodeURIComponent(
        "Lista los proyectos de mi despacho que están en riesgo (crítico o retrasado), por qué y la próxima acción concreta para cada uno.",
      )}`,
    );
  }, [navigate, onSeeRisks]);

  const handleRebalance = useCallback(() => {
    if (onRebalance) return onRebalance();
    navigate(
      `/asistente?prompt=${encodeURIComponent(
        "Rebalancea la carga de mis proyectos: qué proyectos puedo despriorizar o reasignar para liberar tiempo en los críticos.",
      )}`,
    );
  }, [navigate, onRebalance]);

  const handleReport = useCallback(() => {
    if (onGenerateReport) return onGenerateReport();
    navigate(
      `/asistente?prompt=${encodeURIComponent(
        "Genera un reporte ejecutivo de mis proyectos activos: avance, riesgos, próximos hitos y bloqueos.",
      )}`,
    );
  }, [navigate, onGenerateReport]);

  const loading = briefing.isLoading || briefing.isRefreshing;
  const content = briefing.content;
  const error = briefing.error;

  return (
    <section
      className={cn(
        "rounded-2xl border border-border/70 px-5 py-4 sm:px-6 sm:py-5",
        className,
      )}
      style={{
        background:
          "radial-gradient(ellipse 420px 160px at 0% 0%, hsl(var(--primary) / 0.08), transparent 70%), " +
          "radial-gradient(ellipse 320px 120px at 100% 100%, hsl(var(--accent) / 0.07), transparent 70%), " +
          "hsl(var(--card))",
      }}
    >
      <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-primary">
        <LayoutGrid className="h-3 w-3" />
        <span>Briefing · tus proyectos</span>
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-1" />
        ) : content ? (
          <button
            type="button"
            onClick={() => void briefing.regenerate()}
            className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Regenerar briefing"
            aria-label="Regenerar briefing"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      <div className="mt-3 min-h-[44px] text-sm leading-relaxed text-foreground">
        {error && !content ? (
          <p className="text-xs text-destructive">
            {error.message} · {counts.enRiesgo.length > 0
              ? `${counts.enRiesgo.length} proyecto${counts.enRiesgo.length === 1 ? "" : "s"} en riesgo requiere${counts.enRiesgo.length === 1 ? "" : "n"} atención.`
              : "todo en orden."}
          </p>
        ) : content ? (
          <>
            <KawiilAiMarkdown className="text-sm leading-relaxed">
              {content}
            </KawiilAiMarkdown>
            {Object.keys(briefing.metricInsights).length > 0 && (
              <MetricInsightChips
                insights={briefing.metricInsights}
                labels={PROYECTOS_METRIC_LABELS}
                order={[...PROYECTOS_METRIC_KEYS]}
              />
            )}
            <div className="mt-2 flex justify-end">
              <AiFeedback surface="projects_briefing" contextKey={aiFeedbackKey(content)} />
            </div>
          </>
        ) : loading ? (
          <p className="text-xs text-muted-foreground">Analizando tu cartera de proyectos…</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {counts.enRiesgo.length > 0
                ? `${counts.enRiesgo.length} proyecto${counts.enRiesgo.length === 1 ? "" : "s"} requiere${counts.enRiesgo.length === 1 ? "" : "n"} atención.`
                : "Todos tus proyectos activos están sin alertas."}
            </p>
            <button
              type="button"
              onClick={() => void briefing.regenerate()}
              disabled={!ready || !payloadHash}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-[11.5px] font-medium text-primary transition-colors hover:border-primary/50 hover:bg-primary/10 disabled:opacity-50"
              title="Generar briefing con Kawiil AI"
            >
              <Sparkles className="h-3 w-3" />
              Generar briefing del día
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSeeRisks}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-xs font-medium text-foreground/90 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
        >
          <AlertTriangle className="h-3 w-3 text-warning" />
          Ver riesgos
        </button>
        <button
          type="button"
          onClick={handleRebalance}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-xs font-medium text-foreground/90 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
        >
          <Scale className="h-3 w-3 text-primary" />
          Rebalancear
        </button>
        <button
          type="button"
          onClick={handleReport}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-xs font-medium text-foreground/90 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
        >
          <FileText className="h-3 w-3 text-accent" />
          Reporte
        </button>
      </div>
    </section>
  );
}
