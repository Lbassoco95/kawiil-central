/**
 * Utilidades para armar VTT a partir de segmentos Whisper / gpt-transcribe
 * y decidir si hace falta traducir a español.
 */

export type WhisperSegment = {
  start: number;
  end: number;
  text: string;
};

/** HH:MM:SS.mmm para WebVTT */
export function formatVttTimestamp(seconds: number): string {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const whole = Math.floor(sec);
  const ms = Math.round((sec - whole) * 1000);
  return (
    `${String(h).padStart(2, "0")}:` +
    `${String(m).padStart(2, "0")}:` +
    `${String(whole).padStart(2, "0")}.` +
    `${String(ms).padStart(3, "0")}`
  );
}

export function segmentsToVtt(segments: WhisperSegment[]): string {
  const lines = ["WEBVTT", ""];
  let i = 1;
  for (const seg of segments) {
    const text = (seg.text || "").trim();
    if (!text) continue;
    lines.push(String(i++));
    lines.push(
      `${formatVttTimestamp(seg.start)} --> ${formatVttTimestamp(seg.end)}`,
    );
    lines.push(text);
    lines.push("");
  }
  return lines.join("\n");
}

/** Códigos que consideramos español (Whisper / ISO). */
export function isSpanishLanguageCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const c = code.trim().toLowerCase();
  return c === "es" || c === "spa" || c.startsWith("es-") || c.startsWith("spa");
}

/**
 * Idiomas típicos de juntas Kawiil que queremos cubrir en etapa 1.
 * Whisper detecta solo; esto documenta la expectativa de producto.
 */
export const MTG_STT_HINT_LANGUAGES = ["es", "en", "zh", "cmn", "yue"] as const;
