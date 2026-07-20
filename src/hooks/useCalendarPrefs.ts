import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface CalendarPrefs {
  hiddenCalendarIds?: string[];
  calendarColors?: Record<string, string>;
  categoryColors?: Record<string, string>;
  accountColors?: Record<string, string>;
  primaryName?: string;
  activeCategoryFilters?: string[];
  activeKawiilCatIds?: string[];
}

/** Lee las preferencias de calendario del usuario (fuente de verdad cross-dispositivo). */
export function useCalendarPrefs() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["user-calendar-prefs"],
    queryFn: async (): Promise<CalendarPrefs> => {
      const { data, error } = await (supabase as any)
        .from("user_calendar_prefs")
        .select("prefs")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return ((data?.prefs as CalendarPrefs) || {});
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/** Guarda (upsert) las preferencias del usuario. */
export function useSaveCalendarPrefs() {
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (prefs: CalendarPrefs) => {
      if (!user) return;
      const { error } = await (supabase as any)
        .from("user_calendar_prefs")
        .upsert({ user_id: user.id, prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
    },
  });
}
