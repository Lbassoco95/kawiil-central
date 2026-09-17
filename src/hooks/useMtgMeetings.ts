/**
 * Juntas (Múuch', `mtg_meetings`).
 *
 * Desde la ficha del cliente se ven sus juntas (`client_id = client`) y las de
 * las series de los grupos a los que pertenece.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClientGroupsForClient } from "@/hooks/useClientGroups";
import {
  mtgDb,
  type MtgMeetingInsert,
  type MtgMeetingRow,
} from "@/lib/mtg/db";
import { logMtgAudit, MTG_AUDIT_ACTION } from "@/lib/mtg/audit";

export type MtgMeeting = MtgMeetingRow & {
  /** Acuerdos confirmados / total de la junta. */
  agreementsConfirmed: number;
  agreementsTotal: number;
  /** Minuta aprobada (si existe). */
  approvedMinutesId: string | null;
};

const KEY = (clientId: string | undefined) => ["mtg-meetings", clientId] as const;

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

export function useMtgMeetingsForClient(clientId: string | undefined) {
  const { user } = useAuth();
  const { data: groups = [] } = useClientGroupsForClient(clientId);
  const groupIds = groups.map((g) => g.id);
  const groupKey = groupIds.slice().sort().join(",");

  return useQuery<MtgMeeting[]>({
    queryKey: [...KEY(clientId), groupKey],
    enabled: !!user && !!clientId,
    queryFn: async () => {
      // Series de grupo del cliente, para incluir sus juntas.
      let groupSeriesIds: string[] = [];
      if (groupIds.length > 0) {
        const { data: series, error: sErr } = await mtgDb
          .from("mtg_series")
          .select("id")
          .eq("anchor_type", "group")
          .in("anchor_id", groupIds);
        if (sErr) throw sErr;
        groupSeriesIds = (series ?? []).map((s) => s.id);
      }

      const { data, error } = await mtgDb
        .from("mtg_meetings")
        .select("*")
        .or(
          [
            `client_id.eq.${clientId}`,
            ...(groupSeriesIds.length > 0
              ? [`series_id.in.(${groupSeriesIds.join(",")})`]
              : []),
          ].join(",")
        )
        .order("scheduled_at", { ascending: false });
      if (error) throw error;
      const meetings = (data ?? []) as MtgMeetingRow[];
      const meetingIds = meetings.map((m) => m.id);
      if (meetingIds.length === 0) return [];

      // Conteo de acuerdos confirmados/total por junta.
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

      // Minuta aprobada por junta.
      const { data: minutes, error: mErr } = await mtgDb
        .from("mtg_minutes")
        .select("id, meeting_id")
        .in("meeting_id", meetingIds)
        .eq("status", "approved");
      if (mErr) throw mErr;
      const approvedByMeeting = new Map((minutes ?? []).map((m) => [m.meeting_id, m.id]));

      return meetings.map((m) => ({
        ...m,
        agreementsConfirmed: statsByMeeting.get(m.id)?.confirmed ?? 0,
        agreementsTotal: statsByMeeting.get(m.id)?.total ?? 0,
        approvedMinutesId: approvedByMeeting.get(m.id) ?? null,
      }));
    },
  });
}

export interface AdhocMeetingValues {
  scheduled_at: string;
  duration_min: number | null;
  facilitator_user_id: string | null;
}

/** Junta ad hoc: sin serie, status planned. */
export function useCreateAdhocMeeting(clientId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (values: AdhocMeetingValues) => {
      const orgId = await resolveOrgId(user!.id);
      const row: MtgMeetingInsert = {
        organization_id: orgId,
        series_id: null,
        client_id: clientId,
        scheduled_at: values.scheduled_at,
        duration_min: values.duration_min,
        facilitator_user_id: values.facilitator_user_id,
        created_by: user!.id,
      };
      const { data, error } = await mtgDb.from("mtg_meetings").insert(row).select().single();
      if (error) throw error;
      const meeting = data as MtgMeetingRow;

      await logMtgAudit({
        organizationId: orgId,
        actorUserId: user!.id,
        entityType: "meeting",
        entityId: meeting.id,
        action: MTG_AUDIT_ACTION.MEETING_CREATED,
        snapshot: meeting as unknown as Record<string, unknown>,
      });
      return meeting;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY(clientId) });
    },
  });
}
