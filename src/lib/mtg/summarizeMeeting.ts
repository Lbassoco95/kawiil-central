/**
 * Genera el resumen de la junta (puntos clave, compromisos con fechas, notas,
 * participantes estimados) desde la transcripción y lo guarda como borrador de minuta.
 */

import { supabase } from "@/integrations/supabase/client";
import { getOutputLanguage } from "@/lib/mtg/outputLanguage";

export type MeetingSummaryResult = {
  minutes_id: string;
  content_md: string;
  language: string;
};

export async function summarizeMeeting(meetingId: string): Promise<MeetingSummaryResult> {
  const { data, error } = await supabase.functions.invoke("mtg-summarize-meeting", {
    body: { meeting_id: meetingId, language: getOutputLanguage() },
  });
  if (error) {
    let detail = error.message;
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const j = (await ctx.clone().json()) as { error?: string };
        if (j?.error) detail = j.error;
      } catch {
        /* cuerpo no JSON */
      }
    }
    throw new Error(`No se pudo generar el resumen: ${detail}`);
  }
  if (data?.error) throw new Error(String(data.error));
  return data as MeetingSummaryResult;
}
