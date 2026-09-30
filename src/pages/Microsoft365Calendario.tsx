import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CalendarView } from "@/components/microsoft/CalendarView";
import { MicrosoftConnectCard } from "@/components/microsoft/MicrosoftConnectCard";
import { useMicrosoftConnection, useCalendarEvents } from "@/hooks/useMicrosoft";
import { useTasksForCalendar } from "@/hooks/useTasks";
import { toast } from "sonner";
import {
  addDaysToYmd,
  formatMX,
  mexicoDayRangeISO,
  mexicoWeekRangeISOContaining,
  mondayYmdContaining,
  nowMX,
  toDateStringMX,
} from "@/lib/dateUtils";

const Microsoft365Calendario = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    isConnected,
    isLoading,
    connect,
    isConnecting,
    connectionError,
    refetchConnection,
  } = useMicrosoftConnection();

  useEffect(() => {
    const ms = searchParams.get("ms");
    if (!ms) return;
    if (ms === "connected") {
      toast.success("Microsoft 365 conectado exitosamente");
      void refetchConnection();
    } else if (ms === "error") {
      const detail = searchParams.get("ms_err");
      toast.error(
        detail
          ? `No se pudo conectar Microsoft: ${detail}`
          : "No se pudo completar la vinculación con Microsoft. Intenta de nuevo.",
        { duration: 10000 },
      );
    }
    const next = new URLSearchParams(searchParams);
    next.delete("ms");
    next.delete("ms_err");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, refetchConnection]);

  const todayYmd = useMemo(() => toDateStringMX(nowMX()), []);
  const dayRange = useMemo(() => mexicoDayRangeISO(todayYmd), [todayYmd]);
  const weekRange = useMemo(() => mexicoWeekRangeISOContaining(todayYmd), [todayYmd]);
  const monYmd = useMemo(() => mondayYmdContaining(todayYmd), [todayYmd]);
  const sunYmd = useMemo(() => addDaysToYmd(monYmd, 6), [monYmd]);

  const { data: todayEventsData } = useCalendarEvents(dayRange.start, dayRange.endExclusive);
  const { data: weekEventsData } = useCalendarEvents(weekRange.start, weekRange.endExclusive);
  const { data: weekTasks } = useTasksForCalendar(monYmd, sunYmd);

  const todayEvents = Array.isArray(todayEventsData) ? todayEventsData : [];
  const weekEvents = Array.isArray(weekEventsData) ? weekEventsData : [];

  const aiEvents = useMemo(() => {
    return weekEvents
      .map((e: any) => {
        const start: string | undefined = e?.start?.dateTime;
        const end: string | undefined = e?.end?.dateTime;
        if (!start) return null;
        const attendees: any[] = Array.isArray(e?.attendees) ? e.attendees : [];
        const subject: string = e?.subject || "(sin título)";
        const location: string | null = e?.location?.displayName || null;
        const isOnline: boolean = Boolean(e?.isOnlineMeeting);
        const importance: "low" | "normal" | "high" = (e?.importance as "low" | "normal" | "high") || "normal";
        const categories: string[] = Array.isArray(e?.categories) ? e.categories : [];
        return {
          subject,
          start,
          end: end ?? null,
          location,
          attendeesCount: attendees.length,
          isOnline,
          importance,
          categories,
        };
      })
      .filter(Boolean) as Array<{
      subject: string;
      start: string;
      end: string | null;
      location: string | null;
      attendeesCount: number;
      isOnline: boolean;
      importance: "low" | "normal" | "high";
      categories: string[];
    }>;
  }, [weekEvents]);

  const aiTasksDue = useMemo(() => {
    if (!Array.isArray(weekTasks)) return [];
    return weekTasks
      .map((t: any) => {
        const due: string | undefined = t?.due_date || t?.due_at || t?.dueDate;
        if (!due) return null;
        return {
          title: (t?.title || "(sin título)") as string,
          due,
          status: (t?.status || undefined) as string | undefined,
          priority: (t?.priority ?? null) as string | null,
        };
      })
      .filter(Boolean) as Array<{ title: string; due: string; status?: string; priority: string | null }>;
  }, [weekTasks]);

  const aiPeriodLabel = useMemo(() => {
    const start = formatMX(new Date(monYmd + "T00:00:00"), "EEE d MMM");
    const end = formatMX(new Date(sunYmd + "T00:00:00"), "EEE d MMM");
    return `Semana ${start} – ${end}`;
  }, [monYmd, sunYmd]);

  if (isLoading) {
    return (
      <AppLayout contentMaxWidth="full">
        <div className="flex flex-col h-full items-center justify-center gap-4">
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-scale-in">
          <MicrosoftConnectCard
            onConnect={connect}
            isConnecting={isConnecting}
            connectionError={connectionError?.message}
            onRetryConnection={() => void refetchConnection()}
          />
        </div>
      </div>
    );
  }

  return (
    <AppLayout contentMaxWidth="full">
      <ErrorBoundary>
        <CalendarView
          aiEvents={aiEvents}
          aiTasksDue={aiTasksDue}
          aiPeriodLabel={aiPeriodLabel}
        />
      </ErrorBoundary>
    </AppLayout>
  );
};

export default Microsoft365Calendario;
