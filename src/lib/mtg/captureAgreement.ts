/**
 * Captura de acuerdos en vivo → opcionalmente crea tarea en projects.area.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  mtgDb,
  type MtgAgreementInsert,
  type MtgAgreementRow,
} from "@/lib/mtg/db";
import { logMtgAudit, MTG_AUDIT_ACTION } from "@/lib/mtg/audit";
import { shouldCreateTask } from "@/lib/mtg/prepareBoard";

export interface CaptureAgreementInput {
  organizationId: string;
  actorUserId: string;
  meetingId: string;
  /** Null mientras la junta no tenga cliente asignado. */
  clientId: string | null;
  entityKey?: string | null;
  topicId?: string | null;
  projectId?: string | null;
  text: string;
  ownerSide?: "kawiil" | "client" | "both" | null;
  ownerUserId?: string | null;
  ownerName?: string | null;
  dueDate?: string | null;
  origin?: MtgAgreementRow["origin"];
  /** Si true (default al capturar en vivo), confirma al guardar. */
  confirm?: boolean;
}

export async function createTaskForAgreement(opts: {
  organizationId: string;
  actorUserId: string;
  meetingId: string;
  clientId: string;
  projectId: string;
  title: string;
  dueDate?: string | null;
  assignedTo?: string | null;
  description?: string | null;
}): Promise<string> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      organization_id: opts.organizationId,
      client_id: opts.clientId,
      project_id: opts.projectId,
      mtg_meeting_id: opts.meetingId,
      title: opts.title,
      description: opts.description ?? `Acuerdo de junta ${opts.meetingId}`,
      assigned_to: opts.assignedTo ?? null,
      due_date: opts.dueDate ?? null,
      status: "pendiente",
      priority: "media",
      created_by: opts.actorUserId,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function captureAgreement(input: CaptureAgreementInput): Promise<MtgAgreementRow> {
  const confirm = input.confirm !== false;
  const status = confirm ? "confirmed" : "proposed";
  const withProject = !!input.projectId;

  let taskId: string | null = null;
  if (
    shouldCreateTask({
      status,
      projectId: input.projectId,
      clientId: input.clientId,
    })
  ) {
    taskId = await createTaskForAgreement({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      meetingId: input.meetingId,
      clientId: input.clientId!,
      projectId: input.projectId!,
      title: input.text.slice(0, 200),
      dueDate: input.dueDate,
      assignedTo: input.ownerSide === "client" ? null : input.ownerUserId ?? null,
    });
  }

  const row: MtgAgreementInsert = {
    organization_id: input.organizationId,
    meeting_id: input.meetingId,
    client_id: input.clientId,
    entity_key: input.entityKey ?? null,
    topic_id: input.topicId ?? null,
    project_id: input.projectId ?? null,
    text: input.text.trim(),
    owner_side: input.ownerSide ?? null,
    owner_user_id: input.ownerUserId ?? null,
    owner_name: input.ownerName ?? null,
    due_date: input.dueDate ?? null,
    origin: input.origin ?? "captured_live",
    status,
    confirmed_by: confirm ? input.actorUserId : null,
    confirmed_at: confirm ? new Date().toISOString() : null,
    task_id: taskId,
    created_by: input.actorUserId,
  };

  const { data, error } = await mtgDb.from("mtg_agreements").insert(row).select("*").single();
  if (error) throw error;

  await logMtgAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "agreement",
    entityId: data.id,
    action: confirm ? MTG_AUDIT_ACTION.AGREEMENT_CAPTURED : MTG_AUDIT_ACTION.AGREEMENT_CAPTURED,
    details: {
      meeting_id: input.meetingId,
      project_id: input.projectId ?? null,
      task_id: taskId,
      amber: confirm && !withProject,
    },
  });

  return data as MtgAgreementRow;
}

/** Asigna proyecto a un acuerdo ámbar y crea la tarea. */
export async function assignProjectAndCreateTask(opts: {
  organizationId: string;
  actorUserId: string;
  agreement: MtgAgreementRow;
  projectId: string;
}): Promise<MtgAgreementRow> {
  const a = opts.agreement;
  if (a.status !== "confirmed") throw new Error("Sólo acuerdos confirmados");
  if (a.task_id) throw new Error("Ya tiene tarea");

  if (!a.client_id) throw new Error("Asigna un cliente a la junta antes de crear la tarea");

  const taskId = await createTaskForAgreement({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    meetingId: a.meeting_id,
    clientId: a.client_id,
    projectId: opts.projectId,
    title: a.text.slice(0, 200),
    dueDate: a.due_date,
    assignedTo: a.owner_user_id,
  });

  const { data, error } = await mtgDb
    .from("mtg_agreements")
    .update({ project_id: opts.projectId, task_id: taskId })
    .eq("id", a.id)
    .select("*")
    .single();
  if (error) throw error;

  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "agreement",
    entityId: a.id,
    action: MTG_AUDIT_ACTION.AGREEMENT_CONFIRMED,
    details: { project_id: opts.projectId, task_id: taskId },
  });

  return data as MtgAgreementRow;
}
