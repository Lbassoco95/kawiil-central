-- =================================================================
-- ROLLBACK de supabase/migrations/20260917120000_mtg_juntas_schema.sql
-- Proyecto: qppfampapbxdgednkofc  ·  Fecha: 2026-09-17  ·  Módulo: Múuch' (Juntas)
--
-- El pipeline del repo (supabase db push --include-all) es forward-only: este
-- script NO se ejecuta solo. Se aplica a mano en el SQL editor si hay que
-- deshacer el Bloque 1.
--
-- Idempotente y en orden inverso al script principal.
--
-- ⚠️ DESTRUCTIVO: borra series, juntas, temas, acuerdos, decisiones, minutas
-- y la bitácora del módulo. Los archivos del bucket `mtg` NO se tocan aquí
-- (ver 2026-09-17_mtg_storage_bucket.rollback.sql).
-- =================================================================

-- 1. Columna agregada a tasks
DROP INDEX IF EXISTS public.idx_tasks_mtg_meeting;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS mtg_meeting_id;

-- 2. Función de generación de instancias
DROP FUNCTION IF EXISTS public.mtg_generate_series_meetings(uuid, int);

-- 3. Bitácora (trigger + función + tabla)
DROP TRIGGER IF EXISTS trg_mtg_audit_log_immutable ON public.mtg_audit_log;
DROP FUNCTION IF EXISTS public.mtg_audit_log_immutable();
DROP TABLE IF EXISTS public.mtg_audit_log;

-- 4. Suscripciones de Graph
DROP TRIGGER IF EXISTS update_mtg_graph_subscriptions_updated_at ON public.mtg_graph_subscriptions;
DROP TABLE IF EXISTS public.mtg_graph_subscriptions;

-- 5. Triggers de updated_at (se van con la tabla, pero explícito por claridad)
DROP TRIGGER IF EXISTS update_mtg_minutes_updated_at ON public.mtg_minutes;
DROP TRIGGER IF EXISTS update_mtg_agreements_updated_at ON public.mtg_agreements;
DROP TRIGGER IF EXISTS update_mtg_decisions_updated_at ON public.mtg_decisions;
DROP TRIGGER IF EXISTS update_mtg_agenda_items_updated_at ON public.mtg_agenda_items;
DROP TRIGGER IF EXISTS update_mtg_topic_updates_updated_at ON public.mtg_topic_updates;
DROP TRIGGER IF EXISTS update_mtg_topics_updated_at ON public.mtg_topics;
DROP TRIGGER IF EXISTS update_mtg_meetings_updated_at ON public.mtg_meetings;
DROP TRIGGER IF EXISTS update_mtg_series_updated_at ON public.mtg_series;

-- 6. Trigger + función del ancla de la serie
DROP TRIGGER IF EXISTS trg_mtg_series_validate_anchor ON public.mtg_series;
DROP FUNCTION IF EXISTS public.mtg_series_validate_anchor();

-- 7. FKs cruzadas agregadas al final de la migración: viven en la tabla que
--    referencia, así que hay que quitarlas antes de borrar las referenciadas.
ALTER TABLE public.mtg_meetings DROP CONSTRAINT IF EXISTS mtg_meetings_minutes_id_fkey;
ALTER TABLE public.mtg_agenda_items DROP CONSTRAINT IF EXISTS mtg_agenda_items_decision_id_fkey;
ALTER TABLE public.mtg_decisions DROP CONSTRAINT IF EXISTS mtg_decisions_agreement_id_fkey;

-- 8. Tablas, en orden inverso de dependencia.
--    Las policies e índices se van con la tabla.
DROP TABLE IF EXISTS public.mtg_minutes;
DROP TABLE IF EXISTS public.mtg_agreements;
DROP TABLE IF EXISTS public.mtg_expected_next;
DROP TABLE IF EXISTS public.mtg_decisions;
DROP TABLE IF EXISTS public.mtg_agenda_items;
DROP TABLE IF EXISTS public.mtg_topic_updates;
DROP TABLE IF EXISTS public.mtg_topics;
DROP TABLE IF EXISTS public.mtg_meetings;
DROP TABLE IF EXISTS public.mtg_series;
