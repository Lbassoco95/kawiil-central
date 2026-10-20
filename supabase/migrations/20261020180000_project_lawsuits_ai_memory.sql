-- Memoria de la IA por juicio: lo que el equipo le ha aclarado a la IA sobre el asunto
-- (p. ej. «es un procedimiento paraprocesal, no una demanda»). La IA la lee y la actualiza
-- al sugerir etapas; es compartida por todos los que ven el juicio (mismas RLS de project_lawsuits).

ALTER TABLE public.project_lawsuits
  ADD COLUMN IF NOT EXISTS ai_memory text,
  ADD COLUMN IF NOT EXISTS ai_memory_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_memory_updated_by uuid;

COMMENT ON COLUMN public.project_lawsuits.ai_memory IS
  'Memoria compartida de la IA para este juicio: aclaraciones del equipo que la IA toma en cuenta y actualiza.';
