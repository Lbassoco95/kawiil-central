-- avatars: bucket publico para fotos de perfil de usuarios.
-- La edge `microsoft-api` (action sync-profile-photo) sube la foto desde
-- Microsoft Graph (/me/photo/$value) a `{userId}/microsoft.{ext}` y guarda
-- la URL publica en `profiles.avatar_url`.

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Lectura publica (bucket publico): cualquiera con la URL puede ver la imagen.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Avatars public read'
    ) THEN
        CREATE POLICY "Avatars public read"
            ON storage.objects FOR SELECT
            USING (bucket_id = 'avatars');
    END IF;
END $$;

-- Cada usuario solo escribe/borra bajo su propia carpeta `{userId}/...`.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Avatars users insert own folder'
    ) THEN
        CREATE POLICY "Avatars users insert own folder"
            ON storage.objects FOR INSERT TO authenticated
            WITH CHECK (
                bucket_id = 'avatars'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Avatars users update own folder'
    ) THEN
        CREATE POLICY "Avatars users update own folder"
            ON storage.objects FOR UPDATE TO authenticated
            USING (
                bucket_id = 'avatars'
                AND (storage.foldername(name))[1] = auth.uid()::text
            )
            WITH CHECK (
                bucket_id = 'avatars'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Avatars users delete own folder'
    ) THEN
        CREATE POLICY "Avatars users delete own folder"
            ON storage.objects FOR DELETE TO authenticated
            USING (
                bucket_id = 'avatars'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;
END $$;

-- service_role bypassa RLS, pero dejamos policy explicita para claridad y
-- por si la edge usa anon+JWT en el futuro.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Avatars service_role full access'
    ) THEN
        CREATE POLICY "Avatars service_role full access"
            ON storage.objects FOR ALL TO service_role
            USING (bucket_id = 'avatars')
            WITH CHECK (bucket_id = 'avatars');
    END IF;
END $$;
