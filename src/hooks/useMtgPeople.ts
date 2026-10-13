import { useQuery } from "@tanstack/react-query";
import { mtgDb, type MtgMeetingPersonRow, type MtgPersonRow } from "@/lib/mtg/db";

export type MtgPersonWithHistory = MtgPersonRow & {
  /** Nº de juntas en las que ha estado. */
  meetingsCount: number;
  /** Nota de esta junta (si está vinculada). */
  meetingNote: string | null;
  linked: boolean;
};

/**
 * Personas de una junta + memoria de las empresas de la junta.
 * Si las tablas aún no existen (migración pendiente) devuelve listas vacías.
 */
export function useMtgPeople(meetingId: string | undefined, clientIds: string[]) {
  const key = clientIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["mtg-people", meetingId, key],
    enabled: !!meetingId,
    queryFn: async (): Promise<MtgPersonWithHistory[]> => {
      const { data: links, error: lErr } = await mtgDb
        .from("mtg_meeting_people")
        .select("*")
        .eq("meeting_id", meetingId!);
      if (lErr) return [];
      const linkRows = (links ?? []) as MtgMeetingPersonRow[];
      const linkedIds = linkRows.map((l) => l.person_id);

      const people = new Map<string, MtgPersonRow>();
      if (clientIds.length > 0) {
        const { data } = await mtgDb.from("mtg_people").select("*").in("client_id", clientIds);
        for (const p of (data ?? []) as MtgPersonRow[]) people.set(p.id, p);
      }
      if (linkedIds.length > 0) {
        const { data } = await mtgDb.from("mtg_people").select("*").in("id", linkedIds);
        for (const p of (data ?? []) as MtgPersonRow[]) people.set(p.id, p);
      }
      const ids = [...people.keys()];
      const counts = new Map<string, number>();
      if (ids.length > 0) {
        const { data } = await mtgDb.from("mtg_meeting_people").select("person_id").in("person_id", ids);
        for (const r of (data ?? []) as { person_id: string }[]) {
          counts.set(r.person_id, (counts.get(r.person_id) ?? 0) + 1);
        }
      }
      const noteByPerson = new Map(linkRows.map((l) => [l.person_id, l.note]));
      return [...people.values()]
        .map((p) => ({
          ...p,
          meetingsCount: counts.get(p.id) ?? 0,
          meetingNote: noteByPerson.get(p.id) ?? null,
          linked: noteByPerson.has(p.id),
        }))
        .sort((a, b) => Number(b.linked) - Number(a.linked) || a.name.localeCompare(b.name));
    },
  });
}
