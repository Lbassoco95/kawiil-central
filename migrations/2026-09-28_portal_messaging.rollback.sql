-- 2026-09-28 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260928140100_portal_messaging.sql
-- DESTRUCTIVO para datos del portal: borra hilos, mensajes, adjuntos (registro, no archivos)
-- y la bandeja de salida. No toca Slack ni Comunicación.
DROP FUNCTION IF EXISTS public.portal_thread_read_state(uuid);
DROP FUNCTION IF EXISTS public.portal_staff_inbox(text);
DROP FUNCTION IF EXISTS public.portal_staff_thread_update(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.portal_thread_mark_read(uuid);
DROP FUNCTION IF EXISTS public.portal_message_send(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.portal_thread_create(uuid, text, text);
DROP FUNCTION IF EXISTS public.portal_insert_attachments(uuid, uuid, jsonb);
DROP TABLE IF EXISTS public.portal_message_reads;
DROP TABLE IF EXISTS public.portal_message_attachments;
DROP TABLE IF EXISTS public.portal_messages;
DROP TABLE IF EXISTS public.portal_threads;
DROP TABLE IF EXISTS public.portal_outbox;
DROP FUNCTION IF EXISTS public.portal_staff_can_see_thread(uuid, uuid);
DROP FUNCTION IF EXISTS public.portal_after_message();
DROP FUNCTION IF EXISTS public.portal_enqueue(text, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.portal_client_admin_emails(uuid);
DROP FUNCTION IF EXISTS public.portal_inherit_thread_scope();
