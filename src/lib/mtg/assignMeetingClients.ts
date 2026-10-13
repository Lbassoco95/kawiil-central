/**
 * Asignar varios clientes a una junta (serie de grupo multi-empresa).
 * Si la junta ya tiene serie, actualiza sus entities; si no, crea una serie ad hoc
 * propia (nunca la mezcla con otra serie existente).
 */

import { supabase } from "@/integrations/supabase/client";
import { mtgDb, type MtgEntity, type MtgMeetingRow, type MtgSeriesRow } from "@/lib/mtg/db";
import { logMtgAudit, MTG_AUDIT_ACTION } from "@/lib/mtg/audit";

function entityKeyFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

export async function buildEntitiesFromClientIds(clientIds: string[]): Promise<MtgEntity[]> {
  const unique = [...new Set(clientIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) throw new Error("Elige al menos un cliente");
  const { data, error } = await supabase.from("clients").select("id, name").in("id", unique);
  if (error) throw error;
  const byId = new Map((data ?? []).map((c) => [c.id, c.name]));
  return unique.map((id) => {
    const name = byId.get(id);
    if (!name) throw new Error(`Cliente no encontrado: ${id}`);
    return { key: entityKeyFromName(name), label: name, client_id: id };
  });
}

/**
 * Vincula la junta a una serie de grupo con N clientes (entities).
 * - Si la junta ya tiene series group: actualiza entities.
 * - Si no: busca serie group activa que contenga al menos uno de los clientes;
 *   si no hay, crea serie adhoc group anclada al primer grupo de clientes o falla
 *   pidiendo crear grupo (aquí: crea serie anchor_type=client del primero + entities).
 */
export async function assignMeetingClients(opts: {
  organizationId: string;
  actorUserId: string;
  meetingId: string;
  clientIds: string[];
  /** Cliente “primario” para ficha/hub; default = primero. */
  primaryClientId?: string;
}): Promise<{ meeting: MtgMeetingRow; series: MtgSeriesRow; entities: MtgEntity[] }> {
  const entities = await buildEntitiesFromClientIds(opts.clientIds);
  const primary =
    opts.primaryClientId && entities.some((e) => e.client_id === opts.primaryClientId)
      ? opts.primaryClientId
      : entities[0].client_id;

  const { data: meeting, error: mErr } = await mtgDb
    .from("mtg_meetings")
    .select("*")
    .eq("id", opts.meetingId)
    .single();
  if (mErr || !meeting) throw mErr ?? new Error("Junta no encontrada");

  let series: MtgSeriesRow | null = null;
  if (meeting.series_id) {
    const { data: s, error } = await mtgDb
      .from("mtg_series")
      .select("*")
      .eq("id", meeting.series_id)
      .single();
    if (error) throw error;
    series = s as MtgSeriesRow;
    const { error: uErr } = await mtgDb
      .from("mtg_series")
      .update({ entities })
      .eq("id", series.id);
    if (uErr) throw uErr;
    series = { ...series, entities };
  } else {
    // Una junta sin serie NUNCA se pega a una serie existente (otra cadencia u otra
    // empresa): se crea una serie propia ad hoc con las empresas elegidas.
    // Serie ad hoc multi-cliente anclada al cliente primario (entities = N)
    const { data: created, error: cErr } = await mtgDb
      .from("mtg_series")
      .insert({
        organization_id: opts.organizationId,
        anchor_type: "client",
        anchor_id: primary,
        client_id: primary,
        title: (meeting.title?.trim() || `Junta multi-cliente · ${entities.map((e) => e.label).join(" · ")}`).slice(0, 120),
        cadence: "adhoc",
        default_duration_min: meeting.duration_min ?? 60,
        entities,
        agenda_template: [],
        attendees_internal: [],
        attendees_client: [],
        send_minutes_to_client: false,
        auto_transcript: false,
        active: true,
        created_by: opts.actorUserId,
      })
      .select("*")
      .single();
    if (cErr || !created) throw cErr ?? new Error("No se pudo crear la serie");
    series = created as MtgSeriesRow;

    // Vincular junta (puede fallar uq_series_day si ya hay otra ese día)
    const { error: linkErr } = await mtgDb
      .from("mtg_meetings")
      .update({ series_id: series.id, client_id: primary })
      .eq("id", opts.meetingId);
    if (linkErr) {
      const msg = linkErr.message || "";
      if (msg.includes("uq_mtg_meetings_series_day") || msg.includes("duplicate")) {
        throw new Error(
          "Ya hay un tablero de esa serie este día. Ábrelo desde Juntas (plantilla con los temas del grupo).",
        );
      }
      throw linkErr;
    }
  }

  const { error: mcErr } = await mtgDb
    .from("mtg_meetings")
    .update({ client_id: primary })
    .eq("id", opts.meetingId);
  if (mcErr) throw mcErr;

  const { data: updated, error: uErr } = await mtgDb
    .from("mtg_meetings")
    .select("*")
    .eq("id", opts.meetingId)
    .single();
  if (uErr || !updated) throw uErr ?? new Error("No se pudo recargar la junta");

  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "meeting",
    entityId: opts.meetingId,
    action: MTG_AUDIT_ACTION.MEETING_CLIENT_ASSIGNED,
    details: {
      mode: "multi_client",
      client_ids: entities.map((e) => e.client_id),
      primary_client_id: primary,
      series_id: series.id,
      entity_keys: entities.map((e) => e.key),
    },
  });

  return {
    meeting: updated as MtgMeetingRow,
    series,
    entities: series.entities ?? entities,
  };
}
