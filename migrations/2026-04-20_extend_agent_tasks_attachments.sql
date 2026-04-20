-- Migración: extender agent_tasks para soportar archivos adjuntos
-- Fecha: 2026-04-20
-- Aplicada en Supabase proyecto qppfampapbxdgednkofc
-- Propósito: permitir que una tarea de agente incluya referencias a
-- archivos en Supabase Storage que el agente debe procesar.
-- Parte del Bloque A del plan v5 (agentes como pre-procesadores).

ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS attachment_refs jsonb;

ALTER TABLE public.agent_tasks
  ADD CONSTRAINT agent_tasks_attachment_refs_is_array
  CHECK (attachment_refs IS NULL OR jsonb_typeof(attachment_refs) = 'array');

CREATE INDEX IF NOT EXISTS idx_agent_tasks_attachment_refs
  ON public.agent_tasks USING GIN (attachment_refs)
  WHERE attachment_refs IS NOT NULL;

COMMENT ON COLUMN public.agent_tasks.attachment_refs IS
  'Array jsonb con referencias a archivos en Supabase Storage que el agente debe procesar. Cada elemento: {bucket, path, name, mime_type, size_bytes?, document_id?}. NULL si la tarea no tiene archivos asociados.';
