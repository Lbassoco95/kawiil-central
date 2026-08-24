-- =================================================================
-- Ju'un — bucket privado `juun`
--
-- No se reusa `documents`: sus policies son `bucket_id = 'documents'` a secas,
-- sin scoping por path ni por organización, así que cualquier usuario
-- autenticado del proyecto puede leer cualquier archivo del bucket. Aquí van
-- CSF, fotos de tickets, CFDI y evidencia de navegación de clientes: no
-- pueden vivir ahí.
--
-- Convención de ruta (consistente con _shared/moffinStoragePath.ts):
--   {organization_id}/juun/clients/{client_id}/{yyyy}/{mm}/{tipo}/{ts}_{nombre}.{ext}
--   tipo ∈ receipts | cfdi | csf | evidence
--
-- El primer segmento del path es la organización, y de ahí cuelga la policy.
-- Los archivos se leen SIEMPRE por signed URL de vida corta (5 min); nunca por
-- URL pública ni path directo en el front.
--
-- Rollback: migrations/2026-08-24_juun_storage_bucket.rollback.sql
-- =================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('juun', 'juun', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Juun org read'
  ) THEN
    CREATE POLICY "Juun org read"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'juun'
        AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Juun org insert'
  ) THEN
    CREATE POLICY "Juun org insert"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'juun'
        AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Juun org update'
  ) THEN
    CREATE POLICY "Juun org update"
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = 'juun'
        AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
      )
      WITH CHECK (
        bucket_id = 'juun'
        AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Juun org delete'
  ) THEN
    CREATE POLICY "Juun org delete"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'juun'
        AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
      );
  END IF;

  -- service_role bypassa RLS; policy explícita por claridad y por si el worker
  -- llega con anon+JWT en el futuro.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Juun service_role full access'
  ) THEN
    CREATE POLICY "Juun service_role full access"
      ON storage.objects FOR ALL TO service_role
      USING (bucket_id = 'juun')
      WITH CHECK (bucket_id = 'juun');
  END IF;
END $$;
