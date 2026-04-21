import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useReminders } from "@/hooks/useReminders";
import { PersonalRemindersPanel } from "@/components/reminders/PersonalRemindersPanel";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PerformanceChart } from "@/components/dashboard/PerformanceChart";
import { MonthlyPerformance } from "@/components/dashboard/MonthlyPerformance";
import { PersonalRendimientoMetrics } from "@/components/dashboard/PersonalRendimientoMetrics";
import { PersonalProjectsProgress } from "@/components/dashboard/PersonalProjectsProgress";
import { AiHeroGrid } from "@/components/dashboard/AiHeroGrid";
import { DailyBriefingGrid } from "@/components/dashboard/DailyBriefingGrid";
import { AISummaryCard } from "@/components/shared/AISummaryCard";
import { useMyActiveProjectsProgress } from "@/hooks/useMyActiveProjectsProgress";
import { SERVICE_LABELS } from "@/lib/serviceLabels";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  Sparkles,
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Sun,
  BarChart3,
  X,
  MessageSquare,
} from "lucide-react";
import {
  formatDateMX,
  toDateStringMX,
  mexicoDayRangeISO,
  mexicoWeekRangeISOContaining,
  mondayYmdContaining,
  addDaysToYmd,
} from "@/lib/dateUtils";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PreferenceQuestionnaire } from "@/components/dashboard/PreferenceQuestionnaire";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const SECTION_LABELS: Record<string, string> = {
  inicio: "Inicio",
  tareas: "Tareas",
  proyectos: "Proyectos",
  clientes: "Clientes",
  documentos: "Documentos",
  asistente: "Asistente IA",
  asistenteia: "Asistente IA",
  microsoft365: "Microsoft 365",
  notificaciones: "Notificaciones",
  correo: "Correo",
  calendario: "Calendario",
  hub: "Hub",
  task: "Detalle de tarea",
  pipeline: "Pipeline",
  conocimiento: "Conocimiento",
  admin: "Administración",
};

function formatSectionLabel(raw: string): string {
  const k = raw.toLowerCase();
  return SECTION_LABELS[k] || raw;
}

const DASHBOARD_TABS = ["resumen", "tareas", "clientes", "recordatorios", "mi-semana", "rendimiento"] as const;
type DashboardTab = (typeof DASHBOARD_TABS)[number];

function isDashboardTab(v: string | null): v is DashboardTab {
  return !!v && (DASHBOARD_TABS as readonly string[]).includes(v);
}

export function PersonalDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const today = useMexicoToday();
  const { data: orgUsers } = useOrgUsers();
  const userCelula = useMemo(() => {
    if (!orgUsers || !user) return null;
    const profile = orgUsers.find((u) => u.user_id === user.id);
    return profile?.area ?? null;
  }, [orgUsers, user]);

  const tabFromUrl = searchParams.get("tab");
  const dashboardActiveTab: DashboardTab = isDashboardTab(tabFromUrl) ? tabFromUrl : "resumen";

  useEffect(() => {
    if (tabFromUrl && !isDashboardTab(tabFromUrl)) {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.delete("tab");
          return p;
        },
        { replace: true },
      );
    }
  }, [tabFromUrl, setSearchParams]);

  const onDashboardTabChange = (value: string) => {
    if (!isDashboardTab(value)) return;
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value === "resumen") p.delete("tab");
        else p.set("tab", value);
        return p;
      },
      { replace: true },
    );
  };

  const [showQuestionnaire, setShowQuestionnaire] = useState(false);

  // Check if user has completed questionnaire
  const { data: userPrefs, refetch: refetchPrefs } = useQuery({
    queryKey: ["user-preferences", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("completed_at, answers")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const hasCompletedQuestionnaire = !!userPrefs?.completed_at;
  const showQuestionnaireReminder = !hasCompletedQuestionnaire;

  const { data: proactiveTip } = useQuery({
    queryKey: ["dashboard-ai-proactive-tip", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body")
        .eq("user_id", user!.id)
        .eq("type", "ai_proactive_tip")
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const dismissProactive = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard-ai-proactive-tip", user?.id] });
    },
  });

  const todayYmd = toDateStringMX(today);
  const weekBounds = useMemo(() => mexicoWeekRangeISOContaining(todayYmd), [todayYmd]);
  const weekMondayYmd = useMemo(() => mondayYmdContaining(todayYmd), [todayYmd]);
  const weekSundayYmd = useMemo(() => addDaysToYmd(weekMondayYmd, 6), [weekMondayYmd]);

  // Todas las tareas pendientes asignadas (sin límite) para KPIs y conteos reales
  const { data: pendingTasksSnapshot = [] } = useQuery({
    queryKey: ["personal-pending-snapshot", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, status, priority, due_date, area, project_id")
        .eq("assigned_to", user!.id)
        .in("status", ["pendiente", "en_progreso", "en_revision"])
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const myTasks = pendingTasksSnapshot.slice(0, 15);

  // Completadas hoy (zona CDMX): completed_at preferente; si falta, updated_at en el mismo rango
  const { data: completedToday } = useQuery({
    queryKey: ["personal-completed-today", user?.id, todayYmd],
    queryFn: async () => {
      const { start, endExclusive } = mexicoDayRangeISO(todayYmd);

      const { count: withCompletedAt, error: e1 } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to", user!.id)
        .eq("status", "completada")
        .not("completed_at", "is", null)
        .gte("completed_at", start)
        .lt("completed_at", endExclusive);
      if (e1) throw e1;

      const { count: fallbackUpdated, error: e2 } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to", user!.id)
        .eq("status", "completada")
        .is("completed_at", null)
        .gte("updated_at", start)
        .lt("updated_at", endExclusive);
      if (e2) throw e2;

      return (withCompletedAt ?? 0) + (fallbackUpdated ?? 0);
    },
    enabled: !!user,
  });

  const { data: weekActivity } = useQuery({
    queryKey: ["personal-week-activity", user?.id, weekBounds.start],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("entity_type")
        .eq("user_id", user!.id)
        .gte("created_at", weekBounds.start)
        .lt("created_at", weekBounds.endExclusive);
      if (error) throw error;
      const bySection = new Map<string, number>();
      for (const row of data ?? []) {
        const k = row.entity_type || "otro";
        bySection.set(k, (bySection.get(k) ?? 0) + 1);
      }
      const bySectionSorted = [...bySection.entries()].sort((a, b) => b[1] - a[1]);
      return { total: data?.length ?? 0, bySectionSorted };
    },
    enabled: !!user,
  });

  const { data: weekCompletedCount = 0 } = useQuery({
    queryKey: ["personal-week-completed", user?.id, weekBounds.start],
    queryFn: async () => {
      const { start, endExclusive } = weekBounds;
      const { count: withCompletedAt, error: e1 } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to", user!.id)
        .eq("status", "completada")
        .not("completed_at", "is", null)
        .gte("completed_at", start)
        .lt("completed_at", endExclusive);
      if (e1) throw e1;
      const { count: fallbackUpdated, error: e2 } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to", user!.id)
        .eq("status", "completada")
        .is("completed_at", null)
        .gte("updated_at", start)
        .lt("updated_at", endExclusive);
      if (e2) throw e2;
      return (withCompletedAt ?? 0) + (fallbackUpdated ?? 0);
    },
    enabled: !!user,
  });

  const { data: weekMoods = [] } = useQuery({
    queryKey: ["personal-week-moods", user?.id, weekMondayYmd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mood_checkins")
        .select("check_date, mood, time_of_day")
        .eq("user_id", user!.id)
        .gte("check_date", weekMondayYmd)
        .lte("check_date", weekSundayYmd)
        .order("check_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const weekMoodAverage = useMemo(() => {
    if (!weekMoods.length) return null;
    const sum = weekMoods.reduce((acc, r) => acc + (r.mood ?? 0), 0);
    return Math.round((sum / weekMoods.length) * 10) / 10;
  }, [weekMoods]);

  const { data: myProjectProgress } = useMyActiveProjectsProgress();

  // My clients
  const { data: myClients } = useQuery({
    queryKey: ["personal-clients", user?.id],
    queryFn: async () => {
      const { data: directClients, error: e1 } = await supabase
        .from("clients")
        .select("id, name, status, services, primary_area")
        .eq("responsible_user_id", user!.id)
        .in("status", ["activo", "prospecto"])
        .order("name");
      if (e1) throw e1;

      const { data: myProjects, error: e2 } = await supabase
        .from("projects")
        .select("client_id")
        .eq("responsible_user_id", user!.id)
        .neq("status", "cancelado")
        .not("client_id", "is", null);
      if (e2) throw e2;

      const projectClientIds = [...new Set((myProjects || []).map((p) => p.client_id).filter(Boolean))] as string[];
      const directIds = new Set((directClients || []).map((c) => c.id));
      const missingIds = projectClientIds.filter((id) => !directIds.has(id));

      let projectClients: any[] = [];
      if (missingIds.length > 0) {
        const { data, error: e3 } = await supabase
          .from("clients")
          .select("id, name, status, services, primary_area")
          .in("id", missingIds)
          .in("status", ["activo", "prospecto"])
          .order("name");
        if (e3) throw e3;
        projectClients = data || [];
      }

      return [...(directClients || []), ...projectClients].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    },
    enabled: !!user,
  });

  const { reminders } = useReminders();
  const pendingReminders = reminders.filter((r) => !r.is_completed);

  const overdueTasks =
    pendingTasksSnapshot.filter((t) => t.due_date && new Date(t.due_date) < today).length ?? 0;

  const totalPending = pendingTasksSnapshot.length;

  const dueTodayPending =
    pendingTasksSnapshot.filter((t) => {
      if (!t.due_date) return false;
      const d = t.due_date.slice(0, 10);
      return d === todayYmd;
    }).length ?? 0;

  const priorityDot = (p: string) => {
    switch (p) {
      case "urgente": return "bg-destructive";
      case "alta": return "bg-warning";
      case "media": return "bg-primary";
      default: return "bg-muted-foreground/30";
    }
  };

  const dueThisWeek =
    pendingTasksSnapshot.filter((t) => {
      if (!t.due_date) return false;
      const d = new Date(t.due_date);
      const weekEnd = new Date(today);
      weekEnd.setDate(weekEnd.getDate() + 7);
      return d >= today && d <= weekEnd;
    }).length ?? 0;

  const urgentCount =
    pendingTasksSnapshot.filter((t) => t.priority === "urgente" || t.priority === "alta").length ?? 0;

  const nextAction = pendingTasksSnapshot[0] ?? null;

  const dailyTotal = dueTodayPending + (completedToday ?? 0);
  const dailyProgress =
    dailyTotal > 0 ? Math.round(((completedToday ?? 0) / dailyTotal) * 100) : 0;

  const weekCoachPrompt = useMemo(() => {
    const lines = (myProjectProgress ?? [])
      .map(
        (r) =>
          `- ${r.name}${r.clientName ? ` (${r.clientName})` : ""}: ${r.primaryLabel} ${
            r.primaryTotal > 0 ? `${r.primaryPct}% (${r.primaryDone}/${r.primaryTotal})` : "sin medición de pasos"
          }${r.taskTotal > 0 && r.primaryKind !== "tareas" ? `; tareas en tablero ${r.taskPct}% (${r.taskDone}/${r.taskTotal})` : ""}`,
      )
      .join("\n");
    return `Eres coach de productividad de Kawiil (despacho en México, tono cercano y profesional, español).

Contexto de la semana ${weekBounds.weekLabel} (horario CDMX):
- Registros de navegación en la app: ${weekActivity?.total ?? 0}
- Tareas del tablero completadas en la semana: ${weekCompletedCount}
- Promedio de ánimo (1-5) en check-ins: ${weekMoodAverage ?? "sin datos"}
- Tareas pendientes asignadas ahora: ${totalPending} (vencidas: ${overdueTasks})

Proyectos activos donde eres responsable y su avance principal:
${lines || "(ninguno)"}

Instrucciones: escribe UN solo mensaje breve (máximo 130 palabras) reconociendo logros concretos si los hay, mencionando 1 o 2 focos útiles para los próximos días y un cierre motivador sin clichés vacíos. Usa Markdown (**negritas** opcional; una viñeta corta si encaja). Sin saludo de «estimado» ni firma.`;
  }, [
    weekBounds.weekLabel,
    weekActivity?.total,
    weekCompletedCount,
    weekMoodAverage,
    totalPending,
    overdueTasks,
    myProjectProgress,
  ]);

  /** Evita reutilizar en localStorage un resumen del mismo día si cambió el contexto. */
  const promptFingerprint = (text: string) => {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
    return String(h);
  };

  const rendimientoCoachPrompt = useMemo(() => {
    const lines = (myProjectProgress ?? [])
      .map(
        (r) =>
          `- ${r.name}: ${r.primaryLabel} ${
            r.primaryTotal > 0 ? `${r.primaryPct}% (${r.primaryDone}/${r.primaryTotal})` : ""
          }${r.taskTotal > 0 ? `; tareas tablero ${r.taskDone}/${r.taskTotal}` : ""}`,
      )
      .join("\n");
    return `Eres coach de productividad de Kawiil (México, tono cercano y profesional, español).

Panorama actual del usuario:
- Tareas pendientes en tablero: ${totalPending}; con fecha vencida: ${overdueTasks}
- Completadas hoy: ${completedToday ?? 0}; pendientes con vencimiento hoy: ${dueTodayPending}
- Proyectos activos como responsable:
${lines || "(ninguno)"}

Instrucciones: UN mensaje breve (máximo 130 palabras) que sintetice cómo va su rendimiento, celebre avances reales en proyectos o tareas si existen, y deje 1 recomendación prioritaria si hay atrasos; tono motivador sin demagogia. Markdown permitido (**negritas**). Sin saludo formal ni firma.`;
  }, [myProjectProgress, totalPending, overdueTasks, completedToday, dueTodayPending]);

  return (
    <div className="space-y-6 min-w-0">
      {/* AI Hero · briefing + quote + mood — siempre arriba, full-width */}
      <div className="animate-fade-in">
        <AiHeroGrid
          module="tareas"
          tasksCount={totalPending}
          completedToday={completedToday ?? 0}
          overdueCount={overdueTasks}
          remindersCount={pendingReminders.length}
          userCelula={userCelula}
        />
      </div>

      {proactiveTip?.id && (
        <Alert className="border-primary/25 bg-primary/[0.04] pr-10 relative">
          <Sparkles className="h-4 w-4 text-primary" />
          <AlertTitle className="text-sm">{proactiveTip.title || "Sugerencia del día"}</AlertTitle>
          <AlertDescription className="text-xs mt-1">
            {proactiveTip.body}
            <button
              type="button"
              className="block mt-2 text-primary font-medium hover:underline"
              onClick={() => navigate("/notificaciones?tab=sistema")}
            >
              Ver notificaciones
            </button>
          </AlertDescription>
          <button
            type="button"
            className="absolute right-3 top-3 p-1 rounded-md text-muted-foreground hover:bg-secondary disabled:opacity-50"
            aria-label="Cerrar"
            disabled={dismissProactive.isPending}
            onClick={() => dismissProactive.mutate(proactiveTip.id)}
          >
            <X className="h-4 w-4" />
          </button>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1fr_minmax(280px,340px)] gap-6 min-w-0">
        {/* ═══ LEFT COLUMN ═══ */}
        <div className="space-y-4 min-w-0">

        {/* KPI grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 animate-fade-in stagger-2" style={{ animationFillMode: "both" }}>
          <button
            onClick={() => navigate("/tareas?priority=urgente")}
            className={`stat-card text-left group relative overflow-hidden ${urgentCount > 0 ? "border-destructive/30" : ""}`}
          >
            <div className={`absolute inset-0 opacity-[0.06] bg-gradient-to-br ${urgentCount > 0 ? "from-destructive to-destructive/50" : "from-muted to-muted"}`} />
            <div className="relative flex items-start justify-between">
              <div>
                <p className="text-3xl font-bold text-foreground animate-count-up">{urgentCount}</p>
                <p className="text-xs text-muted-foreground mt-1 font-medium">Urgentes</p>
              </div>
              <div className={`p-2 rounded-xl ${urgentCount > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
                <AlertTriangle className="h-4 w-4" />
              </div>
            </div>
          </button>
          <button
            onClick={() => navigate("/tareas?due=week")}
            className={`stat-card text-left group relative overflow-hidden ${dueThisWeek > 0 ? "border-warning/30" : ""}`}
          >
            <div className={`absolute inset-0 opacity-[0.06] bg-gradient-to-br ${dueThisWeek > 0 ? "from-warning to-warning/50" : "from-muted to-muted"}`} />
            <div className="relative flex items-start justify-between">
              <div>
                <p className="text-3xl font-bold text-foreground animate-count-up">{dueThisWeek}</p>
                <p className="text-xs text-muted-foreground mt-1 font-medium">Esta semana</p>
              </div>
              <div className={`p-2 rounded-xl ${dueThisWeek > 0 ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}`}>
                <CalendarDays className="h-4 w-4" />
              </div>
            </div>
          </button>
          <button
            onClick={() => navigate("/tareas?vista=historial")}
            className={`stat-card text-left group relative overflow-hidden ${(completedToday ?? 0) > 0 ? "border-accent/30" : ""}`}
          >
            <div className={`absolute inset-0 opacity-[0.06] bg-gradient-to-br ${(completedToday ?? 0) > 0 ? "from-accent to-accent/50" : "from-muted to-muted"}`} />
            <div className="relative flex items-start justify-between">
              <div>
                <p className="text-3xl font-bold text-foreground animate-count-up">{completedToday ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1 font-medium">Completadas hoy</p>
              </div>
              <div className={`p-2 rounded-xl ${(completedToday ?? 0) > 0 ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"}`}>
                <CheckCircle2 className="h-4 w-4" />
              </div>
            </div>
          </button>
        </div>

        <button
          type="button"
          onClick={() => navigate("/comunicacion")}
          className="w-full text-left stat-card flex items-center justify-between gap-3 border border-border/50 hover:border-primary/20 transition-colors animate-fade-in stagger-2"
          style={{ animationFillMode: "both" }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Slack</p>
              <p className="text-xs text-muted-foreground truncate">Canales y mensajes directos del workspace</p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>

        {/* Next action */}
        {nextAction && (
          <div className="animate-fade-in stagger-3" style={{ animationFillMode: "both" }}>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Siguiente acción</h3>
            <button
              type="button"
              onClick={() => navigate(nextAction.project_id ? `/proyectos/${nextAction.project_id}?tab=tareas&taskId=${nextAction.id}` : `/tareas?taskId=${nextAction.id}`)}
              className="w-full text-left page-list-card border-2 border-primary/20 p-4 group"
            >
              <div className="flex items-start gap-3">
                <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${priorityDot(nextAction.priority)} animate-glow-pulse`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">{nextAction.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {nextAction.area && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {(SERVICE_LABELS as any)[nextAction.area] || nextAction.area}
                      </Badge>
                    )}
                    {nextAction.due_date && (
                      <span className={`text-xs ${new Date(nextAction.due_date) < today ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {formatDateMX(nextAction.due_date)}
                      </span>
                    )}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
              </div>
            </button>
          </div>
        )}

        {/* Tabs for sections */}
      <Tabs value={dashboardActiveTab} onValueChange={onDashboardTabChange} className="w-full min-w-0 mt-1">
        <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="surface-toolbar px-1 py-1 sm:px-2 sm:py-1.5">
          <TabsList className="w-max sm:w-full justify-start border-0 border-b border-border/60 bg-transparent rounded-none h-auto p-0 gap-0">
            <TabsTrigger
              value="resumen"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 sm:px-4 py-2.5 text-xs sm:text-sm whitespace-nowrap transition-colors"
            >
              Resumen
            </TabsTrigger>
            <TabsTrigger
              value="tareas"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 sm:px-4 py-2.5 text-xs sm:text-sm whitespace-nowrap transition-colors"
            >
              Tareas ({totalPending})
            </TabsTrigger>
            <TabsTrigger
              value="clientes"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 sm:px-4 py-2.5 text-xs sm:text-sm whitespace-nowrap transition-colors"
            >
              Clientes ({myClients?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger
              value="recordatorios"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 sm:px-4 py-2.5 text-xs sm:text-sm whitespace-nowrap transition-colors"
            >
              Recordatorios ({pendingReminders.length})
            </TabsTrigger>
            <TabsTrigger
              value="mi-semana"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 sm:px-4 py-2.5 text-xs sm:text-sm whitespace-nowrap transition-colors"
            >
              Mi semana
            </TabsTrigger>
            <TabsTrigger
              value="rendimiento"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 sm:px-4 py-2.5 text-xs sm:text-sm whitespace-nowrap transition-colors"
            >
              Rendimiento
            </TabsTrigger>
          </TabsList>
          </div>
        </div>

        {/* Resumen */}
        <TabsContent value="resumen" className="mt-4 space-y-5 animate-fade-in">
          <DailyBriefingGrid
            pendingTasks={pendingTasksSnapshot as any}
            todayYmd={todayYmd}
            completedToday={completedToday ?? 0}
            overdueCount={overdueTasks}
            dueTodayCount={dueTodayPending}
          />

          {myTasks && myTasks.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Próximas tareas</h3>
              <div className="space-y-1">
                {myTasks.slice(0, 5).map((t, i) => (
                  <button
                    key={t.id}
                    className="flex items-center gap-3 w-full py-2 text-left row-hover px-2 rounded-lg"
                    style={{ animationDelay: `${i * 50}ms`, animationFillMode: "both" }}
                    onClick={() => navigate(t.project_id ? `/proyectos/${t.project_id}?tab=tareas&taskId=${t.id}` : `/tareas?taskId=${t.id}`)}
                  >
                    <span className={`h-2 w-2 rounded-full shrink-0 ${priorityDot(t.priority)}`} />
                    <span className="text-sm text-foreground truncate flex-1">{t.title}</span>
                    {t.due_date && (
                      <span className={`text-xs shrink-0 ${new Date(t.due_date) < today ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {formatDateMX(t.due_date)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {myClients && myClients.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Mis clientes</h3>
              <div className="flex flex-wrap gap-2">
                {myClients.slice(0, 8).map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => navigate(`/clientes/${c.id}`)}
                    className="text-sm px-3 py-1.5 rounded-lg bg-secondary/50 hover:bg-secondary hover:shadow-sm text-foreground transition-all duration-200"
                  >
                    {c.name}
                  </button>
                ))}
                {myClients.length > 8 && (
                  <button
                    onClick={() => navigate("/clientes")}
                    className="text-sm px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                  >
                    +{myClients.length - 8} más
                  </button>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Tareas */}
        <TabsContent value="tareas" className="mt-4 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Tareas pendientes
            </h3>
            <button
              onClick={() => navigate("/tareas")}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              Ver todas <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {!myTasks?.length ? (
            <div className="text-center py-8">
              <p className="text-4xl mb-2">🎉</p>
              <p className="text-sm text-muted-foreground">Sin tareas pendientes</p>
            </div>
          ) : (
            <div className="space-y-1">
              {myTasks.map((t, i) => (
                <button
                  key={t.id}
                  className="flex items-center gap-3 w-full py-2.5 text-left row-hover px-2 rounded-lg"
                  onClick={() => navigate(t.project_id ? `/proyectos/${t.project_id}?tab=tareas&taskId=${t.id}` : `/tareas?taskId=${t.id}`)}
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${priorityDot(t.priority)}`} />
                  <span className="text-sm text-foreground truncate flex-1">{t.title}</span>
                  {t.area && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                      {(SERVICE_LABELS as any)[t.area] || t.area}
                    </Badge>
                  )}
                  {t.due_date && (
                    <span className={`text-xs shrink-0 ${new Date(t.due_date) < today ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                      {formatDateMX(t.due_date)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Mis Clientes */}
        <TabsContent value="clientes" className="mt-4 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Clientes asignados
            </h3>
            <button
              onClick={() => navigate("/clientes")}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              Ver todos <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {!myClients?.length ? (
            <p className="text-sm text-muted-foreground py-4">Sin clientes asignados</p>
          ) : (
            <div className="space-y-1">
              {myClients.map((c: any) => (
                <button
                  key={c.id}
                  className="flex items-center gap-3 w-full py-3 text-left row-hover px-2 rounded-lg"
                  onClick={() => navigate(`/clientes/${c.id}`)}
                >
                  <span className="text-sm text-foreground truncate flex-1">{c.name}</span>
                  <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                    {(c.services || []).map((s: string) => (
                      <Badge key={s} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {(SERVICE_LABELS as any)[s] || s}
                      </Badge>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Recordatorios */}
        <TabsContent value="recordatorios" className="mt-4 animate-fade-in">
          <PersonalRemindersPanel />
        </TabsContent>

        {/* Mi semana */}
        <TabsContent value="mi-semana" className="mt-4 space-y-4 animate-fade-in">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarRange className="h-4 w-4 shrink-0" />
            <p className="text-xs">{weekBounds.weekLabel} · semana en horario CDMX</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="glass-card p-4">
              <BarChart3 className="h-4 w-4 text-primary mb-2" />
              <p className="text-2xl font-bold text-foreground tabular-nums">{weekActivity?.total ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Registros de navegación</p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/tareas?vista=historial")}
              className="glass-card p-4 text-left row-hover transition-colors"
            >
              <CheckCircle2 className="h-4 w-4 text-accent mb-2" />
              <p className="text-2xl font-bold text-foreground tabular-nums">{weekCompletedCount}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Tareas completadas · ver en Tareas</p>
            </button>
            <div className="glass-card p-4">
              <Sun className="h-4 w-4 text-warning mb-2" />
              <p className="text-2xl font-bold text-foreground tabular-nums">
                {weekMoodAverage != null ? weekMoodAverage : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Promedio ánimo (1–5)</p>
            </div>
          </div>

          <AISummaryCard
            cacheKey={`personal-week-coach-${user?.id ?? ""}-${promptFingerprint(weekCoachPrompt)}`}
            contextPrompt={weekCoachPrompt}
            title="Cómo va tu semana — Kawiil AI"
            ready={!!user && weekActivity !== undefined && myProjectProgress !== undefined}
            requestDelayMs={350}
          />

          <PersonalProjectsProgress rows={myProjectProgress} />

          {weekActivity && weekActivity.bySectionSorted.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Secciones más visitadas
              </h3>
              <ul className="space-y-2">
                {weekActivity.bySectionSorted.slice(0, 10).map(([section, n]) => (
                  <li key={section} className="flex justify-between gap-3 text-sm">
                    <span className="text-foreground truncate">{formatSectionLabel(section)}</span>
                    <span className="text-muted-foreground tabular-nums shrink-0">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {weekMoods.length > 0 ? (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Check-ins de ánimo
              </h3>
              <div className="flex flex-wrap gap-2">
                {weekMoods.map((row) => (
                  <div
                    key={`${row.check_date}-${row.time_of_day}`}
                    className="text-xs px-2.5 py-1.5 rounded-lg bg-secondary/50 text-foreground"
                  >
                    {formatDateMX(row.check_date)} · {row.time_of_day === "morning" ? "mañana" : "tarde"} ·{" "}
                    {row.mood}/5
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sin check-ins de ánimo esta semana. Registra cómo te sientes desde el panel derecho.
            </p>
          )}
        </TabsContent>

        {/* Rendimiento */}
        <TabsContent value="rendimiento" className="mt-4 space-y-6 animate-fade-in">
          <PersonalRendimientoMetrics pendingTasks={pendingTasksSnapshot} />
          <AISummaryCard
            cacheKey={`personal-rendimiento-coach-${user?.id ?? ""}-${promptFingerprint(rendimientoCoachPrompt)}`}
            contextPrompt={rendimientoCoachPrompt}
            title="Tu rendimiento — Kawiil AI"
            ready={!!user && myProjectProgress !== undefined}
            requestDelayMs={450}
          />
          <PersonalProjectsProgress rows={myProjectProgress} title="Avance en proyectos activos" compact />
          <PerformanceChart />
          <MonthlyPerformance />
        </TabsContent>
      </Tabs>

      </div>{/* end left column */}

      {/* ═══ RIGHT COLUMN (sidebar widgets) ═══ */}
      <div className="space-y-5 md:sticky md:top-24 md:self-start">
        {/* Day progress */}
        <div className="glass-card p-5 animate-fade-in stagger-1" style={{ animationFillMode: "both" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-foreground">Progreso del día</span>
            <span className="text-xs font-bold text-primary animate-count-up">{dailyProgress}%</span>
          </div>
          <div className="h-2.5 bg-secondary/60 rounded-full overflow-hidden">
            <div className="h-full gradient-bar rounded-full transition-all duration-700 ease-out" style={{ width: `${dailyProgress}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {completedToday ?? 0} de {dailyTotal} tareas para hoy
            {totalPending > 0 && dailyTotal === 0 ? (
              <span className="block mt-1">({totalPending} pendientes en total)</span>
            ) : null}
          </p>
        </div>

        {/* Questionnaire reminder */}
        {showQuestionnaireReminder && (
          <div className="glass-card p-4 animate-scale-in">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Kawiil quiere conocerte</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">Responde un breve cuestionario para personalizar tu experiencia</p>
                <div className="flex items-center gap-2 mt-2.5">
                  <Button size="sm" variant="default" className="text-xs h-7" onClick={() => setShowQuestionnaire(true)}>Responder</Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Quick upcoming tasks */}
        {myTasks && myTasks.length > 0 && (
          <div className="glass-card p-5 animate-fade-in stagger-3" style={{ animationFillMode: "both" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-foreground">Próximas tareas</span>
              <button onClick={() => navigate("/tareas")} className="text-xs text-primary hover:text-primary/80 transition-colors">Ver todas</button>
            </div>
            <div className="space-y-1">
              {myTasks.slice(0, 4).map((t, i) => (
                <button
                  key={t.id}
                  className="flex items-center gap-2.5 w-full py-2 text-left row-hover px-2 rounded-lg"
                  style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
                  onClick={() => navigate(t.project_id ? `/proyectos/${t.project_id}?tab=tareas&taskId=${t.id}` : `/tareas?taskId=${t.id}`)}
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${priorityDot(t.priority)}`} />
                  <span className="text-[13px] text-foreground truncate flex-1">{t.title}</span>
                  {t.due_date && (
                    <span className={`text-[10px] shrink-0 ${new Date(t.due_date) < today ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                      {formatDateMX(t.due_date)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        </div>{/* end right column */}
      </div>{/* end grid 2 cols */}

      {/* Questionnaire Dialog */}
      <PreferenceQuestionnaire
        open={showQuestionnaire}
        onClose={() => setShowQuestionnaire(false)}
        onCompleted={() => {
          refetchPrefs();
          qc.invalidateQueries({ queryKey: ["ai-hero-phrase"] });
        }}
      />
    </div>
  );
}
