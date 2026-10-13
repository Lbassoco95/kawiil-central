import { useQuery } from "@tanstack/react-query";
import { mtgDb, type MtgMeetingRecordingRow } from "@/lib/mtg/db";

/** Tomas grabadas de una junta (más antigua primero). */
export function useMtgRecordings(meetingId: string | undefined, refreshKey?: string | null) {
  return useQuery({
    queryKey: ["mtg-recordings", meetingId, refreshKey ?? null],
    enabled: !!meetingId,
    queryFn: async (): Promise<MtgMeetingRecordingRow[]> => {
      const { data, error } = await mtgDb
        .from("mtg_meeting_recordings")
        .select("*")
        .eq("meeting_id", meetingId!)
        .order("saved_at", { ascending: true });
      if (error) return []; // tabla aún no migrada → sin lista
      return (data ?? []) as MtgMeetingRecordingRow[];
    },
  });
}
