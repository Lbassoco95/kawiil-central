import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useReminders } from "@/hooks/useReminders";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { getWeeklyQuote } from "@/lib/weeklyQuotes";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { MoodCheckin } from "@/components/dashboard/MoodCheckin";
import { PerformanceChart } from "@/components/dashboard/PerformanceChart";
import { MonthlyPerformance } from "@/components/dashboard/MonthlyPerformance";
import { DailyBriefing } from "@/components/dashboard/DailyBriefing";
import {
  Plus as PlusIcon,
  Trash2,
  Bell,
  CheckSquare,
  ArrowRight,
  Quote,
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
  const [reminderDate, setReminderDate] = useState("");

  const pendingReminders = reminders.filter((r) => !r.is_completed);
  const completedReminders = reminders.filter((r) => r.is_completed);

  const handleAddReminder = () => {
    if (!newReminder.trim()) return;
    addReminder.mutate({
      title: newReminder.trim(),
      due_date: reminderDate || undefined,
    });
    setNewReminder("");
    setReminderDate("");
  };

  const overdueTasks = myTasks?.filter(
    (t) => t.due_date && new Date(t.due_date) < today
  ).length ?? 0;

  const priorityColor = (p: string) => {
    switch (p) {
      case "urgente": return "bg-destructive/10 text-destructive border-destructive/20";
      case "alta": return "bg-warning/10 text-warning border-warning/20";
      case "media": return "bg-primary/10 text-primary border-primary/20";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const totalPending = myTasks?.length ?? 0;
  const progressPct = totalPending + (completedToday ?? 0) > 0
    ? Math.round(((completedToday ?? 0) / (totalPending + (completedToday ?? 0))) * 100)
    : 0;

  return (
    <div className="space-y-8">
      {/* Weekly Quote */}
      <div className="rounded-2xl bg-primary/5 border border-primary/10 p-6 relative overflow-hidden">
        <Quote className="absolute top-4 right-4 h-8 w-8 text-primary/10" />
        <p className="text-[15px] text-foreground italic leading-relaxed max-w-2xl">
          "{quote.text}"
        </p>
        <p className="text-xs text-muted-foreground mt-3">— {quote.author}</p>
      </div>

      {/* Mood Check-in */}
      <MoodCheckin userCelula={userCelula} />

      {/* Today's Summary */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-secondary/50 px-4 py-3.5">
          <div className="text-xl font-semibold text-foreground">{totalPending}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Tareas pendientes</div>
        </div>
        <div className="rounded-xl bg-secondary/50 px-4 py-3.5">
          <div className="text-xl font-semibold text-foreground">{completedToday ?? 0}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Completadas hoy</div>
        </div>
        <div className={`rounded-xl px-4 py-3.5 ${overdueTasks > 0 ? "bg-destructive/5" : "bg-secondary/50"}`}>
          <div className={`text-xl font-semibold ${overdueTasks > 0 ? "text-destructive" : "text-foreground"}`}>{overdueTasks}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Vencidas</div>
        </div>
        <div className="rounded-xl bg-secondary/50 px-4 py-3.5">
          <div className="text-xl font-semibold text-foreground">{pendingReminders.length}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Recordatorios</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="rounded-xl bg-secondary/30 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] font-medium text-foreground">Tu avance de hoy</span>
          <span className="text-[13px] font-semibold text-primary">{progressPct}%</span>
        </div>
        <Progress value={progressPct} className="h-1.5" />
      </div>

      {/* Performance Chart */}
      <PerformanceChart />

      {/* Monthly Performance */}
      <MonthlyPerformance />

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Tasks */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Mis tareas</h2>
            </div>
            <button
              onClick={() => navigate("/tareas")}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              Ver todas <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {!myTasks?.length ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Sin tareas pendientes 🎉</p>
          ) : (
            <div className="space-y-px">
              {myTasks.map((t) => (
                <button
                  key={t.id}
                  className="flex items-center justify-between w-full rounded-lg px-3 py-2.5 text-sm hover:bg-secondary/60 transition-colors text-left"
                  onClick={() => navigate("/tareas")}
                >
                  <span className="truncate flex-1 mr-3 text-foreground">{t.title}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.due_date && (
                      <span className={`text-[11px] ${new Date(t.due_date) < today ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {formatDateMX(t.due_date)}
                      </span>
                    )}
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${priorityColor(t.priority)}`}>
                      {t.priority}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Reminders */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Bell className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Recordatorios</h2>
          </div>

          {/* Add reminder */}
          <div className="flex gap-2 mb-4">
            <Input
              placeholder="Nuevo recordatorio..."
              value={newReminder}
              onChange={(e) => setNewReminder(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddReminder()}
              className="text-sm h-9 bg-secondary/30 border-0"
            />
            <Input
              type="date"
              value={reminderDate}
              onChange={(e) => setReminderDate(e.target.value)}
              className="text-sm h-9 w-36 bg-secondary/30 border-0"
            />
            <Button size="sm" variant="ghost" onClick={handleAddReminder} disabled={!newReminder.trim()}>
              <PlusIcon className="h-4 w-4" />
            </Button>
          </div>

          {pendingReminders.length === 0 && completedReminders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Sin recordatorios</p>
          ) : (
            <div className="space-y-px">
              {pendingReminders.map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-secondary/60 transition-colors">
                  <Checkbox
                    checked={false}
                    onCheckedChange={() => toggleReminder.mutate({ id: r.id, is_completed: true })}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-foreground truncate block">{r.title}</span>
                    {r.due_date && (
                      <span className={`text-[11px] ${new Date(r.due_date) < today ? "text-destructive" : "text-muted-foreground"}`}>
                        {formatDateMX(r.due_date)}
                      </span>
                    )}
                  </div>
                  <button onClick={() => deleteReminder.mutate(r.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {completedReminders.slice(0, 3).map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-lg px-3 py-2 opacity-50">
                  <Checkbox
                    checked={true}
                    onCheckedChange={() => toggleReminder.mutate({ id: r.id, is_completed: false })}
                  />
                  <span className="text-sm text-muted-foreground line-through truncate flex-1">{r.title}</span>
                  <button onClick={() => deleteReminder.mutate(r.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* AI Insights placeholder */}
      <section className="rounded-2xl bg-secondary/20 border border-border/40 p-6">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Asistente IA</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Próximamente: tu asistente inteligente analizará tus patrones de trabajo, te ayudará a priorizar tareas 
          y te asistirá con redacción de correos y documentos. También podrás consultarle sobre actividades y proyectos.
        </p>
        <Button variant="outline" size="sm" className="mt-4 text-xs" disabled>
          <Sparkles className="h-3 w-3 mr-1" /> Abrir chat IA
        </Button>
      </section>
    </div>
  );
}
