import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import { Calendar, Target } from "lucide-react";

export function MonthlyPerformance() {
  const { user } = useAuth();

  const now = new Date();
  const currentMonth = now.getMonth(); // 0-indexed
  const currentYear = now.getFullYear();

  // Get tasks for current month
  const { data: monthlyData } = useQuery({
    queryKey: ["personal-monthly-perf", user?.id, currentYear, currentMonth],
    queryFn: async () => {
      const startDate = new Date(currentYear, currentMonth, 1).toISOString().split("T")[0];
      const endDate = new Date(currentYear, currentMonth + 1, 0).toISOString().split("T")[0];
      const todayStr = now.toISOString().split("T")[0];

      // All tasks assigned to user that were active this month
      const { data: tasks, error } = await supabase
        .from("tasks")
        .select("id, status, due_date, updated_at, created_at")
        .eq("assigned_to", user!.id)
        .or(`created_at.lte.${endDate}T23:59:59Z`);
      if (error) throw error;

      const completed = tasks?.filter(
        (t) => t.status === "completada" && t.updated_at >= `${startDate}T00:00:00Z` && t.updated_at <= `${endDate}T23:59:59Z`
      ).length ?? 0;

      const overdue = tasks?.filter(
        (t) =>
          ["pendiente", "en_progreso", "en_revision"].includes(t.status) &&
          t.due_date && t.due_date < todayStr
      ).length ?? 0;

      const totalActive = tasks?.filter(
        (t) => ["pendiente", "en_progreso", "en_revision", "completada"].includes(t.status)
      ).length ?? 0;

      // Weekly breakdown for the month
      const weeks: { label: string; completed: number; overdue: number }[] = [];
      for (let w = 0; w < 5; w++) {
        const weekStart = new Date(currentYear, currentMonth, 1 + w * 7);
        const weekEnd = new Date(currentYear, currentMonth, Math.min(7 + w * 7, new Date(currentYear, currentMonth + 1, 0).getDate()));
        if (weekStart.getMonth() !== currentMonth) break;

        const wStartStr = weekStart.toISOString().split("T")[0];
        const wEndStr = weekEnd.toISOString().split("T")[0];

        const wCompleted = tasks?.filter(
          (t) => t.status === "completada" && t.updated_at >= `${wStartStr}T00:00:00Z` && t.updated_at <= `${wEndStr}T23:59:59Z`
        ).length ?? 0;

        const wOverdue = tasks?.filter(
          (t) =>
            ["pendiente", "en_progreso", "en_revision"].includes(t.status) &&
            t.due_date && t.due_date >= wStartStr && t.due_date <= wEndStr && t.due_date < todayStr
        ).length ?? 0;

        weeks.push({ label: `Sem ${w + 1}`, completed: wCompleted, overdue: wOverdue });
      }

      return { completed, overdue, totalActive, weeks };
    },
    enabled: !!user,
  });

  const completionRate = monthlyData && monthlyData.totalActive > 0
    ? Math.round((monthlyData.completed / monthlyData.totalActive) * 100)
    : 0;

  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Rendimiento — {monthNames[currentMonth]}</h2>
      </div>

      <div className="grid gap-4 grid-cols-3 mb-4">
        <div className="rounded-xl bg-secondary/30 p-3 text-center">
          <div className="text-lg font-semibold text-foreground">{monthlyData?.completed ?? 0}</div>
          <div className="text-[10px] text-muted-foreground">Completadas</div>
        </div>
        <div className={`rounded-xl p-3 text-center ${(monthlyData?.overdue ?? 0) > 0 ? "bg-destructive/5" : "bg-secondary/30"}`}>
          <div className={`text-lg font-semibold ${(monthlyData?.overdue ?? 0) > 0 ? "text-destructive" : "text-foreground"}`}>
            {monthlyData?.overdue ?? 0}
          </div>
          <div className="text-[10px] text-muted-foreground">Vencidas</div>
        </div>
        <div className="rounded-xl bg-secondary/30 p-3 text-center">
          <div className={`text-lg font-semibold ${completionRate >= 75 ? "text-success" : completionRate >= 40 ? "text-primary" : "text-muted-foreground"}`}>
            {completionRate}%
          </div>
          <div className="text-[10px] text-muted-foreground">Cumplimiento</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="rounded-xl bg-secondary/30 p-3 mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-primary" />
            <span className="text-[12px] text-foreground font-medium">Tasa de cumplimiento</span>
          </div>
          <span className="text-[12px] font-semibold text-primary">{completionRate}%</span>
        </div>
        <Progress value={completionRate} className="h-1.5" />
      </div>

      {/* Weekly chart */}
      {monthlyData?.weeks && monthlyData.weeks.length > 0 && (
        <div className="rounded-xl bg-secondary/30 p-4">
          <p className="text-[11px] text-muted-foreground mb-3">Desglose semanal</p>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData.weeks} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={25} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number, name: string) => [value, name === "completed" ? "Completadas" : "Vencidas"]}
                />
                <Bar dataKey="completed" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} opacity={0.8} />
                <Bar dataKey="overdue" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} opacity={0.6} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}
