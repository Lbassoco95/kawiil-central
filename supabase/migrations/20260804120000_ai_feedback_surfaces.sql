-- Generaliza ai_feedback para calificar CUALQUIER salida de IA (no solo mensajes
-- del chat): descripciones generadas, borradores de correo, briefings, insights,
-- predictores, etc. El chat sigue usando chat_message_id; el resto usa
-- (surface, context_key).

ALTER TABLE public.ai_feedback
  ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'chat',
  ADD COLUMN IF NOT EXISTS context_key text;

COMMENT ON COLUMN public.ai_feedback.surface IS
  'Origen de la salida de IA calificada (ej. chat, task_description, project_description, email_draft, meeting_minutes, project_briefing, delay_predictor, client_health, finance_insight).';
COMMENT ON COLUMN public.ai_feedback.context_key IS
  'Identificador de la salida dentro del surface (ej. id de tarea/proyecto o hash del contenido) para deduplicar la calificación por usuario. Nulo para chat (usa chat_message_id).';

-- Deduplicación para surfaces que no son chat: un voto por usuario y salida.
-- El chat conserva su UNIQUE(user_id, chat_message_id) original.
CREATE UNIQUE INDEX IF NOT EXISTS ai_feedback_surface_context_uidx
  ON public.ai_feedback (user_id, surface, context_key)
  WHERE chat_message_id IS NULL AND context_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_feedback_org_surface_idx
  ON public.ai_feedback (organization_id, surface, created_at DESC);
