-- =================================================================
-- Múuch' — bucket privado `mtg`
--
-- Convención:
--   {organization_id}/mtg/{anchor_type}/{anchor_id}/{yyyy}/{mm}/{tipo}/{ts}_{nombre}.{ext}
--   anchor_type ∈ client | group
--   tipo ∈ transcripts | recordings | minutes | evidence
--
-- Rollback: migrations/2026-09-18_mtg_storage_bucket.rollback.sql
-- =================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('mtg', 'mtg', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Mtg org read'
  ) THEN
    CREATE POLICY "Mtg org read"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'mtg'
        AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Mtg org insert'
  ) THEN
    CREATE POLICY "Mtg org insert"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'mtg'
        AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Mtg org update'
  ) THEN
    CREATE POLICY "Mtg org update"
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = 'mtg'
        AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
      )
      WITH CHECK (
        bucket_id = 'mtg'
        AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Mtg org delete'
  ) THEN
    CREATE POLICY "Mtg org delete"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'mtg'
        AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Mtg service_role full access'
  ) THEN
    CREATE POLICY "Mtg service_role full access"
      ON storage.objects FOR ALL TO service_role
      USING (bucket_id = 'mtg')
      WITH CHECK (bucket_id = 'mtg');
  END IF;
END $$;
