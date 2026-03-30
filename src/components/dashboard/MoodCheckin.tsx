import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Heart } from "lucide-react";
import { nowMX, toDateStringMX } from "@/lib/dateUtils";

const MOODS = [
  { value: 1, emoji: "😞", label: "Difícil" },
  { value: 2, emoji: "😕", label: "Regular" },
  { value: 3, emoji: "😐", label: "Normal" },
  { value: 4, emoji: "🙂", label: "Bien" },
  { value: 5, emoji: "😄", label: "Genial" },
];

interface MoodCheckinProps {
  userCelula: string | null;
}

export function MoodCheckin({ userCelula }: MoodCheckinProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedMood, setSelectedMood] = useState<number | null>(null);

  const now = nowMX();
  const currentHour = now.getHours();

  let timeOfDay: "morning" | "afternoon";
  let checkDate: string;

  if (currentHour >= 9 && currentHour < 15) {
    timeOfDay = "morning";
    checkDate = toDateStringMX(now);
  } else if (currentHour >= 15) {
    timeOfDay = "afternoon";
    checkDate = toDateStringMX(now);
  } else {
    timeOfDay = "afternoon";
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    checkDate = toDateStringMX(yesterday);
  }

  const timeLabel = timeOfDay === "morning" ? "mañana" : "tarde";

  const { data: existingCheckin } = useQuery({
    queryKey: ["mood-checkin", user?.id, checkDate, timeOfDay],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mood_checkins" as any)
        .select("*")
        .eq("user_id", user!.id)
        .eq("check_date", checkDate)
        .eq("time_of_day", timeOfDay)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: streakCount } = useQuery({
    queryKey: ["mood-streak", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mood_checkins" as any)
        .select("check_date")
        .eq("user_id", user!.id)
        .order("check_date", { ascending: false })
        .limit(30);
      if (error) throw error;
      if (!data || data.length === 0) return 0;
      const dates = [...new Set((data as any[]).map((d: any) => d.check_date))].sort().reverse();
      let streak = 0;
      const todayMX = nowMX();
      for (let i = 0; i < dates.length; i++) {
        const expected = new Date(todayMX);
        expected.setDate(expected.getDate() - i);
        const expectedStr = toDateStringMX(expected);
        if (dates[i] === expectedStr) {
          streak++;
        } else {
          break;
        }
      }
      return streak;
    },
    enabled: !!user,
  });

  const submitMood = useMutation({
    mutationFn: async (mood: number) => {
      const orgRes = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      const { error } = await supabase.from("mood_checkins" as any).insert({
        user_id: user!.id,
        organization_id: orgRes.data,
        celula: userCelula,
        check_date: checkDate,
        time_of_day: timeOfDay,
        mood,
        reason: null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mood-checkin"] });
      qc.invalidateQueries({ queryKey: ["mood-history"] });
      qc.invalidateQueries({ queryKey: ["mood-streak"] });
      toast.success("Registrado");
      setSelectedMood(null);
    },
    onError: () => toast.error("Error al guardar"),
  });

  if (existingCheckin) {
    const mood = MOODS.find((m) => m.value === (existingCheckin as any).mood);
    return (
      <div className="glass-card bg-gradient-to-r from-primary/5 to-accent/5 p-4 flex items-center gap-3 animate-fade-in">
        <span className="text-2xl">{mood?.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground font-medium">
            Tu {timeLabel}: {mood?.label}
          </p>
          {(streakCount ?? 0) > 1 && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Heart className="h-3 w-3 text-accent" />
              {streakCount} días consecutivos registrando
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card bg-gradient-to-r from-primary/5 to-accent/5 p-5 animate-scale-in">
      <p className="text-sm font-medium text-foreground mb-3">¿Cómo va tu {timeLabel}?</p>
      <div className="flex gap-1.5 justify-center">
        {MOODS.map((m) => (
          <button
            key={m.value}
            onClick={() => submitMood.mutate(m.value)}
            disabled={submitMood.isPending}
            className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl hover:bg-white/60 dark:hover:bg-white/5 hover:scale-110 hover:shadow-md transition-all duration-300"
            style={{ transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)" }}
          >
            <span className="text-2xl">{m.emoji}</span>
            <span className="text-[10px] text-muted-foreground">{m.label}</span>
          </button>
        ))}
      </div>
      {(streakCount ?? 0) > 1 && (
        <p className="text-xs text-muted-foreground text-center mt-2 flex items-center justify-center gap-1">
          <Heart className="h-3 w-3 text-accent" />
          {streakCount} días consecutivos
        </p>
      )}
    </div>
  );
}
