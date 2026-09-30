/**
 * Listado org-wide de juntas para el hub /juntas.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { mtgDb, type MtgMeetingRow } from "@/lib/mtg/db";

export type OrgMtgMeeting = MtgMeetingRow & {
  seriesTitle: string | null;
  clientName: string | null;
  agreementsConfirmed: number;
  agreementsTotal: number;
  openTasksCount: number;
  approvedMinutesId: string | null;
};

async function resolveOrgId(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  if (!data?.organization_id) throw new Error("Tu usuario no tiene organización asignada.");
  return data.organization_id;
}

export function useMtgMeetingsForOrg(opts?: { limit?: number }) {
  const { user } = useAuth();
  const limit = opts?.limit ?? 100;

  return useQuery<OrgMtgMeeting[]>({
    queryKey: ["mtg-meetings-org", user?.id, limit],
    enabled: !!user,
    queryFn: async () => {
      const orgId = await resolveOrgId(user!.id);

      const { data, error } = await mtgDb
        .from("mtg_meetings")
        .select("*")
        .eq("organization_id", orgId)
        .order("scheduled_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const meetings = (data ?? []) as MtgMeetingRow[];
      if (meetings.length === 0) return [];

      const meetingIds = meetings.map((m) => m.id);
      const seriesIds = [...new Set(meetings.map((m) => m.series_id).filter(Boolean))] as string[];
      const clientIds = [...new Set(meetings.map((m) => m.client_id).filter(Boolean))] as string[];

      const seriesTitleById = new Map<string, string>();
      if (seriesIds.length > 0) {
        const { data: series, error: sErr } = await mtgDb
          .from("mtg_series")
          .select("id, title")
          .in("id", seriesIds);
        if (sErr) throw sErr;
        for (const s of series ?? []) seriesTitleById.set(s.id, s.title);
      }

      const clientNameById = new Map<string, string>();
      if (clientIds.length > 0) {
        const { data: clients, error: cErr } = await supabase
          .from("clients")
          .select("id, name")
          .in("id", clientIds);
        if (cErr) throw cErr;
        for (const c of clients ?? []) clientNameById.set(c.id, c.name);
      }

      const { data: agreements, error: aErr } = await mtgDb
        .from("mtg_agreements")
        .select("meeting_id, status")
        .in("meeting_id", meetingIds);
      if (aErr) throw aErr;
      const statsByMeeting = new Map<string, { total: number; confirmed: number }>();
      for (const a of agreements ?? []) {
        const cur = statsByMeeting.get(a.meeting_id) ?? { total: 0, confirmed: 0 };
        cur.total += 1;
        if (a.status === "confirmed") cur.confirmed += 1;
        statsByMeeting.set(a.meeting_id, cur);
      }

      const { data: minutes, error: mErr } = await mtgDb
        .from("mtg_minutes")
        .select("id, meeting_id")
        .in("meeting_id", meetingIds)
        .eq("status", "approved");
      if (mErr) throw mErr;
      const approvedByMeeting = new Map((minutes ?? []).map((m) => [m.meeting_id, m.id]));

      // mtg_meeting_id existe en DB (migración mtg) pero aún no en types.ts autogenerado.
      const { data: tasks } = await supabase
        .from("tasks")
        .select("id, mtg_meeting_id, status")
        .in("mtg_meeting_id", meetingIds)
        .not("status", "in", '("completada","cancelada")');
      const openTasksByMeeting = new Map<string, number>();
      for (const t of (tasks ?? []) as Array<{ mtg_meeting_id?: string | null }>) {
        if (!t.mtg_meeting_id) continue;
        openTasksByMeeting.set(
          t.mtg_meeting_id,
          (openTasksByMeeting.get(t.mtg_meeting_id) ?? 0) + 1,
        );
      }

      return meetings.map((m) => ({
        ...m,
        seriesTitle: m.series_id ? seriesTitleById.get(m.series_id) ?? null : null,
        clientName: m.client_id ? clientNameById.get(m.client_id) ?? null : null,
        agreementsConfirmed: statsByMeeting.get(m.id)?.confirmed ?? 0,
        agreementsTotal: statsByMeeting.get(m.id)?.total ?? 0,
        openTasksCount: openTasksByMeeting.get(m.id) ?? 0,
        approvedMinutesId: approvedByMeeting.get(m.id) ?? null,
      }));
    },
  });
}
