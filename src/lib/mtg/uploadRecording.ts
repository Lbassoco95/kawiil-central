/**
 * Subida / grabación de audio-video de la junta → bucket mtg (kind recordings).
 * Soporta conversaciones de hasta ~3 horas (ver recordingLimits).
 */

import { supabase } from "@/integrations/supabase/client";
import { mtgDb, type MtgMeetingRow, type MtgSeriesRow } from "@/lib/mtg/db";
import { logMtgAudit, MTG_AUDIT_ACTION } from "@/lib/mtg/audit";
import { buildMtgStoragePath, MTG_BUCKET } from "@/lib/mtg/storagePaths";
import type { MtgMeetingStatus } from "@/lib/mtg/constants";
import {
  formatRecordingSizeMb,
  MTG_MAX_RECORDING_BYTES,
  MTG_MAX_RECORDING_HOURS,
  MTG_WHISPER_MAX_BYTES,
} from "@/lib/mtg/recordingLimits";

const RECORDING_ALLOWED: ReadonlySet<MtgMeetingStatus> = new Set([
  "planned",
  "in_progress",
  "ended",
  "minutes_draft",
  "minutes_review",
]);

const AUDIO_EXT = new Set(["webm", "mp3", "m4a", "ogg", "wav", "mp4", "aac"]);
const VIDEO_EXT = new Set(["webm", "mp4", "mov", "mkv"]);

export function canUploadRecording(status: MtgMeetingStatus): boolean {
  return RECORDING_ALLOWED.has(status);
}

function extFromFile(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  if (fromName && (AUDIO_EXT.has(fromName) || VIDEO_EXT.has(fromName))) return fromName;
  const mime = file.type.toLowerCase();
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a")) return "mp4";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("quicktime")) return "mov";
  if (mime.includes("aac")) return "aac";
  return fromName || "";
}

export function isAllowedRecordingFile(file: File): boolean {
  if (file.type.startsWith("audio/") || file.type.startsWith("video/")) return true;
  const ext = extFromFile(file);
  return AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext);
}

export async function uploadMeetingRecording(opts: {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
  series: MtgSeriesRow | null;
  file: File | Blob;
  fileName?: string;
  origin?: "manual_upload" | "browser_recorder";
}): Promise<{ path: string }> {
  if (!canUploadRecording(opts.meeting.status)) {
    throw new Error(`No se puede guardar grabación en estado ${opts.meeting.status}`);
  }

  const asFile =
    opts.file instanceof File
      ? opts.file
      : new File(
          [opts.file],
          opts.fileName ?? `grabacion-${Date.now()}.webm`,
          { type: opts.file.type || "audio/webm" },
        );

  if (!isAllowedRecordingFile(asFile)) {
    throw new Error("Formato no soportado. Usa audio/video (webm, mp3, m4a, mp4, wav…).");
  }

  if (asFile.size > MTG_MAX_RECORDING_BYTES) {
    throw new Error(
      `La grabación pesa ${formatRecordingSizeMb(asFile.size)} MB y supera el tope (~${formatRecordingSizeMb(MTG_MAX_RECORDING_BYTES)} MB / ${MTG_MAX_RECORDING_HOURS} h). Usa audio (sin video de pantalla) o parte la sesión.`,
    );
  }

  const anchorType = opts.series?.anchor_type ?? "client";
  const anchorId =
    opts.series?.anchor_id ?? opts.meeting.client_id ?? opts.organizationId;
  const ext = extFromFile(asFile) || "webm";
  const path = buildMtgStoragePath({
    organizationId: opts.organizationId,
    anchorType,
    anchorId,
    kind: "recordings",
    fileName: `recording.${ext}`,
  });

  const contentType =
    asFile.type ||
    (ext === "webm"
      ? "audio/webm"
      : ext === "mp3"
        ? "audio/mpeg"
        : `application/octet-stream`);
  const { error: upErr } = await supabase.storage
    .from(MTG_BUCKET)
    .upload(path, asFile, { upsert: true, contentType });
  if (upErr) {
    const msg = (upErr.message || "").toLowerCase();
    const status = (upErr as { statusCode?: string | number }).statusCode;
    if (
      status === "413" ||
      status === 413 ||
      msg.includes("too large") ||
      msg.includes("entitytoolarge") ||
      msg.includes("maximum allowed size") ||
      msg.includes("payload too large")
    ) {
      throw new Error(
        `El archivo pesa ${formatRecordingSizeMb(asFile.size)} MB y Storage lo rechazó. Usa «Grabar audio» / «Audio de llamada» (hasta ~${MTG_MAX_RECORDING_HOURS} h) en vez de video de pantalla.`,
      );
    }
    throw upErr;
  }

  const { error: mErr } = await mtgDb
    .from("mtg_meetings")
    .update({ recording_path: path })
    .eq("id", opts.meeting.id);
  if (mErr) throw mErr;

  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "meeting",
    entityId: opts.meeting.id,
    action: MTG_AUDIT_ACTION.RECORDING_SAVED,
    details: {
      origin: opts.origin ?? "manual_upload",
      path,
      file_name: asFile.name,
      size_bytes: asFile.size,
      content_type: contentType,
      max_hours: MTG_MAX_RECORDING_HOURS,
      will_chunk_whisper: asFile.size > MTG_WHISPER_MAX_BYTES,
    },
  });

  return { path };
}
