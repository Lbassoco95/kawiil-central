/**
 * Subida manual de transcripción → bucket mtg + audit + encolar generate_minutes.
 */

import { supabase } from "@/integrations/supabase/client";
import { mtgDb, type MtgMeetingRow, type MtgSeriesRow } from "@/lib/mtg/db";
import { logMtgAudit, MTG_AUDIT_ACTION } from "@/lib/mtg/audit";
import { buildMtgStoragePath, MTG_BUCKET } from "@/lib/mtg/storagePaths";
import {
  canManualUploadTranscript,
  fileToTranscriptPlainText,
} from "@/lib/mtg/transcriptParse";

export async function uploadManualTranscript(opts: {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
  series: MtgSeriesRow | null;
  file: File;
}): Promise<{ path: string }> {
  if (!canManualUploadTranscript(opts.meeting.status)) {
    throw new Error(`No se puede subir transcripción en estado ${opts.meeting.status}`);
  }

  const parsed = await fileToTranscriptPlainText(opts.file);
  if (!parsed.text.trim()) throw new Error("El archivo no tiene texto usable");

  const anchorType = opts.series?.anchor_type ?? "client";
  const anchorId =
    opts.series?.anchor_id ?? opts.meeting.client_id ?? opts.organizationId;

  const path = buildMtgStoragePath({
    organizationId: opts.organizationId,
    anchorType,
    anchorId,
    kind: "transcripts",
    fileName: `transcript-manual.${parsed.uploadExt}`,
  });

  const blob = new Blob([parsed.text], {
    type: parsed.uploadExt === "vtt" ? "text/vtt" : "text/plain",
  });
  const { error: upErr } = await supabase.storage
    .from(MTG_BUCKET)
    .upload(path, blob, { upsert: true, contentType: blob.type });
  if (upErr) throw upErr;

  const { error: mErr } = await mtgDb
    .from("mtg_meetings")
    .update({
      transcript_status: "received",
      transcript_path: path,
      transcript_unavailable_reason: null,
    })
    .eq("id", opts.meeting.id);
  if (mErr) throw mErr;

  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "meeting",
    entityId: opts.meeting.id,
    action: MTG_AUDIT_ACTION.TRANSCRIPT_RECEIVED,
    details: {
      origin: "manual_upload",
      path,
      source_kind: parsed.kind,
      file_name: opts.file.name,
    },
  });

  try {
    await supabase.from("job_queue" as never).insert({
      organization_id: opts.organizationId,
      kind: "mtg.generate_minutes",
      payload: { meeting_id: opts.meeting.id, origin: "manual_upload" },
      status: "pending",
    } as never);
  } catch (e) {
    console.warn("[mtg] enqueue generate_minutes", e);
  }

  return { path };
}
