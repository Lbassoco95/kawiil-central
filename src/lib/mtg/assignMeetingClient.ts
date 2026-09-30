/**
 * Asignar / migrar una junta (sin cliente o con otro) a un cliente.
 *
 * - mode `meeting`: la junta + acuerdos + tareas ligadas pasan al cliente (contexto completo).
 * - mode `tasks_only`: solo las tareas creadas desde la junta (y sus acuerdos) reciben client_id;
 *   la junta puede quedar sin cliente o también recibir el client_id si `alsoSetMeeting` (default true
 *   para no dejar huérfanas las tareas respecto del tablero).
 */

import { supabase } from "@/integrations/supabase/client";
import { mtgDb, type MtgMeetingRow } from "@/lib/mtg/db";
import { logMtgAudit, MTG_AUDIT_ACTION } from "@/lib/mtg/audit";

export type AssignMeetingClientMode = "meeting" | "tasks_only";

export async function assignMeetingClient(opts: {
  organizationId: string;
  actorUserId: string;
  meetingId: string;
  clientId: string;
  mode: AssignMeetingClientMode;
}): Promise<MtgMeetingRow> {
  const clientId = opts.clientId.trim();
  if (!clientId) throw new Error("Elige un cliente");

  const { data: meeting, error: mErr } = await mtgDb
    .from("mtg_meetings")
    .select("*")
    .eq("id", opts.meetingId)
    .single();
  if (mErr || !meeting) throw mErr ?? new Error("Junta no encontrada");

  const setMeetingClient = opts.mode === "meeting" || opts.mode === "tasks_only";
  // En ambos modos dejamos la junta apuntando al cliente para conservar contexto
  // en el hub y en el tablero; en tasks_only el mensaje de UX aclara que el
  // foco operativo son las tareas/seguimientos.
  if (setMeetingClient) {
    const { error } = await mtgDb
      .from("mtg_meetings")
      .update({ client_id: clientId })
      .eq("id", opts.meetingId);
    if (error) throw error;
  }

  const { data: agreements, error: aErr } = await mtgDb
    .from("mtg_agreements")
    .select("id, task_id, client_id")
    .eq("meeting_id", opts.meetingId);
  if (aErr) throw aErr;

  const agreementIds = (agreements ?? []).map((a) => a.id);
  if (agreementIds.length > 0) {
    const { error } = await mtgDb
      .from("mtg_agreements")
      .update({ client_id: clientId })
      .in("id", agreementIds);
    if (error) throw error;
  }

  const taskIds = [...new Set((agreements ?? []).map((a) => a.task_id).filter(Boolean))] as string[];
  // También tareas ligadas por mtg_meeting_id (por si se crearon fuera de agreements).
  const { data: linkedTasks } = await supabase
    .from("tasks")
    .select("id")
    .eq("mtg_meeting_id", opts.meetingId);
  for (const t of linkedTasks ?? []) {
    if (t.id && !taskIds.includes(t.id)) taskIds.push(t.id);
  }

  if (taskIds.length > 0) {
    const { error } = await supabase
      .from("tasks")
      .update({ client_id: clientId })
      .in("id", taskIds);
    if (error) throw error;
  }

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
      mode: opts.mode,
      client_id: clientId,
      previous_client_id: meeting.client_id,
      agreements_updated: agreementIds.length,
      tasks_updated: taskIds.length,
    },
  });

  return updated as MtgMeetingRow;
}
