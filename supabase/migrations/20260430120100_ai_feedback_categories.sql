ALTER TABLE public.ai_feedback
  ADD COLUMN IF NOT EXISTS feedback_category text,
  ADD COLUMN IF NOT EXISTS feedback_comment text;

COMMENT ON COLUMN public.ai_feedback.feedback_category IS 'Categoría cuando rating = down (ej. incorrecto, incompleto, tono).';
COMMENT ON COLUMN public.ai_feedback.feedback_comment IS 'Comentario libre opcional del usuario.';
