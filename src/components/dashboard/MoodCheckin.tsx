import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const MOODS = [
  { value: 1, emoji: "😞" },
  { value: 2, emoji: "😕" },
  { value: 3, emoji: "😐" },
  { value: 4, emoji: "🙂" },
  { value: 5, emoji: "😄" },
];

interface MoodCheckinProps {
  userCelula: string | null;
}

export function MoodCheckin({ userCelula }: MoodCheckinProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedMood, setSelectedMood] = useState<number | null>(null);

  const now = new Date();
  const currentHour = now.getHours();

  // Morning window: 09:00 – 14:59 (check_date = today, time_of_day = "morning")
  // Afternoon window: 15:00 – 23:59 today + 00:00 – 08:59 next day
  //   If hour >= 15: check_date = today, time_of_day = "afternoon"
  //   If hour < 9: check_date = yesterday, time_of_day = "afternoon" (still the same afternoon slot)
  //   If hour >= 9 && hour < 15: time_of_day = "morning", check_date = today

  let timeOfDay: "morning" | "afternoon";
  let checkDate: string;

  if (currentHour >= 9 && currentHour < 15) {
    // Morning slot
    timeOfDay = "morning";
    checkDate = now.toISOString().split("T")[0];
  } else if (currentHour >= 15) {
    // Afternoon slot (same day)
    timeOfDay = "afternoon";
    checkDate = now.toISOString().split("T")[0];
  } else {
    // Before 9am — still the previous day's afternoon slot
    timeOfDay = "afternoon";
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    checkDate = yesterday.toISOString().split("T")[0];
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
      toast.success("Registrado");
      setSelectedMood(null);
    },
    onError: () => toast.error("Error al guardar"),
  });

  // Don't show before 9am if yesterday's afternoon was already checked
  // (the query handles this — existingCheckin will be truthy)

  if (existingCheckin) {
    const mood = MOODS.find((m) => m.value === (existingCheckin as any).mood);
    return (
      <p className="text-[13px] text-muted-foreground">
        Hoy ({timeLabel}): {mood?.emoji}
      </p>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-[13px] text-muted-foreground">¿Cómo va tu {timeLabel}?</span>
      <div className="flex gap-1">
        {MOODS.map((m) => (
          <button
            key={m.value}
            onClick={() => submitMood.mutate(m.value)}
            disabled={submitMood.isPending}
            className="text-lg hover:scale-125 transition-transform px-0.5"
          >
            {m.emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
