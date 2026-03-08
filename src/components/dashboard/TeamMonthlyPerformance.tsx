import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useCelulaOptions } from "@/hooks/useCelulaOptions";
import { Progress } from "@/components/ui/progress";
import { BarChart as BarChartIcon, ChevronDown, ChevronUp } from "lucide-react";

export function TeamMonthlyPerformance() {
  const { user } = useAuth();
  const { data: orgUsers } = useOrgUsers();
  const { data: celulas } = useCelulaOptions();
  const [expandedCelula, setExpandedCelula] = useState<string | null>(null);

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  const startDate = new Date(currentYear, currentMonth, 1).toISOString().split("T")[0];
  const endDate = new Date(currentYear, currentMonth + 1, 0).toISOString().split("T")[0];
  const todayStr = now.toISOString().split("T")[0];

  const { data: allTasks } = useQuery({
    queryKey: ["team-monthly-perf", currentYear, currentMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, status, due_date, updated_at, assigned_to, area")
        .or(`created_at.lte.${endDate}T23:59:59Z`);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Build celula-level and individual stats
  const celulaStats = useMemo(() => {
    if (!orgUsers || !allTasks) return [];

    const activeUsers = orgUsers.filter((u) => u.is_active && u.invitation_accepted);

    // Group users by celula
    const celulaMap: Record<string, {
      name: string;
      color: string;
      members: {
        userId: string;
        name: string;
        completed: number;
        overdue: number;
        totalActive: number;
        rate: number;
      }[];
    }> = {};

    activeUsers.forEach((u) => {
      const celulaSlug = u.area || "sin_celula";
      const celulaInfo = celulas?.find((c) => c.slug === celulaSlug);
      const celulaName = celulaInfo?.name || celulaSlug;
      const celulaColor = celulaInfo?.color || "#6366f1";

      if (!celulaMap[celulaSlug]) {
        celulaMap[celulaSlug] = { name: celulaName, color: celulaColor, members: [] };
      }

      const userTasks = allTasks.filter((t) => t.assigned_to === u.user_id);
      const completed = userTasks.filter(
        (t) => t.status === "completada" && t.updated_at >= `${startDate}T00:00:00Z` && t.updated_at <= `${endDate}T23:59:59Z`
      ).length;
      const overdue = userTasks.filter(
        (t) => ["pendiente", "en_progreso", "en_revision"].includes(t.status) && t.due_date && t.due_date < todayStr
      ).length;
      const totalActive = userTasks.filter(
        (t) => ["pendiente", "en_progreso", "en_revision", "completada"].includes(t.status)
      ).length;
      const rate = totalActive > 0 ? Math.round((completed / totalActive) * 100) : 0;

      celulaMap[celulaSlug].members.push({
        userId: u.user_id,
        name: u.full_name,
        completed,
        overdue,
        totalActive,
        rate,
      });
    });

    return Object.entries(celulaMap)
      .filter(([_, v]) => v.members.some((m) => m.totalActive > 0))
      .map(([slug, v]) => {
        const totalCompleted = v.members.reduce((s, m) => s + m.completed, 0);
        const totalOverdue = v.members.reduce((s, m) => s + m.overdue, 0);
        const totalActive = v.members.reduce((s, m) => s + m.totalActive, 0);
        const rate = totalActive > 0 ? Math.round((totalCompleted / totalActive) * 100) : 0;
        return {
          slug,
          name: v.name,
          color: v.color,
          completed: totalCompleted,
          overdue: totalOverdue,
          totalActive,
          rate,
          members: v.members.filter((m) => m.totalActive > 0).sort((a, b) => b.rate - a.rate),
        };
      })
      .sort((a, b) => b.totalActive - a.totalActive);
  }, [orgUsers, allTasks, celulas, startDate, endDate, todayStr]);

  const progressColor = (pct: number) => {
    if (pct >= 75) return "text-success";
    if (pct >= 40) return "text-primary";
    return "text-muted-foreground";
  };

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <BarChartIcon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Rendimiento del equipo — {monthNames[currentMonth]}</h2>
      </div>

      {celulaStats.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Sin datos para este mes</p>
      ) : (
        <div className="space-y-2">
          {celulaStats.map((c) => (
            <div key={c.slug} className="rounded-xl bg-secondary/30 overflow-hidden">
              {/* Celula header */}
              <button
                onClick={() => setExpandedCelula(expandedCelula === c.slug ? null : c.slug)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                  <div className="min-w-0">
                    <span className="text-[13px] font-medium text-foreground block">{c.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {c.completed} completadas · {c.overdue > 0 && <span className="text-destructive">{c.overdue} vencidas · </span>}{c.members.length} miembros
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <span className={`text-[13px] font-semibold ${progressColor(c.rate)}`}>{c.rate}%</span>
                    <span className="text-[10px] text-muted-foreground block">{c.completed}/{c.totalActive}</span>
                  </div>
                  {expandedCelula === c.slug ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </button>

              {/* Progress bar */}
              <div className="px-4 pb-3">
                <Progress value={c.rate} className="h-1" />
              </div>

              {/* Individual drill-down */}
              {expandedCelula === c.slug && (
                <div className="border-t border-border/30 px-4 py-2 space-y-1">
                  {c.members.map((m) => (
                    <div key={m.userId} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-secondary/40">
                      <div className="min-w-0 flex-1 mr-3">
                        <span className="text-[12px] text-foreground block truncate">{m.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {m.completed} completadas
                          {m.overdue > 0 && <span className="text-destructive ml-1">· {m.overdue} vencidas</span>}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="w-16">
                          <Progress value={m.rate} className="h-1" />
                        </div>
                        <span className={`text-[12px] font-semibold w-10 text-right ${progressColor(m.rate)}`}>{m.rate}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
