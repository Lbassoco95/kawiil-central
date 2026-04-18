-- tmp-zips: bucket temporal para subir ZIPs grandes que la Edge `unzip-batch`
-- descomprime y luego elimina. Se usa cuando el ZIP supera el umbral de
-- descompresion en el cliente (config en src/lib/fileIntake/limits.ts).

INSERT INTO storage.buckets (id, name, public)
VALUES ('tmp-zips', 'tmp-zips', false)
ON CONFLICT (id) DO NOTHING;

-- Cada usuario solo puede subir bajo su propia carpeta `{userId}/...`.
CREATE POLICY "Users upload tmp zip in own folder"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'tmp-zips'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "Users read tmp zip in own folder"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'tmp-zips'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "Users delete tmp zip in own folder"
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'tmp-zips'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Limpieza automatica: cron diario que borra objetos > 24h.
-- Requiere extension pg_cron habilitada en el proyecto.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'tmp-zips-cleanup',
            '15 3 * * *',
            $cron$
            DELETE FROM storage.objects
            WHERE bucket_id = 'tmp-zips'
              AND created_at < now() - interval '24 hours';
            $cron$
        );
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- pg_cron puede no estar disponible en local; ignorar silenciosamente.
    RAISE NOTICE 'pg_cron no configurado: limpieza manual de tmp-zips requerida';
END $$;
