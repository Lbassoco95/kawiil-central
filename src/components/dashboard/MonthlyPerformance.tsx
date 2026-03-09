import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function MonthlyPerformance() {
  const { user } = useAuth();
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const { data: monthlyData } = useQuery({
    queryKey: ["personal-monthly-perf", user?.id, currentYear, currentMonth],
    queryFn: async () => {
      const startDate = new Date(currentYear, currentMonth, 1).toISOString().split("T")[0];
      const endDate = new Date(currentYear, currentMonth + 1, 0).toISOString().split("T")[0];
      const todayStr = now.toISOString().split("T")[0];

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
        (t) => ["pendiente", "en_progreso", "en_revision"].includes(t.status) && t.due_date && t.due_date < todayStr
      ).length ?? 0;

      const totalActive = tasks?.filter(
        (t) => ["pendiente", "en_progreso", "en_revision", "completada"].includes(t.status)
      ).length ?? 0;

      return { completed, overdue, totalActive };
    },
    enabled: !!user,
  });

  const completionRate = monthlyData && monthlyData.totalActive > 0
    ? Math.round((monthlyData.completed / monthlyData.totalActive) * 100)
    : 0;

  const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  return (
    <div>
      <p className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide mb-3">
        {monthNames[currentMonth]} {currentYear}
      </p>
      <div className="flex items-baseline gap-6">
        <div>
          <span className="text-2xl font-semibold text-foreground">{monthlyData?.completed ?? 0}</span>
          <span className="text-[11px] text-muted-foreground ml-1.5">completadas</span>
        </div>
        {(monthlyData?.overdue ?? 0) > 0 && (
          <div>
            <span className="text-2xl font-semibold text-destructive">{monthlyData?.overdue}</span>
            <span className="text-[11px] text-muted-foreground ml-1.5">vencidas</span>
          </div>
        )}
        <div>
          <span className={`text-2xl font-semibold ${completionRate >= 75 ? "text-accent" : "text-foreground"}`}>
            {completionRate}%
          </span>
          <span className="text-[11px] text-muted-foreground ml-1.5">cumplimiento</span>
        </div>
      </div>
    </div>
  );
}
