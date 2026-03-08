import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const MOODS = [
  { value: 1, emoji: "😞", label: "Mal" },
  { value: 2, emoji: "😕", label: "Regular" },
  { value: 3, emoji: "😐", label: "Neutral" },
  { value: 4, emoji: "🙂", label: "Bien" },
  { value: 5, emoji: "😄", label: "Excelente" },
];

interface MoodCheckinProps {
  userCelula: string | null;
}

export function MoodCheckin({ userCelula }: MoodCheckinProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedMood, setSelectedMood] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const todayStr = new Date().toISOString().split("T")[0];
  const currentHour = new Date().getHours();
  const timeOfDay = currentHour < 14 ? "morning" : "afternoon";
  const timeLabel = timeOfDay === "morning" ? "mañana" : "tarde";

  // Check if already checked in for this time
  const { data: existingCheckin } = useQuery({
    queryKey: ["mood-checkin", user?.id, todayStr, timeOfDay],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mood_checkins" as any)
        .select("*")
        .eq("user_id", user!.id)
        .eq("check_date", todayStr)
        .eq("time_of_day", timeOfDay)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const submitMood = useMutation({
    mutationFn: async () => {
      if (!selectedMood) return;
      const orgRes = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      const { error } = await supabase.from("mood_checkins" as any).insert({
        user_id: user!.id,
        organization_id: orgRes.data,
        celula: userCelula,
        check_date: todayStr,
        time_of_day: timeOfDay,
        mood: selectedMood,
        reason: reason.trim() || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mood-checkin"] });
      qc.invalidateQueries({ queryKey: ["mood-history"] });
      toast.success("¡Gracias por compartir!");
      setSelectedMood(null);
      setReason("");
    },
    onError: () => toast.error("Error al guardar"),
  });

  if (existingCheckin) {
    const mood = MOODS.find((m) => m.value === (existingCheckin as any).mood);
    return (
      <div className="rounded-xl bg-secondary/30 p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">{mood?.emoji}</span>
          <span className="text-[13px] font-medium text-foreground">
            Check-in de {timeLabel} registrado
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Te sientes: {mood?.label}
          {(existingCheckin as any).reason && ` — "${(existingCheckin as any).reason}"`}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-secondary/30 p-4">
      <p className="text-[13px] font-medium text-foreground mb-3">
        ¿Cómo te sientes esta {timeLabel}?
      </p>
      <div className="flex gap-2 mb-3">
        {MOODS.map((m) => (
          <button
            key={m.value}
            onClick={() => setSelectedMood(m.value)}
            className={`flex flex-col items-center gap-1 rounded-xl px-3 py-2 transition-all ${
              selectedMood === m.value
                ? "bg-primary/10 ring-1 ring-primary/30 scale-110"
                : "hover:bg-secondary/60"
            }`}
          >
            <span className="text-2xl">{m.emoji}</span>
            <span className="text-[10px] text-muted-foreground">{m.label}</span>
          </button>
        ))}
      </div>
      {selectedMood && (
        <>
          <Textarea
            placeholder="¿Por qué te sientes así? (opcional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="text-sm bg-background/50 border-border/30 min-h-[60px] mb-3"
            rows={2}
          />
          <Button
            size="sm"
            onClick={() => submitMood.mutate()}
            disabled={submitMood.isPending}
            className="text-xs"
          >
            Registrar
          </Button>
        </>
      )}
    </div>
  );
}
