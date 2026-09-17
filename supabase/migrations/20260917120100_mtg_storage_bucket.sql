-- =================================================================
-- Múuch' — bucket privado `mtg`
--
-- No se reusa `documents`: sus policies son `bucket_id = 'documents'` a secas,
-- sin scoping por path ni por organización, así que cualquier usuario
-- autenticado del proyecto puede leer cualquier archivo del bucket. Aquí van
-- transcripciones, grabaciones y minutas de juntas de clientes: no pueden
-- vivir ahí. La minuta APROBADA va aquí (mtg_minutes.document_path), NO en
-- `documents` ni con document_id.
--
-- Convención de ruta:
--   {organization_id}/mtg/{anchor_type}/{anchor_id}/{yyyy}/{mm}/{tipo}/{ts}_{nombre}.{ext}
--   anchor_type ∈ client | group
--   tipo ∈ transcripts | recordings | minutes | evidence
--
-- El primer segmento del path es la organización, y de ahí cuelga la policy.
-- Los archivos se leen SIEMPRE por signed URL de vida corta (5 min); nunca por
-- URL pública ni path directo en el front.
--
-- Rollback: migrations/2026-09-17_mtg_storage_bucket.rollback.sql
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

  -- service_role bypassa RLS; policy explícita por claridad y por si el worker
  -- llega con anon+JWT en el futuro.
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
