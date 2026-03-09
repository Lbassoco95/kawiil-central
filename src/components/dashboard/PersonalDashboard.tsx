import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useReminders } from "@/hooks/useReminders";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { getWeeklyQuote } from "@/lib/weeklyQuotes";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { MoodCheckin } from "@/components/dashboard/MoodCheckin";
import { PerformanceChart } from "@/components/dashboard/PerformanceChart";
import { MonthlyPerformance } from "@/components/dashboard/MonthlyPerformance";
import { DailyBriefing } from "@/components/dashboard/DailyBriefing";
import {
  Plus,
  Trash2,
  ArrowRight,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { formatDateMX, nowMX } from "@/lib/dateUtils";
import { useNavigate } from "react-router-dom";

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
  const quote = useMemo(() => getWeeklyQuote(), []);
  const [showCharts, setShowCharts] = useState(false);

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

  // My tasks
  const { data: myTasks } = useQuery({
    queryKey: ["personal-tasks", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, status, priority, due_date, area")
        .eq("assigned_to", user!.id)
        .in("status", ["pendiente", "en_progreso", "en_revision"])
        .order("due_date", { ascending: true })
        .limit(10);
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
    <div className="max-w-3xl space-y-10">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
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
      </div>

      {/* Quote — subtle, one line */}
      <p className="text-[13px] text-muted-foreground italic border-l-2 border-border pl-3">
        "{quote.text}" — {quote.author}
      </p>

      {/* Mood — inline */}
      <MoodCheckin userCelula={userCelula} />

      {/* AI Briefing — collapsible */}
      <DailyBriefing
        tasksCount={totalPending}
        completedToday={completedToday ?? 0}
        overdueCount={overdueTasks}
        remindersCount={pendingReminders.length}
      />

      {/* Tasks */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide">
            Tareas
          </h2>
          <button
            onClick={() => navigate("/tareas")}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            Ver todas <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        {!myTasks?.length ? (
          <p className="text-sm text-muted-foreground py-4">Sin tareas pendientes</p>
        ) : (
          <div className="divide-y divide-border/40">
            {myTasks.map((t) => (
              <button
                key={t.id}
                className="flex items-center gap-3 w-full py-2.5 text-left hover:bg-secondary/30 -mx-2 px-2 rounded-md transition-colors"
                onClick={() => navigate("/tareas")}
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
        )}
      </section>

      {/* Reminders */}
      <section>
        <h2 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Recordatorios
        </h2>

        <div className="flex items-center gap-2 mb-3">
          <Input
            placeholder="Agregar recordatorio..."
            value={newReminder}
            onChange={(e) => setNewReminder(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddReminder()}
            className="text-sm h-8 border-0 bg-transparent shadow-none px-0 placeholder:text-muted-foreground/50 focus-visible:ring-0"
          />
          {newReminder.trim() && (
            <button onClick={handleAddReminder} className="text-muted-foreground hover:text-foreground">
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>

        {pendingReminders.length === 0 && completedReminders.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Sin recordatorios</p>
        ) : (
          <div className="space-y-0.5">
            {pendingReminders.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-1.5 group">
                <Checkbox
                  checked={false}
                  onCheckedChange={() => toggleReminder.mutate({ id: r.id, is_completed: true })}
                  className="h-3.5 w-3.5"
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
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            {completedReminders.slice(0, 2).map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-1.5 opacity-40 group">
                <Checkbox
                  checked={true}
                  onCheckedChange={() => toggleReminder.mutate({ id: r.id, is_completed: false })}
                  className="h-3.5 w-3.5"
                />
                <span className="text-sm text-muted-foreground line-through flex-1 truncate">{r.title}</span>
                <button
                  onClick={() => deleteReminder.mutate(r.id)}
                  className="text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-destructive transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Charts — collapsed by default */}
      <section>
        <button
          onClick={() => setShowCharts(!showCharts)}
          className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showCharts ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <span className="uppercase tracking-wide">Rendimiento</span>
        </button>
        {showCharts && (
          <div className="mt-6 space-y-8">
            <PerformanceChart />
            <MonthlyPerformance />
          </div>
        )}
      </section>
    </div>
  );
}
