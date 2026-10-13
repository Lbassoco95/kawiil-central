/**
 * Solicita transcripción (OpenAI Whisper) de la grabación de una junta.
 * La Edge `mtg-transcribe-recording` hace STT multiidioma → español + encola minuta.
 */

import { supabase } from "@/integrations/supabase/client";

export type RecordingTranscriptionResult = {
  transcript_path: string;
  language_detected: string | null;
  translated_to_spanish: boolean;
  enqueued_minutes: boolean;
};

/**
 * supabase-js oculta el cuerpo de la respuesta tras «Edge Function returned a
 * non-2xx status code». Lo leemos para mostrar el motivo real (OpenAI no
 * configurada, Whisper falló, sin grabación, etc.).
 */
async function describeInvokeError(error: {
  message?: string;
  context?: unknown;
}): Promise<string> {
  const fallback =
    "No se pudo invocar mtg-transcribe-recording. ¿Está desplegada la Edge Function?";
  const ctx = error.context;
  if (ctx instanceof Response) {
    try {
      const raw = await ctx.clone().text();
      let detail = raw;
      try {
        const j = JSON.parse(raw) as { error?: string; details?: string };
        detail = [j.error, j.details].filter(Boolean).join(" — ") || raw;
      } catch {
        /* cuerpo no JSON */
      }
      if (/insufficient_quota|no credits|credit_balance_exhausted/i.test(detail)) {
        return (
          "OpenAI no tiene créditos para transcribir. Tu grabación está guardada y segura en Storage; " +
          "recarga saldo en platform.openai.com/settings/organization/billing y pulsa «Reintentar transcripción»."
        );
      }
      if (detail.trim()) return `Transcripción falló (${ctx.status}): ${detail.slice(0, 400)}`;
      return `Transcripción falló (HTTP ${ctx.status}).`;
    } catch {
      /* cae al mensaje genérico */
    }
  }
  return error.message || fallback;
}

export async function requestRecordingTranscription(
  meetingId: string,
  /** true = ignora la caché por toma y vuelve a transcribir todo. */
  force = false,
): Promise<RecordingTranscriptionResult> {
  const { data, error } = await supabase.functions.invoke(
    "mtg-transcribe-recording",
    { body: { meeting_id: meetingId, force } },
  );
  if (error) {
    throw new Error(await describeInvokeError(error));
  }
  if (data?.error) {
    throw new Error(String(data.error));
  }
  return data as RecordingTranscriptionResult;
}
