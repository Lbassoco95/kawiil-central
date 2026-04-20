import { useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader, type PageHeaderStat } from "@/components/shared/PageHeader";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CalendarView } from "@/components/microsoft/CalendarView";
import { MicrosoftConnectCard } from "@/components/microsoft/MicrosoftConnectCard";
import { useMicrosoftConnection, useCalendarEvents } from "@/hooks/useMicrosoft";
import { useTasksForCalendar } from "@/hooks/useTasks";
import { useDueDateAlerts } from "@/hooks/useNotifications";
import {
  addDaysToYmd,
  formatMX,
  mexicoDayRangeISO,
  mexicoWeekRangeISOContaining,
  mondayYmdContaining,
  nowMX,
  toDateStringMX,
} from "@/lib/dateUtils";
import { Calendar } from "lucide-react";

const Microsoft365Calendario = () => {
  const { isConnected, isLoading, connect, isConnecting, profile } = useMicrosoftConnection();

  const todayYmd = useMemo(() => toDateStringMX(nowMX()), []);
  const dayRange = useMemo(() => mexicoDayRangeISO(todayYmd), [todayYmd]);
  const weekRange = useMemo(() => mexicoWeekRangeISOContaining(todayYmd), [todayYmd]);
  const monYmd = useMemo(() => mondayYmdContaining(todayYmd), [todayYmd]);
  const sunYmd = useMemo(() => addDaysToYmd(monYmd, 6), [monYmd]);

  const { data: todayEventsData } = useCalendarEvents(dayRange.start, dayRange.endExclusive);
  const { data: weekEventsData } = useCalendarEvents(weekRange.start, weekRange.endExclusive);
  const { data: weekTasks } = useTasksForCalendar(monYmd, sunYmd);
  const { data: alerts } = useDueDateAlerts();

  const todayEvents = Array.isArray(todayEventsData) ? todayEventsData : [];
  const weekEvents = Array.isArray(weekEventsData) ? weekEventsData : [];

  const tasksWithDueInWeek = useMemo(
    () => (Array.isArray(weekTasks) ? weekTasks.length : 0),
    [weekTasks],
  );

  const dueIn48h = useMemo(() => {
    const overdue = (alerts?.overdue?.length ?? 0) + (alerts?.stepsOverdue?.length ?? 0);
    const dueSoon = (alerts?.dueSoon ?? []).filter((t) => {
      if (!t.due_date) return false;
      const due = new Date(t.due_date).getTime();
      const now = Date.now();
      return due - now <= 48 * 60 * 60 * 1000;
    }).length;
    const stepsSoon = (alerts?.stepsDueSoon ?? []).filter((s) => {
      if (!s.due_date) return false;
      const due = new Date(s.due_date).getTime();
      const now = Date.now();
      return due - now <= 48 * 60 * 60 * 1000;
    }).length;
    return overdue + dueSoon + stepsSoon;
  }, [alerts]);

  const nextEvent = useMemo(() => {
    const all = [...todayEvents, ...weekEvents];
    const now = Date.now();
    const upcoming = all
      .map((e: any) => {
        const startStr: string | undefined = e?.start?.dateTime;
        if (!startStr) return null;
        const t = new Date(startStr).getTime();
        return t >= now ? { event: e, start: t } : null;
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.start - b.start);
    if (upcoming.length === 0) return null;
    const first = upcoming[0] as { event: any; start: number };
    const subject: string = first.event?.subject || "Sin título";
    const startMs = first.start;
    const isToday = startMs >= dayRange.start ? new Date(startMs).getTime() < new Date(dayRange.endExclusive).getTime() : false;
    const label = isToday
      ? `Hoy ${formatMX(new Date(startMs), "HH:mm")}`
      : formatMX(new Date(startMs), "EEE d MMM HH:mm");
    return { subject, label };
  }, [todayEvents, weekEvents, dayRange.start, dayRange.endExclusive]);

  const heroStats = useMemo<PageHeaderStat[]>(() => {
    return [
      {
        label: "Hoy",
        value: todayEvents.length,
        sub: todayEvents.length === 0 ? "día libre" : todayEvents.length === 1 ? "evento" : "eventos",
        tone: todayEvents.length > 0 ? "primary" : "default",
      },
      {
        label: "Esta semana",
        value: weekEvents.length,
        sub: "eventos",
        tone: "default",
      },
      {
        label: "Tareas vinculadas",
        value: tasksWithDueInWeek,
        sub: "Kawiil → Outlook",
        tone: "primary",
      },
      {
        label: "Vencen ≤ 48h",
        value: dueIn48h,
        sub: dueIn48h > 0 ? "tareas urgentes" : "sin urgencias",
        tone: dueIn48h > 0 ? "warning" : "default",
      },
      {
        label: "Próximo evento",
        value: nextEvent ? nextEvent.label : "—",
        sub: nextEvent?.subject ?? "agenda libre",
        tone: nextEvent ? "default" : "default",
      },
    ];
  }, [todayEvents, weekEvents, tasksWithDueInWeek, dueIn48h, nextEvent]);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-4 py-8">
          <div className="h-8 w-48 bg-secondary/30 rounded-lg animate-pulse" />
          <div className="h-4 w-64 bg-secondary/20 rounded animate-pulse" />
          <div className="grid grid-cols-7 gap-2 mt-6">
            {[...Array(35)].map((_, i) => (
              <div key={i} className="h-20 bg-secondary/20 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!isConnected) {
    return (
      <AppLayout>
        <div className="animate-scale-in">
          <MicrosoftConnectCard onConnect={connect} isConnecting={isConnecting} />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <ErrorBoundary>
        <div className="space-y-4 animate-fade-in">
          <PageHeader
            variant="hero"
            breadcrumb={["Kawiil OS", "Integraciones", "Calendario"]}
            icon={<Calendar />}
            title="Calendario"
            description={`Outlook · ${profile?.displayName || profile?.mail || "Conectado"} — sincronizado con Microsoft 365, superpuesto con tareas y vencimientos de Kawiil.`}
            stats={heroStats}
          />
          <CalendarView />
        </div>
      </ErrorBoundary>
    </AppLayout>
  );
};

export default Microsoft365Calendario;
