-- Rollback: supabase/migrations/20260918120200_mtg_storage_bucket.sql
DO $$
BEGIN
  DROP POLICY IF EXISTS "Mtg org read" ON storage.objects;
  DROP POLICY IF EXISTS "Mtg org insert" ON storage.objects;
  DROP POLICY IF EXISTS "Mtg org update" ON storage.objects;
  DROP POLICY IF EXISTS "Mtg org delete" ON storage.objects;
  DROP POLICY IF EXISTS "Mtg service_role full access" ON storage.objects;
END $$;

DELETE FROM storage.buckets WHERE id = 'mtg';
