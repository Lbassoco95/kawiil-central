/**
 * Confirmar / rechazar acuerdos propuestos y aprobar minuta (B4).
 */

import { supabase } from "@/integrations/supabase/client";
import { mtgDb, type MtgAgreementRow, type MtgMeetingRow, type MtgMinutesRow, type MtgSeriesRow } from "@/lib/mtg/db";
import { logMtgAudit, MTG_AUDIT_ACTION } from "@/lib/mtg/audit";
import { createTaskForAgreement } from "@/lib/mtg/captureAgreement";
import { confirmRequires, parseTopicsFromMarkdown } from "@/lib/mtg/minutesReview";
import { buildMtgStoragePath, MTG_BUCKET } from "@/lib/mtg/storagePaths";

export async function confirmProposedAgreement(opts: {
  organizationId: string;
  actorUserId: string;
  agreement: MtgAgreementRow;
  projectId: string;
  dueDate: string;
  ownerUserId?: string | null;
  ownerName?: string | null;
  ownerSide?: "kawiil" | "client" | "both" | null;
}): Promise<MtgAgreementRow> {
  const req = confirmRequires({
    projectId: opts.projectId,
    dueDate: opts.dueDate,
    ownerUserId: opts.ownerUserId,
    ownerName: opts.ownerName,
  });
  if (!req.ok) throw new Error(req.reason);
  if (!opts.agreement.client_id) {
    throw new Error("Asigna un cliente a la junta antes de confirmar acuerdos → tareas");
  }

  const taskId = await createTaskForAgreement({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    meetingId: opts.agreement.meeting_id,
    clientId: opts.agreement.client_id,
    projectId: opts.projectId,
    title: opts.agreement.text.slice(0, 200),
    dueDate: opts.dueDate,
    assignedTo: opts.ownerUserId ?? null,
  });

  const { data, error } = await mtgDb
    .from("mtg_agreements")
    .update({
      status: "confirmed",
      project_id: opts.projectId,
      due_date: opts.dueDate,
      owner_user_id: opts.ownerUserId ?? null,
      owner_name: opts.ownerName ?? null,
      owner_side: opts.ownerSide ?? opts.agreement.owner_side,
      task_id: taskId,
      confirmed_by: opts.actorUserId,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", opts.agreement.id)
    .select("*")
    .single();
  if (error) throw error;

  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "agreement",
    entityId: opts.agreement.id,
    action: MTG_AUDIT_ACTION.AGREEMENT_CONFIRMED,
    details: { task_id: taskId, project_id: opts.projectId },
  });

  return data as MtgAgreementRow;
}

export async function rejectProposedAgreement(opts: {
  organizationId: string;
  actorUserId: string;
  agreementId: string;
  reason: string;
}): Promise<void> {
  const { error } = await mtgDb
    .from("mtg_agreements")
    .update({
      status: "rejected",
      rejected_reason: opts.reason.trim(),
    })
    .eq("id", opts.agreementId);
  if (error) throw error;

  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "agreement",
    entityId: opts.agreementId,
    action: MTG_AUDIT_ACTION.AGREEMENT_REJECTED,
    details: { reason: opts.reason },
  });
}

export async function approveMinutes(opts: {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
  series: MtgSeriesRow | null;
  minutes: MtgMinutesRow;
  contentMd: string;
}): Promise<{ documentId: string; path: string }> {
  const title = `Minuta — ${opts.series?.title ?? "Junta"} — ${opts.meeting.scheduled_at.slice(0, 10)}`;

  const { data: render, error: rErr } = await supabase.functions.invoke("render-ai-document", {
    body: {
      title,
      template_key: "minuta_reunion",
      requested_formats: ["pdf"],
      primary_format: "pdf",
      preview_markdown: opts.contentMd.slice(0, 4000),
      content: {
        topics: [{ title: "Resumen", discussion: opts.contentMd.slice(0, 8000) }],
        agreements: [],
        action_items: [],
      },
    },
  });
  if (rErr) throw rErr;

  // render-ai-document suele subir a storage y devolver paths; fallback: markdown como .md
  let path: string | null =
    render?.outputs?.find?.((o: { format?: string }) => o.format === "pdf")?.storage_path ??
    render?.primary?.storage_path ??
    null;
  let bucket = render?.outputs?.[0]?.storage_bucket ?? MTG_BUCKET;

  const anchorType = opts.series?.anchor_type ?? "client";
  const anchorId = opts.series?.anchor_id ?? opts.meeting.client_id ?? opts.organizationId;

  if (!path) {
    path = buildMtgStoragePath({
      organizationId: opts.organizationId,
      anchorType,
      anchorId,
      kind: "minutes",
      fileName: `minuta-${opts.meeting.id.slice(0, 8)}.md`,
    });
    const { error: upErr } = await supabase.storage
      .from(MTG_BUCKET)
      .upload(path, new Blob([opts.contentMd], { type: "text/markdown" }), { upsert: true });
    if (upErr) throw upErr;
    bucket = MTG_BUCKET;
  } else if (bucket !== MTG_BUCKET) {
    // Copiar a bucket mtg si el render dejó el PDF en otro bucket
    const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(path);
    if (!dlErr && blob) {
      const mtgPath = buildMtgStoragePath({
        organizationId: opts.organizationId,
        anchorType,
        anchorId,
        kind: "minutes",
        fileName: `minuta-${opts.meeting.id.slice(0, 8)}.pdf`,
      });
      await supabase.storage.from(MTG_BUCKET).upload(mtgPath, blob, { upsert: true, contentType: "application/pdf" });
      path = mtgPath;
      bucket = MTG_BUCKET;
    }
  }

  const meta: Record<string, unknown> = {
    bucket,
    meeting_id: opts.meeting.id,
  };
  if (opts.series?.anchor_type === "group") {
    meta.client_group_id = opts.series.anchor_id;
  }

  const { data: doc, error: dErr } = await supabase
    .from("documents")
    .insert({
      organization_id: opts.organizationId,
      name: title,
      source: "supabase",
      file_path: path,
      mime_type: path.endsWith(".pdf") ? "application/pdf" : "text/markdown",
      document_type: "minuta",
      client_id: opts.meeting.client_id,
      client_group_id: opts.series?.anchor_type === "group" ? opts.series.anchor_id : null,
      uploaded_by: opts.actorUserId,
      metadata: meta,
    } as never)
    .select("id")
    .single();
  if (dErr) throw dErr;

  // Referencias en miembros del grupo con acuerdos
  if (opts.series?.anchor_type === "group") {
    const { data: agreements } = await mtgDb
      .from("mtg_agreements")
      .select("client_id")
      .eq("meeting_id", opts.meeting.id)
      .eq("status", "confirmed");
    const clientIds = [...new Set((agreements ?? []).map((a) => a.client_id).filter(Boolean))];
    for (const cid of clientIds) {
      await supabase.from("documents").insert({
        organization_id: opts.organizationId,
        name: `${title} (ref)`,
        source: "supabase",
        file_path: path,
        mime_type: path.endsWith(".pdf") ? "application/pdf" : "text/markdown",
        document_type: "minuta",
        client_id: cid,
        uploaded_by: opts.actorUserId,
        metadata: {
          bucket,
          meeting_id: opts.meeting.id,
          reference_of_document_id: doc.id,
          label: "minuta del grupo",
        },
      } as never);
    }
  }

  await mtgDb
    .from("mtg_minutes")
    .update({ status: "superseded" })
    .eq("meeting_id", opts.meeting.id)
    .eq("status", "approved");

  await mtgDb
    .from("mtg_minutes")
    .update({
      status: "approved",
      content_md: opts.contentMd,
      approved_by: opts.actorUserId,
      approved_at: new Date().toISOString(),
      document_id: doc.id,
      document_path: path,
    })
    .eq("id", opts.minutes.id);

  await mtgDb
    .from("mtg_meetings")
    .update({ status: "minutes_approved", minutes_id: opts.minutes.id })
    .eq("id", opts.meeting.id);

  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "minutes",
    entityId: opts.minutes.id,
    action: MTG_AUDIT_ACTION.MINUTES_APPROVED,
    details: { document_id: doc.id, path },
  });

  // Slack si hay canal (nunca minuta completa ni transcripción)
  if (opts.series?.slack_channel_id) {
    try {
      const { data: confirmed } = await mtgDb
        .from("mtg_agreements")
        .select("text, owner_name, owner_user_id, due_date")
        .eq("meeting_id", opts.meeting.id)
        .eq("status", "confirmed");

      const { data: updates } = await mtgDb
        .from("mtg_topic_updates")
        .select("movement")
        .eq("meeting_id", opts.meeting.id);

      const movementCounts: Record<string, number> = {};
      for (const u of updates ?? []) {
        const m = u.movement ?? "unknown";
        movementCounts[m] = (movementCounts[m] ?? 0) + 1;
      }

      const anchorLabel =
        opts.series.anchor_type === "group" ? `grupo ${opts.series.anchor_id}` : "cliente";

      await supabase.functions.invoke("slack-notify", {
        body: {
          event_type: "mtg_minutes_approved",
          data: {
            channel: opts.series.slack_channel_id,
            title: opts.series.title,
            anchor_label: anchorLabel,
            meeting_id: opts.meeting.id,
            scheduled_at: opts.meeting.scheduled_at,
            movement_counts: movementCounts,
            confirmed_agreements: (confirmed ?? []).map((a) => ({
              text: a.text,
              owner: a.owner_name ?? a.owner_user_id ?? "—",
              due_date: a.due_date,
            })),
            link: `/juntas/${opts.meeting.id}/minuta`,
          },
        },
      });
    } catch (e) {
      console.warn("[mtg] slack notify", e);
    }
  }

  return { documentId: doc.id as string, path };
}

export async function closeMeetingAfterMinutes(opts: {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
  series: MtgSeriesRow | null;
  contentMd: string | null;
  sendToClient?: boolean;
  recipients?: string[];
}): Promise<void> {
  if (opts.sendToClient && opts.series?.send_minutes_to_client) {
    // Envío real: Graph app-only — documentado; aquí marca sent
    await mtgDb
      .from("mtg_minutes")
      .update({
        sent_to_client_at: new Date().toISOString(),
        sent_to: opts.recipients ?? opts.series.attendees_client,
      })
      .eq("meeting_id", opts.meeting.id)
      .eq("status", "approved");

    await logMtgAudit({
      organizationId: opts.organizationId,
      actorUserId: opts.actorUserId,
      entityType: "minutes",
      entityId: opts.meeting.minutes_id ?? opts.meeting.id,
      action: MTG_AUDIT_ACTION.MINUTES_SENT,
      details: { recipients: opts.recipients },
    });
  }

  const topics = parseTopicsFromMarkdown(opts.contentMd);
  if (opts.series && topics.length > 0) {
    const { data: next } = await mtgDb
      .from("mtg_meetings")
      .select("id")
      .eq("series_id", opts.series.id)
      .gt("scheduled_at", opts.meeting.scheduled_at)
      .order("scheduled_at", { ascending: true })
      .limit(1);
    const nextId = next?.[0]?.id;
    const defaultClient =
      opts.meeting.client_id || opts.series.entities?.[0]?.client_id || null;
    if (nextId && defaultClient) {
      for (const [i, title] of topics.entries()) {
        const { data: topic, error } = await mtgDb
          .from("mtg_topics")
          .insert({
            organization_id: opts.organizationId,
            series_id: opts.series.id,
            client_id: defaultClient,
            title,
            status: "open",
            created_in_meeting_id: opts.meeting.id,
            created_by: opts.actorUserId,
            sort_order: i,
          })
          .select("id")
          .single();
        if (error || !topic) continue;
        await mtgDb.from("mtg_topic_updates").insert({
          organization_id: opts.organizationId,
          topic_id: topic.id,
          meeting_id: nextId,
          movement: "new",
          origin: "prepared",
        });
      }
    }
  }

  await mtgDb.from("mtg_meetings").update({ status: "closed" }).eq("id", opts.meeting.id);
}
