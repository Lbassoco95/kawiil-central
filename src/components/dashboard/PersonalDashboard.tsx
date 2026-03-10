import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useReminders } from "@/hooks/useReminders";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MoodCheckin } from "@/components/dashboard/MoodCheckin";
import { PerformanceChart } from "@/components/dashboard/PerformanceChart";
import { MonthlyPerformance } from "@/components/dashboard/MonthlyPerformance";
import { DailyBriefing } from "@/components/dashboard/DailyBriefing";
import { SERVICE_LABELS } from "@/lib/serviceLabels";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  ArrowRight,
  Sparkles,
  Clock,
} from "lucide-react";
import { formatDateMX, nowMX } from "@/lib/dateUtils";
import { useNavigate } from "react-router-dom";
import { PreferenceQuestionnaire } from "@/components/dashboard/PreferenceQuestionnaire";

export function PersonalDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = useMemo(() => nowMX(), []);
  const { data: orgUsers } = useOrgUsers();
  const userCelula = useMemo(() => {
    if (!orgUsers || !user) return null;
    const profile = orgUsers.find((u) => u.user_id === user.id);
    return profile?.area ?? null;
  }, [orgUsers, user]);
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  const currentTime = today;
  const [personalPhrase, setPersonalPhrase] = useState<string | null>(null);
  const [phraseLoading, setPhraseLoading] = useState(false);

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
  const questionnaireDeadline = new Date("2026-03-24T23:59:59-06:00");
  const showQuestionnaireReminder = !hasCompletedQuestionnaire && today < questionnaireDeadline;
  const daysLeft = Math.max(0, Math.ceil((questionnaireDeadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

  const { data: profile } = useQuery({
    queryKey: ["dashboard-profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", user!.id)
        .single();
      return data;
    },
    enabled: !!user,
  });

  // Fetch personalized phrase (max 2x/day)
  const fetchPhrase = async (moodScore?: number, forceRegenerate?: boolean) => {
    if (!user) return;
    setPhraseLoading(true);
    try {
      const hour = currentTime.getHours();
      const timeOfDay = hour < 14 ? "morning" : "afternoon";

      const { data, error } = await supabase.functions.invoke("generate-phrase", {
        body: { mood_score: moodScore ?? null, time_of_day: timeOfDay, force_regenerate: forceRegenerate ?? false },
      });
      if (error) throw error;
      if (data?.phrase) {
        setPersonalPhrase(data.phrase);
        try {
          localStorage.setItem(`kawiil-phrase-${user.id}`, JSON.stringify({
            date: today.toISOString().split("T")[0],
            timeOfDay,
            phrase: data.phrase,
          }));
        } catch {}
      }
    } catch (e: any) {
      console.error("Phrase error:", e);
    } finally {
      setPhraseLoading(false);
    }
  };

  // Load cached phrase or generate on first load
  useEffect(() => {
    if (!user) return;
    try {
      const cached = localStorage.getItem(`kawiil-phrase-${user.id}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        const hour = currentTime.getHours();
        const currentTimeOfDay = hour < 14 ? "morning" : "afternoon";
        if (parsed.date === today.toISOString().split("T")[0] && parsed.timeOfDay === currentTimeOfDay) {
          setPersonalPhrase(parsed.phrase);
          return;
        }
      }
    } catch {}
    fetchPhrase();
  }, [user?.id]);

  // My tasks
  const { data: myTasks } = useQuery({
    queryKey: ["personal-tasks", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, status, priority, due_date, area, project_id")
        .eq("assigned_to", user!.id)
        .in("status", ["pendiente", "en_progreso", "en_revision"])
        .order("due_date", { ascending: true })
        .limit(15);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // My completed today
  const { data: completedToday } = useQuery({
    queryKey: ["personal-completed-today", user?.id],
    queryFn: async () => {
      const todayStr = today.toISOString().split("T")[0];
      const { count, error } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to", user!.id)
        .eq("status", "completada")
        .gte("updated_at", todayStr);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user,
  });

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

  // Reminders
  const { reminders, addReminder, toggleReminder, deleteReminder } = useReminders();
  const [newReminder, setNewReminder] = useState("");

  const pendingReminders = reminders.filter((r) => !r.is_completed);
  const completedReminders = reminders.filter((r) => r.is_completed);

  const handleAddReminder = () => {
    if (!newReminder.trim()) return;
    addReminder.mutate({ title: newReminder.trim() });
    setNewReminder("");
  };

  const overdueTasks = myTasks?.filter(
    (t) => t.due_date && new Date(t.due_date) < today
  ).length ?? 0;

  const totalPending = myTasks?.length ?? 0;
  const firstName = profile?.full_name?.split(" ")[0] || "";

  const priorityDot = (p: string) => {
    switch (p) {
      case "urgente": return "bg-destructive";
      case "alta": return "bg-warning";
      case "media": return "bg-primary";
      default: return "bg-muted-foreground/30";
    }
  };

  return (
    <div className="max-w-3xl space-y-6 min-w-0">
      {/* Greeting (no date/time — now in AppLayout) */}
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground tracking-tight">
          {firstName ? `Hola, ${firstName}` : "Hola"} 👋
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {totalPending} pendiente{totalPending !== 1 ? "s" : ""}
          {overdueTasks > 0 && (
            <span className="text-destructive"> · {overdueTasks} vencida{overdueTasks !== 1 ? "s" : ""}</span>
          )}
          {(completedToday ?? 0) > 0 && (
            <span className="text-accent"> · {completedToday} completada{(completedToday ?? 0) !== 1 ? "s" : ""} hoy</span>
          )}
        </p>

        {/* Personalized phrase */}
        {personalPhrase ? (
          <p className="text-[13px] text-muted-foreground italic border-l-2 border-primary/30 pl-3 mt-3">
            {personalPhrase}
          </p>
        ) : phraseLoading ? (
          <p className="text-[13px] text-muted-foreground italic border-l-2 border-border pl-3 mt-3 animate-pulse">
            Preparando tu frase del día...
          </p>
        ) : null}
      </div>

      {/* Questionnaire reminder */}
      {showQuestionnaireReminder && (
        <div className="flex flex-wrap items-center gap-3 px-3 sm:px-4 py-3 rounded-lg bg-primary/5 border border-primary/15">
          <Sparkles className="h-5 w-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Kawiil quiere conocerte</p>
            <p className="text-xs text-muted-foreground">Responde un breve cuestionario para personalizar tu experiencia</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {daysLeft}d
            </span>
            <Button size="sm" variant="default" className="text-xs" onClick={() => setShowQuestionnaire(true)}>
              Responder
            </Button>
          </div>
        </div>
      )}

      {/* Mood — inline */}
      <MoodCheckin userCelula={userCelula} />

      {/* Tabs for sections */}
      <Tabs defaultValue="resumen" className="w-full min-w-0">
        <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max sm:w-full justify-start border-b border-border bg-transparent rounded-none h-auto p-0 gap-0">
            <TabsTrigger
              value="resumen"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 sm:px-4 py-2.5 text-xs sm:text-sm whitespace-nowrap"
            >
              Resumen
            </TabsTrigger>
            <TabsTrigger
              value="tareas"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 sm:px-4 py-2.5 text-xs sm:text-sm whitespace-nowrap"
            >
              Tareas ({totalPending})
            </TabsTrigger>
            <TabsTrigger
              value="clientes"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 sm:px-4 py-2.5 text-xs sm:text-sm whitespace-nowrap"
            >
              Clientes ({myClients?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger
              value="recordatorios"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 sm:px-4 py-2.5 text-xs sm:text-sm whitespace-nowrap"
            >
              Recordatorios ({pendingReminders.length})
            </TabsTrigger>
            <TabsTrigger
              value="rendimiento"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 sm:px-4 py-2.5 text-xs sm:text-sm whitespace-nowrap"
            >
              Rendimiento
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Resumen */}
        <TabsContent value="resumen" className="mt-6 space-y-6">
          <DailyBriefing
            tasksCount={totalPending}
            completedToday={completedToday ?? 0}
            overdueCount={overdueTasks}
            remindersCount={pendingReminders.length}
          />

          {/* Quick glance: top 5 tasks */}
          {myTasks && myTasks.length > 0 && (
            <div>
              <h3 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Próximas tareas</h3>
              <div className="divide-y divide-border/40">
                {myTasks.slice(0, 5).map((t) => (
                  <button
                    key={t.id}
                    className="flex items-center gap-3 w-full py-2 text-left hover:bg-secondary/30 -mx-2 px-2 rounded-md transition-colors"
                    onClick={() => navigate(t.project_id ? `/proyectos/${t.project_id}?tab=tareas&taskId=${t.id}` : `/tareas?taskId=${t.id}`)}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${priorityDot(t.priority)}`} />
                    <span className="text-sm text-foreground truncate flex-1">{t.title}</span>
                    {t.due_date && (
                      <span className={`text-[11px] shrink-0 ${new Date(t.due_date) < today ? "text-destructive" : "text-muted-foreground"}`}>
                        {formatDateMX(t.due_date)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quick glance: clients */}
          {myClients && myClients.length > 0 && (
            <div>
              <h3 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Mis clientes</h3>
              <div className="flex flex-wrap gap-2">
                {myClients.slice(0, 8).map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => navigate(`/clientes/${c.id}`)}
                    className="text-sm px-3 py-1.5 rounded-md bg-secondary/50 hover:bg-secondary text-foreground transition-colors"
                  >
                    {c.name}
                  </button>
                ))}
                {myClients.length > 8 && (
                  <button
                    onClick={() => navigate("/clientes")}
                    className="text-sm px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                  >
                    +{myClients.length - 8} más
                  </button>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Tareas */}
        <TabsContent value="tareas" className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide">
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
            <p className="text-sm text-muted-foreground py-4">Sin tareas pendientes 🎉</p>
          ) : (
            <div className="divide-y divide-border/40">
              {myTasks.map((t) => (
                <button
                  key={t.id}
                  className="flex items-center gap-3 w-full py-2.5 text-left hover:bg-secondary/30 -mx-2 px-2 rounded-md transition-colors"
                  onClick={() => navigate(t.project_id ? `/proyectos/${t.project_id}?tab=tareas&taskId=${t.id}` : `/tareas?taskId=${t.id}`)}
                >
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${priorityDot(t.priority)}`} />
                  <span className="text-sm text-foreground truncate flex-1">{t.title}</span>
                  {t.area && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                      {(SERVICE_LABELS as any)[t.area] || t.area}
                    </Badge>
                  )}
                  {t.due_date && (
                    <span className={`text-[11px] shrink-0 ${new Date(t.due_date) < today ? "text-destructive" : "text-muted-foreground"}`}>
                      {formatDateMX(t.due_date)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Mis Clientes */}
        <TabsContent value="clientes" className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide">
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
            <div className="divide-y divide-border/40">
              {myClients.map((c: any) => (
                <button
                  key={c.id}
                  className="flex items-center gap-3 w-full py-3 text-left hover:bg-secondary/30 -mx-2 px-2 rounded-md transition-colors"
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
        <TabsContent value="recordatorios" className="mt-6">
          <div className="flex items-center gap-2 mb-4">
            <Input
              placeholder="Agregar recordatorio..."
              value={newReminder}
              onChange={(e) => setNewReminder(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddReminder()}
              className="text-sm h-9"
            />
            {newReminder.trim() && (
              <button onClick={handleAddReminder} className="text-muted-foreground hover:text-foreground">
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>

          {pendingReminders.length === 0 && completedReminders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Sin recordatorios</p>
          ) : (
            <div className="space-y-0.5">
              {pendingReminders.map((r) => (
                <div key={r.id} className="flex items-center gap-3 py-2 group">
                  <Checkbox
                    checked={false}
                    onCheckedChange={() => toggleReminder.mutate({ id: r.id, is_completed: true })}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-foreground flex-1 truncate">{r.title}</span>
                  {r.due_date && (
                    <span className={`text-[11px] ${new Date(r.due_date) < today ? "text-destructive" : "text-muted-foreground"}`}>
                      {formatDateMX(r.due_date)}
                    </span>
                  )}
                  <button
                    onClick={() => deleteReminder.mutate(r.id)}
                    className="text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {completedReminders.length > 0 && (
                <div className="pt-3 border-t border-border/40 mt-3">
                  <p className="text-[11px] text-muted-foreground mb-2">Completados</p>
                  {completedReminders.slice(0, 5).map((r) => (
                    <div key={r.id} className="flex items-center gap-3 py-1.5 opacity-40 group">
                      <Checkbox
                        checked={true}
                        onCheckedChange={() => toggleReminder.mutate({ id: r.id, is_completed: false })}
                        className="h-4 w-4"
                      />
                      <span className="text-sm text-muted-foreground line-through flex-1 truncate">{r.title}</span>
                      <button
                        onClick={() => deleteReminder.mutate(r.id)}
                        className="text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-destructive transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* Rendimiento */}
        <TabsContent value="rendimiento" className="mt-6 space-y-8">
          <PerformanceChart />
          <MonthlyPerformance />
        </TabsContent>
      </Tabs>

      {/* Questionnaire Dialog */}
      <PreferenceQuestionnaire
        open={showQuestionnaire}
        onClose={() => setShowQuestionnaire(false)}
        onCompleted={() => {
          refetchPrefs();
          fetchPhrase(undefined, true);
        }}
      />
    </div>
  );
}
