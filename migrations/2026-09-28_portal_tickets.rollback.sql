-- 2026-09-28 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260929110400_portal_tickets.sql
-- No borra tickets: las filas de fis_receipts/fis_cfdi (Ju'un) y sus archivos se conservan.
-- Solo quita lo que el portal agregó encima.
DROP POLICY IF EXISTS "Portal client receipt upload" ON storage.objects;
DROP VIEW IF EXISTS public.portal_tickets_v;
DROP POLICY IF EXISTS portal_fis_receipts_select ON public.fis_receipts;
DROP POLICY IF EXISTS portal_fis_cfdi_select ON public.fis_cfdi;
DROP TRIGGER IF EXISTS trg_portal_block_direct_receipts ON public.fis_receipts;
DROP FUNCTION IF EXISTS public.portal_block_direct_receipt_writes();
DROP FUNCTION IF EXISTS public.invoke_portal_edge_cron(text);
DROP FUNCTION IF EXISTS public.portal_staff_merchant_update_window(uuid, text, int);
DROP FUNCTION IF EXISTS public.portal_staff_ticket_mark_invoiced(uuid, text, text, text, numeric, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.portal_staff_ticket_update(uuid, uuid, date, text, numeric, text, text);
DROP FUNCTION IF EXISTS public.portal_staff_ticket_queue(boolean);
DROP FUNCTION IF EXISTS public.portal_ticket_register(uuid, text, text, uuid, text, date, text, numeric);
DROP FUNCTION IF EXISTS public.portal_tickets_enabled(uuid);
DROP FUNCTION IF EXISTS public.portal_ticket_visible_status(text, timestamptz);
DROP FUNCTION IF EXISTS public.portal_ticket_deadline(uuid, date);
