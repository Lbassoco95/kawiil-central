import { useMemo, useState } from "react";
import {
  Sparkles,
  ArrowRight,
  RefreshCw,
  AtSign,
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCheck,
  ListChecks,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  KAWIIL_AI_GRADIENT,
  KAWIIL_AI_HEADER_BG,
} from "@/lib/kawiilAi";

/**
 * NotificationsKawiilCard — banner v2.4 "KAWIIL AI · Tu día" que se muestra
 * arriba de la lista de avisos. Resume en una sola tarjeta lo nuevo del día
 * (menciones, actividad y vencimientos) usando los conteos ya cargados,
 * sin llamadas extra a IA. Conserva el botón "Resumir con Kawiil" para
 * cuando exista una edge dedicada.
 */

type AlertCounts = {
  overdueTasks: number;
  overdueSteps: number;
  dueSoonTasks: number;
  dueSoonSteps: number;
};

interface Props {
  unreadMentions: number;
  totalMentions: number;
  unreadActivity: number;
  totalActivity: number;
  unreadSistema: number;
  alertCounts: AlertCounts;
  /** Texto destacado de la primera mención sin leer (si existe). */
  topMentionTitle?: string | null;
  topMentionBody?: string | null;
  topMentionAuthor?: string | null;
  onGoToTab: (tab: "menciones" | "actividad" | "sistema" | "vencimientos") => void;
  onMarkAllRead: () => void;
  markAllPending?: boolean;
}

function pluralize(n: number, sing: string, plural: string): string {
  return `${n} ${n === 1 ? sing : plural}`;
}

export function NotificationsKawiilCard({
  unreadMentions,
  totalMentions,
  unreadActivity,
  totalActivity,
  unreadSistema,
  alertCounts,
  topMentionTitle,
  topMentionBody,
  topMentionAuthor,
  onGoToTab,
  onMarkAllRead,
  markAllPending = false,
}: Props) {
  const [refreshTick, setRefreshTick] = useState(0);

  const totalUnread =
    unreadMentions + unreadActivity + unreadSistema;
  const totalOverdue = alertCounts.overdueTasks + alertCounts.overdueSteps;
  const totalDueSoon = alertCounts.dueSoonTasks + alertCounts.dueSoonSteps;

  const summary = useMemo(() => {
    void refreshTick;
    if (totalUnread === 0 && totalOverdue === 0 && totalDueSoon === 0) {
      return "Bandeja al día. No hay menciones, actividad ni vencimientos pendientes en este momento. Buen trabajo cerrando temas.";
    }
    const parts: string[] = [];
    if (unreadMentions > 0) {
      parts.push(`Tienes ${pluralize(unreadMentions, "mención sin leer", "menciones sin leer")}`);
    }
    if (unreadActivity > 0) {
      parts.push(`${pluralize(unreadActivity, "actualización del equipo", "actualizaciones del equipo")}`);
    }
    if (unreadSistema > 0) {
      parts.push(`${pluralize(unreadSistema, "aviso de sistema", "avisos de sistema")}`);
    }
    if (totalOverdue > 0) {
      parts.push(`${pluralize(totalOverdue, "compromiso vencido", "compromisos vencidos")}`);
    } else if (totalDueSoon > 0) {
      parts.push(`${pluralize(totalDueSoon, "vencimiento próximo", "vencimientos próximos")}`);
    }

    const head = parts.length > 0
      ? `Resumen del día: ${parts.join(", ")}.`
      : "Sin pendientes urgentes.";

    if (topMentionTitle) {
      const author = topMentionAuthor ? `${topMentionAuthor} · ` : "";
      const bodySnippet = topMentionBody ? ` "${topMentionBody.slice(0, 110).trim()}${topMentionBody.length > 110 ? "…" : ""}"` : "";
      return `${head} Empezaría por la mención más reciente — ${author}${topMentionTitle}.${bodySnippet}`;
    }
    if (totalOverdue > 0) {
      return `${head} Te sugiero abrir Vencimientos y atender primero los compromisos en rojo.`;
    }
    if (unreadMentions > 0) {
      return `${head} Te sugiero abrir Menciones para responder lo que requiere tu atención directa.`;
    }
    return head;
  }, [
    refreshTick,
    totalUnread,
    totalOverdue,
    totalDueSoon,
    unreadMentions,
    unreadActivity,
    unreadSistema,
    topMentionTitle,
    topMentionBody,
    topMentionAuthor,
  ]);

  return (
    <section
      className="overflow-hidden rounded-2xl border border-sky-200/70 shadow-sm dark:border-sky-800/40"
      aria-label="Resumen del día por Kawiil AI"
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
            <Sparkles className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold leading-tight tracking-tight text-foreground">
              KAWIIL AI · Tu día
              <Badge
                variant="outline"
                className="ml-1 h-4 border-sky-300/70 bg-sky-50/70 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300"
              >
                v2.4
              </Badge>
            </p>
            <p className="mt-0.5 text-[10.5px] leading-tight text-muted-foreground">
              Resumen de lo nuevo en tu bandeja
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRefreshTick((t) => t + 1)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-white/60 hover:text-foreground dark:hover:bg-white/10"
          title="Regenerar resumen"
          aria-label="Regenerar resumen"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-3 bg-gradient-to-br from-sky-50/70 via-white to-blue-50/40 p-4 dark:from-sky-950/20 dark:via-card dark:to-blue-950/15">
        <p className="text-sm leading-relaxed text-foreground">{summary}</p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => onGoToTab("menciones")}
            className="group flex items-center justify-between rounded-xl border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-left transition-colors hover:bg-amber-100/60 dark:border-amber-800/40 dark:bg-amber-950/20 dark:hover:bg-amber-950/30"
          >
            <div>
              <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                <AtSign className="h-3 w-3" /> Menciones
              </p>
              <p className="mt-0.5 text-lg font-semibold leading-none text-amber-700 dark:text-amber-200">
                {unreadMentions}
              </p>
              <p className="mt-0.5 text-[10px] text-amber-700/80 dark:text-amber-300/80">
                de {totalMentions}
              </p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-amber-700/70 transition-transform group-hover:translate-x-0.5 dark:text-amber-300/70" />
          </button>

          <button
            type="button"
            onClick={() => onGoToTab("actividad")}
            className="group flex items-center justify-between rounded-xl border border-sky-200/70 bg-sky-50/60 px-3 py-2 text-left transition-colors hover:bg-sky-100/60 dark:border-sky-800/40 dark:bg-sky-950/20 dark:hover:bg-sky-950/30"
          >
            <div>
              <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                <Activity className="h-3 w-3" /> Actividad
              </p>
              <p className="mt-0.5 text-lg font-semibold leading-none text-sky-700 dark:text-sky-200">
                {unreadActivity}
              </p>
              <p className="mt-0.5 text-[10px] text-sky-700/80 dark:text-sky-300/80">
                de {totalActivity}
              </p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-sky-700/70 transition-transform group-hover:translate-x-0.5 dark:text-sky-300/70" />
          </button>

          <button
            type="button"
            onClick={() => onGoToTab("vencimientos")}
            className="group flex items-center justify-between rounded-xl border border-rose-200/70 bg-rose-50/60 px-3 py-2 text-left transition-colors hover:bg-rose-100/60 dark:border-rose-800/40 dark:bg-rose-950/20 dark:hover:bg-rose-950/30"
          >
            <div>
              <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                <AlertTriangle className="h-3 w-3" /> Vencidas
              </p>
              <p className="mt-0.5 text-lg font-semibold leading-none text-rose-700 dark:text-rose-200">
                {totalOverdue}
              </p>
              <p className="mt-0.5 text-[10px] text-rose-700/80 dark:text-rose-300/80">
                +{totalDueSoon} próximas
              </p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-rose-700/70 transition-transform group-hover:translate-x-0.5 dark:text-rose-300/70" />
          </button>

          <button
            type="button"
            onClick={() => onGoToTab("sistema")}
            className="group flex items-center justify-between rounded-xl border border-blue-200/70 bg-blue-50/60 px-3 py-2 text-left transition-colors hover:bg-blue-100/60 dark:border-blue-800/40 dark:bg-blue-950/20 dark:hover:bg-blue-950/30"
          >
            <div>
              <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                <CalendarClock className="h-3 w-3" /> Sistema
              </p>
              <p className="mt-0.5 text-lg font-semibold leading-none text-blue-700 dark:text-blue-200">
                {unreadSistema}
              </p>
              <p className="mt-0.5 text-[10px] text-blue-700/80 dark:text-blue-300/80">
                IA · agentes
              </p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-blue-700/70 transition-transform group-hover:translate-x-0.5 dark:text-blue-300/70" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 px-3 text-[11.5px] text-white shadow-sm hover:opacity-95"
            style={{ background: KAWIIL_AI_GRADIENT }}
            onClick={() => onGoToTab(unreadMentions > 0 ? "menciones" : totalOverdue > 0 ? "vencimientos" : "actividad")}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Atender lo prioritario
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-3 text-[11.5px]"
            onClick={() => onGoToTab("vencimientos")}
            disabled={totalOverdue + totalDueSoon === 0}
          >
            <ListChecks className="h-3.5 w-3.5" />
            Ver vencimientos
          </Button>
          {totalUnread > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 px-3 text-[11.5px] text-muted-foreground hover:text-foreground"
              onClick={onMarkAllRead}
              disabled={markAllPending}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Marcar todas como leídas
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
