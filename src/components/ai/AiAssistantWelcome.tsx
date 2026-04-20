import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Calendar,
  CheckSquare,
  ExternalLink,
  Inbox,
  Kanban,
  Sparkles,
} from "lucide-react";
import { useMyAssignedTasks } from "@/hooks/useTasks";
import { useDueDateAlerts } from "@/hooks/useNotifications";
import { useCalendarEvents, useUnreadEmailCount } from "@/hooks/useMicrosoft";
import { usePipelineLeads } from "@/hooks/usePipeline";
import { useCurrentProfile, getFirstName } from "@/hooks/useCurrentProfile";
import { useAuth } from "@/contexts/AuthContext";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import {
  isPastDueCalendarMX,
  toDateStringMX,
  mexicoDayRangeISO,
  nowMX,
} from "@/lib/dateUtils";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";
import { cn } from "@/lib/utils";

interface Props {
  onSendPrompt: (prompt: string) => void;
}

type StatTone = "destructive" | "warning" | "primary" | "muted";

interface StatChip {
  key: string;
  label: string;
  value: number;
  tone: StatTone;
  Icon: typeof CheckSquare;
  to?: string;
}

interface QuickPrompt {
  key: string;
  label: string;
  hint?: string;
  prompt: string;
}

const TONE_CLASS: Record<StatTone, string> = {
  destructive: "border-destructive/30 bg-destructive/5 text-destructive",
  warning: "border-amber-500/30 bg-amber-500/5 text-amber-600",
  primary: "border-primary/30 bg-primary/5 text-primary",
  muted: "border-border/60 bg-background/60 text-muted-foreground",
};

/**
 * Empty-state del asistente flotante (Tanda 5b): saludo personalizado,
 * mini-panorama cross-módulo con stats reales y quick prompts en lenguaje
 * natural que disparan al chat con tools.
 */
export function AiAssistantWelcome({ onSendPrompt }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: profile } = useCurrentProfile();
  const today = useMexicoToday();
  const todayYmd = useMemo(() => toDateStringMX(today), [today]);
  const greetingPrefix = useMemo(() => {
    const hour = nowMX().getHours();
    if (hour < 12) return "Buenos días";
    if (hour < 19) return "Buenas tardes";
    return "Buenas noches";
  }, [today]);

  const dayRange = useMemo(() => mexicoDayRangeISO(todayYmd), [todayYmd]);

  const { data: myAssigned = [] } = useMyAssignedTasks();
  const { data: dueAlerts } = useDueDateAlerts();
  const { data: unreadMail } = useUnreadEmailCount();
  const { data: calEvents = [] } = useCalendarEvents(dayRange.start, dayRange.endExclusive);
  const { data: leads = [] } = usePipelineLeads(true);

  const myOverdue = useMemo(
    () =>
      myAssigned.filter(
        (t) => !isTaskClosedStatus(t.status) && t.due_date && isPastDueCalendarMX(t.due_date),
      ).length,
    [myAssigned],
  );

  const myDueToday = useMemo(
    () =>
      myAssigned.filter(
        (t) =>
          !isTaskClosedStatus(t.status) &&
          t.due_date &&
          t.due_date.split("T")[0] === todayYmd &&
          !isPastDueCalendarMX(t.due_date),
      ).length,
    [myAssigned, todayYmd],
  );

  const eventsToday = calEvents.length;
  const unreadCount = typeof unreadMail === "number" ? unreadMail : 0;

  const myLeads = useMemo(() => {
    if (!user) return leads;
    return leads.filter((l: any) => l.owner_id === user.id);
  }, [leads, user]);

  const staleLeads = useMemo(() => {
    const sevenAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return myLeads.filter((l: any) => {
      const ts = l.last_contact_at || l.updated_at || l.created_at;
      if (!ts) return true;
      return new Date(ts).getTime() < sevenAgo;
    }).length;
  }, [myLeads]);

  const teamOverdueAlerts = useMemo(
    () => (dueAlerts?.overdue ?? []).filter((a) => a.assigned_to_me).length,
    [dueAlerts],
  );

  const stats: StatChip[] = useMemo(() => {
    const overdueValue = Math.max(myOverdue, teamOverdueAlerts);
    return [
      {
        key: "overdue",
        label: "Vencidas",
        value: overdueValue,
        tone: overdueValue > 0 ? "destructive" : "muted",
        Icon: AlertTriangle,
        to: "/tareas?status=vencidas",
      },
      {
        key: "today",
        label: "Vencen hoy",
        value: myDueToday,
        tone: myDueToday > 0 ? "warning" : "muted",
        Icon: CheckSquare,
        to: "/tareas",
      },
      {
        key: "events",
        label: "Eventos hoy",
        value: eventsToday,
        tone: eventsToday > 0 ? "primary" : "muted",
        Icon: Calendar,
        to: "/microsoft365/calendario",
      },
      {
        key: "mail",
        label: "Sin leer",
        value: unreadCount,
        tone: unreadCount > 0 ? "primary" : "muted",
        Icon: Inbox,
        to: "/microsoft365/correo",
      },
      {
        key: "leads",
        label: "Mis leads",
        value: myLeads.length,
        tone: staleLeads > 0 ? "warning" : "muted",
        Icon: Kanban,
        to: "/pipeline",
      },
    ];
  }, [myOverdue, teamOverdueAlerts, myDueToday, eventsToday, unreadCount, myLeads.length, staleLeads]);

  const firstName = getFirstName(profile, user?.email);

  const quickPrompts: QuickPrompt[] = useMemo(() => {
    const list: QuickPrompt[] = [
      {
        key: "today",
        label: "¿Qué tengo hoy?",
        hint: "Resumen del día",
        prompt:
          "Dame un resumen ejecutivo de mi día hoy en Kawiil Central: tareas vencidas y vencen hoy asignadas a mí, eventos del calendario de Outlook de hoy, correos sin leer importantes y leads que necesitan seguimiento. Usa bullets, tono breve, español mexicano y al final sugiere por dónde empezar.",
      },
      {
        key: "week",
        label: "¿Qué urge esta semana?",
        hint: "Prioridades",
        prompt:
          "Identifica las 5-7 cosas más urgentes que tengo esta semana cruzando tareas vencidas, vencimientos de proyecto, leads sin actividad reciente y reuniones clave en mi calendario. Ordénalas por urgencia y explica brevemente por qué cada una.",
      },
      {
        key: "leads",
        label: staleLeads > 0 ? `${staleLeads} leads sin movimiento` : "Leads que necesitan seguimiento",
        hint: "Pipeline",
        prompt:
          "Revisa mis leads activos del pipeline (owner = yo) y dame los que no han tenido actividad en los últimos 7 días. Para cada uno, sugiere un próximo paso concreto (ej. correo de seguimiento, llamada, propuesta).",
      },
      {
        key: "inbox",
        label: unreadCount > 0 ? `${unreadCount} correos sin leer` : "Triage de mi inbox",
        hint: "Outlook",
        prompt:
          "Triagea mi inbox de Outlook: agrupa los correos sin leer en 'necesita respuesta hoy', 'puede esperar', 'solo conocimiento'. Para los de respuesta urgente, sugiere un borrador corto.",
      },
      {
        key: "next",
        label: eventsToday > 0 ? "Mis reuniones de hoy" : "Próximas reuniones",
        hint: "Calendario",
        prompt:
          "Lista mis próximas reuniones de hoy y mañana en Outlook con asistentes clave, y para cada una indica si tengo tareas vinculadas o pendientes que debería revisar antes.",
      },
    ];
    return list;
  }, [staleLeads, unreadCount, eventsToday]);

  return (
    <div className="flex h-full flex-col gap-3 px-3 py-3 overflow-y-auto">
      <div className="flex items-start gap-2.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight">
            {greetingPrefix}{firstName ? `, ${firstName}` : ""}.
          </p>
          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
            Soy Kawiil AI. Pregúntame en lenguaje natural o usa los atajos de abajo.
          </p>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80 mb-1.5">
          Tu panorama ahora
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {stats.map(({ key, label, value, tone, Icon, to }) => (
            <button
              key={key}
              type="button"
              onClick={() => to && navigate(to)}
              className={cn(
                "group flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors hover:opacity-90",
                TONE_CLASS[tone],
              )}
              title={to ? `Abrir ${label}` : label}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium leading-tight text-foreground/70 truncate">
                  {label}
                </p>
                <p className="text-sm font-bold leading-tight tabular-nums">{value}</p>
              </div>
              {to && (
                <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80 mb-1.5">
          Atajos en lenguaje natural
        </p>
        <div className="space-y-1.5">
          {quickPrompts.map((qp) => (
            <button
              key={qp.key}
              type="button"
              onClick={() => onSendPrompt(qp.prompt)}
              className="group flex w-full items-start gap-2 rounded-xl border border-border/50 bg-background/70 px-2.5 py-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
            >
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70 group-hover:text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-foreground leading-tight">{qp.label}</p>
                {qp.hint && (
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    {qp.hint}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground/70 text-center mt-1">
        También puedes escribir tu pregunta abajo o adjuntar archivos.
      </p>
    </div>
  );
}
