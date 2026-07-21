import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  ListChecks,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ListTodo,
  Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

/**
 * CalendarKawiilCard — Ficha "Kawiil AI · Resumen del día/semana" para el módulo Calendario.
 *
 * Dispara la edge `calendar-ai-summary` con los eventos y tareas con vencimiento
 * del periodo activo, y muestra:
 *   - Briefing ejecutivo (2-3 oraciones)
 *   - Highlights (juntas clave / focos / preparación)
 *   - Conflictos detectados (traslapes, sin pausas, jornada cargada)
 *   - Acción sugerida
 *
 * Diseño v2.4: gradiente azul Kawiil (sky → blue), no morado.
 */

const KAWIIL_AI_GRADIENT = "linear-gradient(135deg, hsl(200 100% 50%), hsl(220 100% 55%))";

type EventForAi = {
  subject: string;
  start: string;
  end?: string | null;
  location?: string | null;
  attendeesCount?: number;
  isOnline?: boolean;
  importance?: "low" | "normal" | "high";
  categories?: string[];
};

type TaskForAi = {
  title: string;
  due: string;
  status?: string;
  priority?: string | null;
};

type SummaryResult = {
  briefing: string;
  highlights: string[];
  conflicts: string[];
  suggestedAction: string | null;
};

interface Props {
  scope: "day" | "week";
  periodLabel: string;
  events: EventForAi[];
  tasksDue: TaskForAi[];
  /** Clave estable para cachear/regenerar (ej. ymd o range). */
  cacheKey: string;
  className?: string;
  /** Permite el botón "Crear tarea" cuando hay acción sugerida. */
  onCreateTask?: (suggestedTitle?: string | null) => void;
}

const TAB_DEFS = [
  { id: "briefing", label: "Resumen", icon: Sparkles },
  { id: "highlights", label: "Highlights", icon: ListChecks },
  { id: "conflicts", label: "Conflictos", icon: AlertTriangle },
] as const;

type TabId = typeof TAB_DEFS[number]["id"];

export function CalendarKawiilCard({
  scope,
  periodLabel,
  events,
  tasksDue,
  cacheKey,
  className,
  onCreateTask,
}: Props) {
  const [tab, setTab] = useState<TabId>("briefing");
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fingerprint = useMemo(() => {
    const ev = events
      .map((e) => `${e.start}|${e.subject}|${e.end ?? ""}`)
      .join("§");
    const tk = tasksDue.map((t) => `${t.due}|${t.title}`).join("§");
    return `${cacheKey}::${ev}::${tk}`;
  }, [cacheKey, events, tasksDue]);

  const localCacheKey = `kawiil-calendar-ai-${fingerprint}`;

  const fetchSummary = useCallback(
    async (force = false) => {
      if (events.length === 0 && tasksDue.length === 0) {
        setSummary({
          briefing:
            scope === "week"
              ? "Tu semana está abierta: sin eventos ni tareas con vencimiento programadas."
              : "Tu día está libre: sin eventos ni tareas con vencimiento.",
          highlights: [],
          conflicts: [],
          suggestedAction: null,
        });
        return;
      }
      if (!force && typeof window !== "undefined") {
        try {
          const cached = localStorage.getItem(localCacheKey);
          if (cached) {
            const parsed = JSON.parse(cached) as SummaryResult;
            if (parsed && typeof parsed === "object" && "briefing" in parsed) {
              setSummary(parsed);
              return;
            }
          }
        } catch {
          /* ignore */
        }
      }
      setLoading(true);
      setError(null);
      try {
        const { data, error: invokeError } = await supabase.functions.invoke<
          SummaryResult & { error?: string; message?: string; empty?: boolean }
        >("calendar-ai-summary", {
          body: {
            scope,
            periodLabel,
            events,
            tasksDue,
            locale: "es",
          },
        });
        if (invokeError) throw new Error(invokeError.message || "Error AI");
        if (!data || (data as { error?: string }).error) {
          throw new Error(
            (data as { message?: string })?.message ||
              (data as { error?: string })?.error ||
              "Sin resumen",
          );
        }
        const next: SummaryResult = {
          briefing: typeof data.briefing === "string" ? data.briefing : "",
          highlights: Array.isArray(data.highlights) ? data.highlights : [],
          conflicts: Array.isArray(data.conflicts) ? data.conflicts : [],
          suggestedAction:
            typeof data.suggestedAction === "string" && data.suggestedAction.trim().length > 0
              ? data.suggestedAction
              : null,
        };
        setSummary(next);
        try {
          localStorage.setItem(localCacheKey, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error desconocido");
      } finally {
        setLoading(false);
      }
    },
    [events, tasksDue, scope, periodLabel, localCacheKey],
  );

  useEffect(() => {
    setSummary(null);
    setError(null);
    setTab("briefing");
    void fetchSummary(false);
  }, [fingerprint, fetchSummary]);

  const conflictsCount = summary?.conflicts.length ?? 0;
  const showConflictBadge = conflictsCount > 0;

  // Tabs + cuerpo reutilizables (en la tarjeta angosta y en el diálogo ancho).
  const renderTabs = () => (
    <div className="flex items-center gap-1 border-b border-sky-200/40 px-3 pt-2 dark:border-sky-900/30">
      {TAB_DEFS.map((t) => {
        const active = tab === t.id;
        const Icon = t.icon;
        const count = t.id === "highlights"
          ? summary?.highlights.length ?? 0
          : t.id === "conflicts"
            ? summary?.conflicts.length ?? 0
            : 0;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-t-md border-b-2 px-2 py-1.5 text-[11px] font-medium transition-colors",
              active
                ? "border-sky-500 text-sky-700 dark:text-sky-300"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3 w-3" />
            {t.label}
            {count > 0 && (
              <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-sky-100 px-1 text-[9px] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  const renderBody = () => (
    <div className="px-4 py-3 text-sm text-foreground/85">
      {loading && !summary && (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Generando resumen del calendario…
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {summary && tab === "briefing" && (
        <p className="leading-relaxed text-foreground/90">
          {summary.briefing || "Sin resumen disponible."}
        </p>
      )}

      {summary && tab === "highlights" && (
        summary.highlights.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">No se detectaron focos relevantes.</p>
        ) : (
          <ul className="space-y-1.5">
            {summary.highlights.map((kp, idx) => (
              <li key={idx} className="flex gap-2 text-[13px] leading-relaxed">
                <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                <span>{kp}</span>
              </li>
            ))}
          </ul>
        )
      )}

      {summary && tab === "conflicts" && (
        summary.conflicts.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">Sin conflictos: la agenda fluye bien.</p>
        ) : (
          <ul className="space-y-1.5">
            {summary.conflicts.map((c, idx) => (
              <li key={idx} className="flex gap-2 text-[13px] leading-relaxed text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        )
      )}

      {summary?.suggestedAction && (
        <div className="mt-3 flex flex-wrap items-start gap-2 rounded-lg border border-sky-300/40 bg-white/70 px-3 py-2 dark:border-sky-700/40 dark:bg-sky-950/20">
          <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300">
              Acción sugerida
            </p>
            <p className="mt-0.5 text-[13px] leading-snug text-foreground">
              {summary.suggestedAction}
            </p>
            {onCreateTask && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-1 h-7 px-2 text-[11px] text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/30"
                onClick={() => onCreateTask(summary.suggestedAction)}
              >
                <ListTodo className="mr-1 h-3 w-3" />
                Crear tarea desde esta acción
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        "rounded-2xl border border-sky-200/60 bg-gradient-to-br from-sky-50 via-white to-blue-50 shadow-sm",
        "dark:border-sky-900/40 dark:from-sky-950/30 dark:via-background dark:to-blue-950/20",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-sky-200/50 px-3 py-2 dark:border-sky-900/30">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-sm ring-1 ring-sky-300/40"
            style={{ background: KAWIIL_AI_GRADIENT }}
          >
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">
              Kawiil AI · {scope === "week" ? "Resumen semanal" : "Resumen del día"}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {loading ? "Procesando…" : `${periodLabel} · ${events.length} eventos · ${tasksDue.length} tareas`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {showConflictBadge && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              {conflictsCount} conflicto{conflictsCount === 1 ? "" : "s"}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => void fetchSummary(true)}
            disabled={loading}
            aria-label="Regenerar resumen"
            title="Regenerar resumen"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setExpanded(true)}
            aria-label="Ver en grande"
            title="Ver en grande"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expandir" : "Colapsar"}
            title={collapsed ? "Expandir" : "Colapsar"}
          >
            {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <>
          {renderTabs()}
          {renderBody()}
        </>
      )}

      {/* Vista ampliada: el mismo resumen en un diálogo ancho y cómodo de leer */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <span
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-sm ring-1 ring-sky-300/40"
                style={{ background: KAWIIL_AI_GRADIENT }}
              >
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </span>
              Kawiil AI · {scope === "week" ? "Resumen semanal" : "Resumen del día"}
              {showConflictBadge && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
                  <AlertTriangle className="h-3 w-3" />
                  {conflictsCount} conflicto{conflictsCount === 1 ? "" : "s"}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <p className="text-[11px] text-muted-foreground -mt-1">
            {periodLabel} · {events.length} eventos · {tasksDue.length} tareas
          </p>
          <div className="rounded-xl border border-sky-200/60 bg-gradient-to-br from-sky-50 via-white to-blue-50 dark:border-sky-900/40 dark:from-sky-950/30 dark:via-background dark:to-blue-950/20">
            {renderTabs()}
            {renderBody()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
