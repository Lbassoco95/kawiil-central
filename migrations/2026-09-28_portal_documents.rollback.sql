-- 2026-09-28 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260928140200_portal_documents.sql
-- DESTRUCTIVO para datos del portal: borra el mapeo de carpetas y el registro de documentos.
-- El bucket `portal` se elimina SOLO si está vacío (si tiene archivos, avisa y lo deja).
DROP POLICY IF EXISTS "Portal staff org read" ON storage.objects;
DROP POLICY IF EXISTS "Portal staff org insert" ON storage.objects;
DROP POLICY IF EXISTS "Portal client message upload" ON storage.objects;
DROP FUNCTION IF EXISTS public.portal_document_mark_read(uuid);
DROP FUNCTION IF EXISTS public.portal_staff_register_upload(uuid, text, text, text, text, bigint);
DROP FUNCTION IF EXISTS public.portal_staff_unpublish_document(uuid);
DROP FUNCTION IF EXISTS public.portal_staff_publish_document(uuid, text, text, int, int);
DROP FUNCTION IF EXISTS public.portal_staff_ignore_folder(uuid, boolean);
DROP FUNCTION IF EXISTS public.portal_staff_map_folder(uuid, uuid);
DROP TABLE IF EXISTS public.portal_sync_runs;
DROP TABLE IF EXISTS public.portal_document_reads;
DROP TABLE IF EXISTS public.portal_documents;
DROP TABLE IF EXISTS public.portal_dropbox_folders;
DROP FUNCTION IF EXISTS public.portal_documents_guard_publish();
DROP FUNCTION IF EXISTS public.portal_documents_force_pending();
DROP FUNCTION IF EXISTS public.portal_dropbox_mapping_once();
DROP FUNCTION IF EXISTS public.portal_is_forbidden_filename(text);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'portal') THEN
    RAISE WARNING 'El bucket portal conserva archivos; no se elimina.';
  ELSE
    DELETE FROM storage.buckets WHERE id = 'portal';
  END IF;
END $$;
