-- Rollback: revierte 2026-04-20_extend_agent_tasks_attachments.sql
-- Fecha: 2026-04-20
-- Aplicada en Supabase proyecto qppfampapbxdgednkofc
-- Orden inverso al script original, todo idempotente (IF EXISTS).

DROP INDEX IF EXISTS public.idx_agent_tasks_attachment_refs;

ALTER TABLE public.agent_tasks
  DROP CONSTRAINT IF EXISTS agent_tasks_attachment_refs_is_array;

ALTER TABLE public.agent_tasks
  DROP COLUMN IF EXISTS attachment_refs;
