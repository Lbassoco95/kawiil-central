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

export async function requestRecordingTranscription(
  meetingId: string,
): Promise<RecordingTranscriptionResult> {
  const { data, error } = await supabase.functions.invoke(
    "mtg-transcribe-recording",
    { body: { meeting_id: meetingId } },
  );
  if (error) {
    throw new Error(
      error.message ||
        "No se pudo invocar mtg-transcribe-recording. ¿Está desplegada la Edge?",
    );
  }
  if (data?.error) {
    throw new Error(String(data.error));
  }
  return data as RecordingTranscriptionResult;
}
