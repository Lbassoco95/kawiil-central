/**
 * Series de juntas (Múuch', `mtg_series`).
 *
 * Una serie se ancla a un cliente o a un grupo. Desde la ficha del cliente se
 * ven las suyas (`anchor_type='client'`, `anchor_id=client`) y las de los
 * grupos a los que pertenece (`anchor_type='group'`, marcadas isGroupSeries).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClientGroupsForClient } from "@/hooks/useClientGroups";
import {
  mtgDb,
  type MtgAgendaBlock,
  type MtgAttendeeClient,
  type MtgEntity,
  type MtgSeriesInsert,
  type MtgSeriesRow,
} from "@/lib/mtg/db";
import { DEFAULT_AGENDA_TEMPLATE, type MtgCadence } from "@/lib/mtg/constants";
import { logMtgAudit, MTG_AUDIT_ACTION } from "@/lib/mtg/audit";

export type MtgSeries = MtgSeriesRow & {
  /** true si la serie está anclada a un grupo del cliente (solo lectura en la ficha). */
  isGroupSeries: boolean;
  /** Nombre del grupo, si aplica. */
  groupName?: string;
};

const KEY = (clientId: string | undefined) => ["mtg-series", clientId] as const;

export interface MtgSeriesFormValues {
  title: string;
  cadence: MtgCadence;
  default_duration_min: number;
  starts_at: string | null;
  owner_user_id: string | null;
  attendees_internal: string[];
  attendees_client: MtgAttendeeClient[];
  entities: MtgEntity[];
  agenda_template: MtgAgendaBlock[];
  send_minutes_to_client: boolean;
  /** El usuario confirmó que el cliente fue informado de la transcripción. */
  transcript_notice_confirmed: boolean;
  auto_transcript: boolean;
}

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

/** Entidades del grupo para series 'group': [{key, label, client_id}]. */
async function entitiesFromGroup(groupId: string): Promise<MtgEntity[]> {
  // client_group_members aún no está en types.ts; cliente genérico, mismo
  // motivo que mtgDb pero para una tabla existente no tipada.
  const genericDb = supabase as unknown as SupabaseClient;
  const { data: members, error } = await genericDb
    .from("client_group_members")
    .select("client_id")
    .eq("group_id", groupId);
  if (error) throw error;
  const clientIds = ((members ?? []) as { client_id: string }[]).map((m) => m.client_id);
  if (clientIds.length === 0) return [];

  const { data: clients, error: cErr } = await supabase
    .from("clients")
    .select("id, name")
    .in("id", clientIds);
  if (cErr) throw cErr;

  return (clients ?? []).map((c) => ({
    key: c.name
      .toLowerCase()
      .normalize("NFD")
      // Tras NFD los diacríticos quedan como caracteres combinantes.
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24),
    label: c.name,
    client_id: c.id,
  }));
}

export function useMtgSeriesForClient(clientId: string | undefined) {
  const { user } = useAuth();
  const { data: groups = [] } = useClientGroupsForClient(clientId);
  const groupIds = groups.map((g) => g.id);
  const groupKey = groupIds.slice().sort().join(",");

  return useQuery<MtgSeries[]>({
    queryKey: [...KEY(clientId), groupKey],
    enabled: !!user && !!clientId,
    queryFn: async () => {
      const { data, error } = await mtgDb
        .from("mtg_series")
        .select("*")
        .eq("active", true)
        .or(
          [
            `and(anchor_type.eq.client,anchor_id.eq.${clientId})`,
            ...(groupIds.length > 0
              ? [`and(anchor_type.eq.group,anchor_id.in.(${groupIds.join(",")}))`]
              : []),
          ].join(",")
        )
        .order("created_at", { ascending: true });
      if (error) throw error;

      const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
      return (data ?? []).map((s) => ({
        ...(s as MtgSeriesRow),
        isGroupSeries: s.anchor_type === "group",
        groupName: s.anchor_type === "group" ? groupNameById.get(s.anchor_id) : undefined,
      }));
    },
  });
}

async function generateInstancesIfNeeded(series: MtgSeriesRow) {
  if (series.cadence === "adhoc" || !series.starts_at) return;
  const { error } = await mtgDb.rpc("mtg_generate_series_meetings", {
    _series_id: series.id,
    _count: 8,
  });
  if (error) throw error;
}

function transcriptNoticeFields(
  values: MtgSeriesFormValues,
  userId: string,
  alreadyConfirmedAt: string | null
) {
  // Solo se sella una vez: si ya había constancia, no se repisa.
  if (!values.transcript_notice_confirmed || alreadyConfirmedAt) {
    return {
      transcript_notice_confirmed_at: alreadyConfirmedAt,
      transcript_notice_confirmed_by: alreadyConfirmedAt ? undefined : null,
    };
  }
  return {
    transcript_notice_confirmed_at: new Date().toISOString(),
    transcript_notice_confirmed_by: userId,
  };
}

export function useCreateMtgSeries(clientId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      values,
      anchor,
    }: {
      values: MtgSeriesFormValues;
      /** Por defecto la ficha del cliente; 'group' con groupId para series de grupo. */
      anchor?: { type: "client" | "group"; groupId?: string };
    }) => {
      const orgId = await resolveOrgId(user!.id);
      const anchorType = anchor?.type ?? "client";
      const anchorId = anchorType === "group" ? anchor!.groupId! : clientId;

      let entities = values.entities;
      if (anchorType === "group" && entities.length === 0) {
        entities = await entitiesFromGroup(anchorId);
      }

      const notice = transcriptNoticeFields(values, user!.id, null);
      const row: MtgSeriesInsert = {
        organization_id: orgId,
        anchor_type: anchorType,
        anchor_id: anchorId,
        client_id: anchorType === "client" ? clientId : null,
        title: values.title.trim(),
        cadence: values.cadence,
        default_duration_min: values.default_duration_min,
        starts_at: values.starts_at,
        owner_user_id: values.owner_user_id,
        attendees_internal: values.attendees_internal,
        attendees_client: values.attendees_client,
        entities,
        agenda_template:
          values.agenda_template.length > 0 ? values.agenda_template : DEFAULT_AGENDA_TEMPLATE,
        send_minutes_to_client: values.send_minutes_to_client,
        auto_transcript: values.auto_transcript && !!notice.transcript_notice_confirmed_at,
        transcript_notice_confirmed_at: notice.transcript_notice_confirmed_at,
        transcript_notice_confirmed_by: notice.transcript_notice_confirmed_by ?? null,
        created_by: user!.id,
      };

      const { data, error } = await mtgDb.from("mtg_series").insert(row).select().single();
      if (error) throw error;
      const series = data as MtgSeriesRow;

      await generateInstancesIfNeeded(series);

      await logMtgAudit({
        organizationId: orgId,
        actorUserId: user!.id,
        entityType: "series",
        entityId: series.id,
        action: MTG_AUDIT_ACTION.SERIES_CREATED,
        snapshot: series as unknown as Record<string, unknown>,
      });
      if (notice.transcript_notice_confirmed_at) {
        await logMtgAudit({
          organizationId: orgId,
          actorUserId: user!.id,
          entityType: "series",
          entityId: series.id,
          action: MTG_AUDIT_ACTION.TRANSCRIPT_NOTICE_CONFIRMED,
          details: { confirmed_at: notice.transcript_notice_confirmed_at },
        });
      }
      return series;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY(clientId) });
      queryClient.invalidateQueries({ queryKey: ["mtg-meetings", clientId] });
    },
  });
}

export function useUpdateMtgSeries(clientId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      series,
      values,
    }: {
      series: MtgSeries;
      values: MtgSeriesFormValues;
    }) => {
      const notice = transcriptNoticeFields(
        values,
        user!.id,
        series.transcript_notice_confirmed_at
      );
      const noticeJustConfirmed =
        values.transcript_notice_confirmed && !series.transcript_notice_confirmed_at;

      const { data, error } = await mtgDb
        .from("mtg_series")
        .update({
          title: values.title.trim(),
          cadence: values.cadence,
          default_duration_min: values.default_duration_min,
          starts_at: values.starts_at,
          owner_user_id: values.owner_user_id,
          attendees_internal: values.attendees_internal,
          attendees_client: values.attendees_client,
          entities: values.entities,
          agenda_template: values.agenda_template,
          send_minutes_to_client: values.send_minutes_to_client,
          auto_transcript: values.auto_transcript && !!notice.transcript_notice_confirmed_at,
          transcript_notice_confirmed_at: notice.transcript_notice_confirmed_at,
          ...(notice.transcript_notice_confirmed_by
            ? { transcript_notice_confirmed_by: notice.transcript_notice_confirmed_by }
            : {}),
        })
        .eq("id", series.id)
        .select()
        .single();
      if (error) throw error;
      const updated = data as MtgSeriesRow;

      await generateInstancesIfNeeded(updated);

      await logMtgAudit({
        organizationId: series.organization_id,
        actorUserId: user!.id,
        entityType: "series",
        entityId: series.id,
        action: MTG_AUDIT_ACTION.SERIES_UPDATED,
        snapshot: updated as unknown as Record<string, unknown>,
      });
      if (noticeJustConfirmed) {
        await logMtgAudit({
          organizationId: series.organization_id,
          actorUserId: user!.id,
          entityType: "series",
          entityId: series.id,
          action: MTG_AUDIT_ACTION.TRANSCRIPT_NOTICE_CONFIRMED,
          details: { confirmed_at: notice.transcript_notice_confirmed_at },
        });
      }
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY(clientId) });
      queryClient.invalidateQueries({ queryKey: ["mtg-meetings", clientId] });
    },
  });
}
