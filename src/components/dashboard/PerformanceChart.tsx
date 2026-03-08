import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingUp } from "lucide-react";

export function PerformanceChart() {
  const { user } = useAuth();

  // Get completed tasks per day for the last 7 days
  const { data: dailyStats } = useQuery({
    queryKey: ["personal-daily-stats", user?.id],
    queryFn: async () => {
      const days: { date: string; label: string; completed: number }[] = [];
      const now = new Date();

      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split("T")[0];
        const nextDay = new Date(d);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextStr = nextDay.toISOString().split("T")[0];

        const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
        days.push({
          date: dateStr,
          label: i === 0 ? "Hoy" : i === 1 ? "Ayer" : dayNames[d.getDay()],
          completed: 0,
        });
      }

      // Query all completed tasks in the 7-day range
      const startDate = days[0].date;
      const { data, error } = await supabase
        .from("tasks")
        .select("updated_at")
        .eq("assigned_to", user!.id)
        .eq("status", "completada")
        .gte("updated_at", startDate);

      if (error) throw error;

      // Count per day
      data?.forEach((t) => {
        const tDate = t.updated_at.split("T")[0];
        const day = days.find((d) => d.date === tDate);
        if (day) day.completed++;
      });

      return days;
    },
    enabled: !!user,
  });

  // Mood history for the last 7 days
  const { data: moodHistory } = useQuery({
    queryKey: ["mood-history", user?.id],
    queryFn: async () => {
      const now = new Date();
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 6);
      const startStr = startDate.toISOString().split("T")[0];

      const { data, error } = await supabase
        .from("mood_checkins" as any)
        .select("check_date, time_of_day, mood")
        .eq("user_id", user!.id)
        .gte("check_date", startStr)
        .order("check_date", { ascending: true });

      if (error) throw error;
      return data as unknown as { check_date: string; time_of_day: string; mood: number }[];
    },
    enabled: !!user,
  });

  // Merge mood into daily stats
  const chartData = useMemo(() => {
    if (!dailyStats) return [];
    return dailyStats.map((day) => {
      const dayMoods = moodHistory?.filter((m) => m.check_date === day.date) ?? [];
      const avgMood = dayMoods.length > 0
        ? Math.round((dayMoods.reduce((s, m) => s + m.mood, 0) / dayMoods.length) * 10) / 10
        : null;
      return { ...day, mood: avgMood };
    });
  }, [dailyStats, moodHistory]);

  const MOOD_EMOJIS: Record<number, string> = { 1: "😞", 2: "😕", 3: "😐", 4: "🙂", 5: "😄" };

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Tu rendimiento (7 días)</h2>
      </div>
      <div className="rounded-xl bg-secondary/30 p-4">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                width={30}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number, name: string) => {
                  if (name === "completed") return [value, "Completadas"];
                  return [value, name];
                }}
                labelFormatter={(label) => label}
              />
              <Bar
                dataKey="completed"
                fill="hsl(var(--primary))"
                radius={[4, 4, 0, 0]}
                opacity={0.8}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Mood row below chart */}
        {chartData.some((d) => d.mood !== null) && (
          <div className="flex justify-between mt-2 px-1">
            {chartData.map((d) => (
              <div key={d.date} className="flex flex-col items-center" style={{ width: `${100 / 7}%` }}>
                <span className="text-lg">
                  {d.mood !== null ? MOOD_EMOJIS[Math.round(d.mood)] ?? "😐" : "·"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
