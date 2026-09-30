/**
 * Parsers de transcripción manual (VTT / TXT / DOCX de Teams).
 */

export type TranscriptUploadKind = "vtt" | "txt" | "docx";

export function detectTranscriptKind(fileName: string): TranscriptUploadKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".vtt")) return "vtt";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".docx")) return "docx";
  return null;
}

/** Normaliza un VTT a texto con timestamps (HH:MM:SS) por cue. */
export function parseVttToPlainText(vtt: string): string {
  const lines = vtt.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let pendingTs: string | null = null;
  const cueRe = /^(\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*-->/;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === "WEBVTT" || line.startsWith("NOTE") || /^\d+$/.test(line)) {
      continue;
    }
    const m = line.match(cueRe);
    if (m) {
      pendingTs = m[1];
      continue;
    }
    if (pendingTs) {
      out.push(`[${pendingTs}] ${line}`);
      pendingTs = null;
    } else {
      out.push(line);
    }
  }
  return out.join("\n").trim();
}

/**
 * Texto plano de un DOCX (p. ej. transcripción exportada de Teams).
 * Si hay marcas tipo 00:12:04 o 0:12:04 al inicio de línea, se conservan
 * como `[HH:MM:SS]`.
 */
export function normalizeDocxTranscriptText(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const tsRe = /^\[?\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*\]?\s*[-–—:]?\s*(.*)$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(tsRe);
    if (m && m[2]) {
      out.push(`[${normalizeTs(m[1])}] ${m[2].trim()}`);
    } else if (m && !m[2]) {
      // solo timestamp; se combina con la siguiente línea en un segundo pase
      out.push(`__TS__${normalizeTs(m[1])}`);
    } else {
      out.push(line);
    }
  }

  const merged: string[] = [];
  for (let i = 0; i < out.length; i++) {
    if (out[i].startsWith("__TS__")) {
      const ts = out[i].slice(6);
      const next = out[i + 1];
      if (next && !next.startsWith("__TS__") && !next.startsWith("[")) {
        merged.push(`[${ts}] ${next}`);
        i += 1;
      } else {
        merged.push(`[${ts}]`);
      }
    } else {
      merged.push(out[i]);
    }
  }
  return merged.join("\n").trim();
}

function normalizeTs(ts: string): string {
  const base = ts.split(".")[0];
  const parts = base.split(":").map((p) => p.padStart(2, "0"));
  if (parts.length === 2) return `00:${parts[0]}:${parts[1]}`;
  return parts.join(":");
}

export async function fileToTranscriptPlainText(file: File): Promise<{
  kind: TranscriptUploadKind;
  text: string;
  uploadExt: string;
}> {
  const kind = detectTranscriptKind(file.name);
  if (!kind) throw new Error("Formato no soportado. Usa .vtt, .txt o .docx");

  if (kind === "vtt") {
    const raw = await file.text();
    return { kind, text: parseVttToPlainText(raw), uploadExt: "vtt" };
  }
  if (kind === "txt") {
    const raw = await file.text();
    return { kind, text: raw.trim(), uploadExt: "txt" };
  }

  const arrayBuffer = await file.arrayBuffer();
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer });
  const text = normalizeDocxTranscriptText(result.value ?? "");
  return { kind, text, uploadExt: "txt" };
}

export const MANUAL_UPLOAD_STATUSES = [
  "planned",
  "in_progress",
  "ended",
  "minutes_draft",
] as const;

export type ManualUploadMeetingStatus = (typeof MANUAL_UPLOAD_STATUSES)[number];

export function canManualUploadTranscript(status: string): boolean {
  return (MANUAL_UPLOAD_STATUSES as readonly string[]).includes(status);
}
