import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { mtgDb } from "@/lib/mtg/db";
import { matchProfileByName } from "@/lib/mtg/commitments";
import { addDaysToYmd } from "@/lib/dateUtils";

export interface PendingMeetingAgreement {
  id: string;
  text: string;
  status: "proposed" | "confirmed";
  ownerName: string | null;
  dueDate: string | null;
  /** Compromiso sin responsable: nadie lo verá en su dashboard hasta asignarlo. */
  unowned: boolean;
}

export interface MeetingFollowUp {
  /** Acuerdos de juntas recientes sin convertir en tarea que te tocan o capturaste tú. */
  mine: PendingMeetingAgreement[];
  /** Acuerdos de juntas recientes sin tarea y sin responsable (de cualquiera). */
  unownedCount: number;
  /** Total de acuerdos recientes sin tarea en la organización. */
  totalOpen: number;
}

const WINDOW_DAYS = 14;

/**
 * Compromisos de juntas (últimos 14 días) que aún no son tarea: propuestos por la IA
 * sin confirmar, o confirmados sin tarea (falta proyecto/cliente). Alimenta el briefing
 * para que esos pendientes no queden invisibles.
 */
export function useMeetingFollowUp(todayYmd: string, firstNameHint: string | null | undefined) {
  const { user } = useAuth();

  return useQuery<MeetingFollowUp>({
    queryKey: ["meeting-follow-up", user?.id, todayYmd],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const since = `${addDaysToYmd(todayYmd, -WINDOW_DAYS)}T00:00:00`;
      const { data, error } = await mtgDb
        .from("mtg_agreements")
        .select("id, text, status, owner_user_id, owner_name, due_date, created_by, task_id")
        .in("status", ["proposed", "confirmed"])
        .is("task_id", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;

      // Resolver "Responsable: Leopoldo" → usuario, con el mismo criterio que el intake de juntas.
      const { data: me } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .eq("user_id", user!.id)
        .maybeSingle();
      const mine: PendingMeetingAgreement[] = [];
      let unownedCount = 0;
      for (const a of data ?? []) {
        const unowned = !a.owner_user_id && !a.owner_name?.trim();
        if (unowned) unownedCount += 1;
        const byName =
          !!a.owner_name &&
          !!me &&
          (!!matchProfileByName([me], a.owner_name) ||
            (!!firstNameHint && a.owner_name.toLowerCase().includes(firstNameHint.toLowerCase())));
        if (a.owner_user_id === user!.id || a.created_by === user!.id || byName) {
          mine.push({
            id: a.id,
            text: a.text,
            status: a.status as "proposed" | "confirmed",
            ownerName: a.owner_name,
            dueDate: a.due_date,
            unowned,
          });
        }
      }
      return { mine: mine.slice(0, 10), unownedCount, totalOpen: (data ?? []).length };
    },
  });
}
