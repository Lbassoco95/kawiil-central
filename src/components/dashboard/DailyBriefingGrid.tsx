import { useMemo, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Calendar,
  CheckSquare,
  FolderKanban,
  Inbox,
  Kanban,
  MessageSquare,
  Wallet,
  ArrowRight,
  AlertTriangle,
  Clock,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useMyActiveProjectsProgress } from "@/hooks/useMyActiveProjectsProgress";
import { useCalendarEvents, useUnreadEmailCount } from "@/hooks/useMicrosoft";
import { useExpenses } from "@/hooks/useExpenses";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { usePipelineLeads } from "@/hooks/usePipeline";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import {
  toDateStringMX,
  mexicoDayRangeISO,
  formatMX,
} from "@/lib/dateUtils";

interface CardSkin {
  icon: typeof Calendar;
  iconWrap: string;
  ring: string;
}

const SKIN: Record<string, CardSkin> = {
  tareas: {
    icon: CheckSquare,
    iconWrap: "bg-primary/10 text-primary",
    ring: "ring-primary/15",
  },
  proyectos: {
    icon: FolderKanban,
    iconWrap: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    ring: "ring-amber-500/15",
  },
  calendario: {
    icon: Calendar,
    iconWrap: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    ring: "ring-emerald-500/15",
  },
  correo: {
    icon: Inbox,
    iconWrap: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    ring: "ring-sky-500/15",
  },
  finanzas: {
    icon: Wallet,
    iconWrap: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
    ring: "ring-violet-500/15",
  },
  pipeline: {
    icon: Kanban,
    iconWrap: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
    ring: "ring-rose-500/15",
  },
  slack: {
    icon: MessageSquare,
    iconWrap: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400",
    ring: "ring-fuchsia-500/15",
  },
};

interface BriefingCardProps {
  skinKey: keyof typeof SKIN;
  title: string;
  to: string;
  badgeValue?: string | number;
  badgeTone?: "default" | "warning" | "destructive" | "success";
  children: ReactNode;
  empty?: boolean;
}

function BriefingCard({
  skinKey,
  title,
  to,
  badgeValue,
  badgeTone = "default",
  children,
  empty,
}: BriefingCardProps) {
  const skin = SKIN[skinKey];
  const Icon = skin.icon;
  const badgeClass =
    badgeTone === "destructive"
      ? "bg-destructive/15 text-destructive"
      : badgeTone === "warning"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : badgeTone === "success"
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : "bg-primary/15 text-primary";

  return (
    <Link
      to={to}
      className={cn(
        "group surface-glass-subtle flex h-full flex-col gap-3 rounded-2xl border border-border/40 bg-card/60 p-4 ring-1 transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-primary/20",
        skin.ring,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-xl ring-1 ring-inset ring-border/30",
              skin.iconWrap,
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold text-foreground leading-tight truncate">
            {title}
          </h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {badgeValue != null && badgeValue !== "" && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                badgeClass,
              )}
            >
              {badgeValue}
            </span>
          )}
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
      </div>
      <div className={cn("flex-1 text-[12px]", empty && "text-muted-foreground italic")}>
        {children}
      </div>
    </Link>
  );
}

interface PendingTaskMin {
  id: string;
  title: string;
  due_date: string | null;
  priority: string;
  project_id: string | null;
}

interface Props {
  pendingTasks: PendingTaskMin[];
  todayYmd: string;
  completedToday: number;
  overdueCount: number;
  dueTodayCount: number;
  /** Abre el detalle de la tarea en el lugar (modal). Si no se pasa, navega. */
  onOpenTask?: (taskId: string) => void;
}

/**
 * Daily briefing grid (Tanda 6): cards modulares cross-módulo en una sola
 * vista. Tareas, Proyectos, Calendario, Correo, Finanzas, Pipeline y Slack.
 * Cada card muestra datos reales y enlaza al módulo correspondiente.
 */
export function DailyBriefingGrid({
  pendingTasks,
  todayYmd,
  completedToday,
  overdueCount,
  dueTodayCount,
  onOpenTask,
}: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = useMexicoToday();

  const dayRange = useMemo(() => mexicoDayRangeISO(todayYmd), [todayYmd]);

  const { data: projectsProgress } = useMyActiveProjectsProgress();
  const { data: events = [] } = useCalendarEvents(dayRange.start, dayRange.endExclusive);
  const { data: unreadMail } = useUnreadEmailCount();
  const { data: expenses = [] } = useExpenses();
  const { hasFinanceAccess } = useFinanceAccess();
  const { data: leads = [] } = usePipelineLeads(true);

  // ─── Tareas ────────────────────────────────────────
  const topTasks = useMemo(() => pendingTasks.slice(0, 3), [pendingTasks]);

  // ─── Proyectos: peor avance, máx 3 ─────────────────
  const projectsAtRisk = useMemo(() => {
    const list = (projectsProgress ?? []).slice();
    list.sort((a, b) => (a.primaryPct || 0) - (b.primaryPct || 0));
    return list.slice(0, 3);
  }, [projectsProgress]);

  // ─── Calendario hoy ───────────────────────────────
  const eventsToday = useMemo(() => {
    return (events as any[])
      .filter((e) => e?.start?.dateTime || e?.start)
      .slice(0, 3)
      .map((e) => {
        const startIso = e?.start?.dateTime ?? e?.start ?? null;
        const subject = e?.subject ?? e?.title ?? "(Sin asunto)";
        return { id: e.id, subject, startIso, isOnline: !!e.isOnlineMeeting };
      });
  }, [events]);

  // ─── Finanzas ─────────────────────────────────────
  const financeStats = useMemo(() => {
    if (!hasFinanceAccess) return null;
    const aprobados = expenses.filter((e) => e.status === "aprobado");
    const aprobadosSum = aprobados.reduce((s, e) => s + Number(e.amount), 0);
    const pendientes = expenses.filter((e) => ["solicitado", "en_revision"].includes(e.status));
    const pendientesSum = pendientes.reduce((s, e) => s + Number(e.amount), 0);
    return {
      aprobadosCount: aprobados.length,
      aprobadosSum,
      pendientesCount: pendientes.length,
      pendientesSum,
    };
  }, [expenses, hasFinanceAccess]);

  // ─── Pipeline ─────────────────────────────────────
  const myLeads = useMemo(() => {
    if (!user) return [] as any[];
    return leads.filter((l: any) => l.owner_id === user.id);
  }, [leads, user]);

  const staleLeadCount = useMemo(() => {
    const sevenAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return myLeads.filter((l: any) => {
      const ts = l.last_contact_at || l.updated_at || l.created_at;
      if (!ts) return true;
      return new Date(ts).getTime() < sevenAgo;
    }).length;
  }, [myLeads]);

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 0,
    }).format(n);

  const priorityDot = (p: string) => {
    switch (p) {
      case "urgente":
        return "bg-destructive";
      case "alta":
        return "bg-warning";
      case "media":
        return "bg-primary";
      default:
        return "bg-muted-foreground/30";
    }
  };

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tu briefing de hoy
        </h3>
        <span className="text-[10px] text-muted-foreground/60">
          · {formatMX(today, "EEEE dd 'de' MMMM")}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {/* Tareas */}
        <BriefingCard
          skinKey="tareas"
          title="Tareas"
          to="/tareas"
          badgeValue={pendingTasks.length}
          badgeTone={overdueCount > 0 ? "destructive" : pendingTasks.length === 0 ? "success" : "default"}
        >
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-muted-foreground">
              <span><b className="text-foreground">{overdueCount}</b> vencidas</span>
              <span><b className="text-foreground">{dueTodayCount}</b> hoy</span>
              <span><b className="text-emerald-600">{completedToday}</b> completadas hoy</span>
            </div>
            {topTasks.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">Sin pendientes asignadas.</p>
            ) : (
              <ul className="space-y-1">
                {topTasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-2 truncate"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (onOpenTask) onOpenTask(t.id);
                      else navigate(t.project_id ? `/proyectos/${t.project_id}?tab=tareas&taskId=${t.id}` : `/tareas?taskId=${t.id}`);
                    }}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", priorityDot(t.priority))} />
                    <span className="truncate text-foreground hover:text-primary cursor-pointer">{t.title}</span>
                    {t.due_date && (
                      <span className="ml-auto text-[10px] text-muted-foreground tabular-nums shrink-0">
                        {formatMX(t.due_date, "dd MMM")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </BriefingCard>

        {/* Proyectos */}
        <BriefingCard
          skinKey="proyectos"
          title="Proyectos activos"
          to="/proyectos"
          badgeValue={projectsProgress?.length ?? 0}
          badgeTone="default"
          empty={!projectsProgress?.length}
        >
          {!projectsProgress?.length ? (
            <p className="text-[11px] text-muted-foreground italic">No eres responsable de ningún proyecto activo.</p>
          ) : (
            <ul className="space-y-1.5">
              {projectsAtRisk.map((p) => (
                <li
                  key={p.id}
                  className="space-y-0.5"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigate(`/proyectos/${p.id}`);
                  }}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="truncate text-[11.5px] text-foreground hover:text-primary cursor-pointer">
                      {p.name}
                    </span>
                    <span className="ml-auto text-[10px] tabular-nums text-muted-foreground shrink-0">
                      {p.primaryTotal > 0 ? `${p.primaryPct}%` : "—"}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-secondary/40 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        p.primaryPct >= 70 ? "bg-emerald-500" : p.primaryPct >= 40 ? "bg-amber-500" : "bg-destructive",
                      )}
                      style={{ width: `${p.primaryPct || 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </BriefingCard>

        {/* Calendario */}
        <BriefingCard
          skinKey="calendario"
          title="Agenda de hoy"
          to="/microsoft365/calendario"
          badgeValue={events.length}
          badgeTone="default"
          empty={!events.length}
        >
          {!events.length ? (
            <p className="text-[11px] text-muted-foreground italic">Sin eventos hoy en Outlook.</p>
          ) : (
            <ul className="space-y-1">
              {eventsToday.map((e) => {
                const time = e.startIso
                  ? new Date(e.startIso).toLocaleTimeString("es-MX", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "America/Mexico_City",
                    })
                  : "—";
                return (
                  <li key={e.id} className="flex items-center gap-2 truncate">
                    <Clock className="h-3 w-3 shrink-0 text-emerald-600" />
                    <span className="truncate text-foreground text-[11.5px]">{e.subject}</span>
                    <span className="ml-auto text-[10px] tabular-nums text-muted-foreground shrink-0">{time}</span>
                  </li>
                );
              })}
              {events.length > 3 && (
                <li className="text-[10.5px] text-muted-foreground italic">
                  +{events.length - 3} más en tu calendario
                </li>
              )}
            </ul>
          )}
        </BriefingCard>

        {/* Correo */}
        <BriefingCard
          skinKey="correo"
          title="Correo"
          to="/microsoft365/correo"
          badgeValue={typeof unreadMail === "number" ? unreadMail : undefined}
          badgeTone={typeof unreadMail === "number" && unreadMail > 0 ? "warning" : "default"}
        >
          {typeof unreadMail === "number" ? (
            unreadMail === 0 ? (
              <p className="text-[11px] text-emerald-600">Inbox al día — sin correos sin leer.</p>
            ) : (
              <p className="text-[11.5px] text-muted-foreground leading-snug">
                Tienes <b className="text-foreground">{unreadMail}</b> correo
                {unreadMail === 1 ? "" : "s"} sin leer en Outlook. Abre el triaje IA dentro
                del módulo para clasificarlos.
              </p>
            )
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              Conecta Outlook desde Microsoft 365 para ver tu inbox.
            </p>
          )}
        </BriefingCard>

        {/* Finanzas */}
        {financeStats && (
          <BriefingCard
            skinKey="finanzas"
            title="Finanzas"
            to="/finanzas?tab=resumen"
            badgeValue={financeStats.aprobadosCount + financeStats.pendientesCount}
            badgeTone={financeStats.pendientesCount > 0 ? "warning" : "default"}
          >
            <ul className="space-y-1 text-[11.5px]">
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Wallet className="h-3 w-3" />
                  Aprobados sin pagar
                </span>
                <span className="tabular-nums font-medium text-foreground">
                  {fmtMoney(financeStats.aprobadosSum)}{" "}
                  <span className="text-[10px] text-muted-foreground">
                    ({financeStats.aprobadosCount})
                  </span>
                </span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  En revisión
                </span>
                <span className="tabular-nums font-medium text-foreground">
                  {fmtMoney(financeStats.pendientesSum)}{" "}
                  <span className="text-[10px] text-muted-foreground">
                    ({financeStats.pendientesCount})
                  </span>
                </span>
              </li>
            </ul>
            <p className="mt-1.5 text-[10.5px] text-muted-foreground italic">
              Revisa alertas de cashflow en el resumen de Finanzas.
            </p>
          </BriefingCard>
        )}

        {/* Pipeline */}
        {myLeads.length > 0 && (
          <BriefingCard
            skinKey="pipeline"
            title="Mis leads"
            to="/pipeline/dashboard"
            badgeValue={myLeads.length}
            badgeTone={staleLeadCount > 0 ? "warning" : "default"}
          >
            <ul className="space-y-1 text-[11.5px]">
              <li className="flex items-center gap-1.5 text-muted-foreground">
                <TrendingUp className="h-3 w-3" />
                <b className="text-foreground">{myLeads.length}</b> activos en tu pipeline
              </li>
              <li className="flex items-center gap-1.5 text-muted-foreground">
                <AlertTriangle
                  className={cn(
                    "h-3 w-3",
                    staleLeadCount > 0 ? "text-amber-600" : "text-muted-foreground/40",
                  )}
                />
                {staleLeadCount > 0 ? (
                  <>
                    <b className="text-amber-700 dark:text-amber-400">{staleLeadCount}</b> sin
                    actividad en 7+ días
                  </>
                ) : (
                  "Sin leads abandonados"
                )}
              </li>
            </ul>
            <p className="mt-1.5 text-[10.5px] text-muted-foreground italic">
              Toca para abrir el dashboard ejecutivo del pipeline.
            </p>
          </BriefingCard>
        )}

        {/* Slack */}
        <BriefingCard skinKey="slack" title="Slack" to="/comunicacion">
          <p className="text-[11.5px] text-muted-foreground leading-snug">
            Canales, hilos y mensajes directos del workspace. Usa el panel IA del canal
            para resumen y borradores.
          </p>
        </BriefingCard>
      </div>
    </section>
  );
}
