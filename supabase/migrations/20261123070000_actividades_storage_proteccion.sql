-- Protección de los archivos de actividades en Storage.
-- Los archivos se guardan en el bucket `documents` con ruta  <organización>/<actividad>/<archivo>.
-- Las políticas de ese bucket solo revisaban el bucket (cualquier usuario con sesión veía, subía y borraba todo),
-- así que las reglas de la tabla activity_files no protegían el archivo en sí.
--
-- Estas políticas RESTRICTIVAS (se suman con AND a las existentes) limitan SOLO las rutas cuyo segundo tramo es
-- el id de una actividad existente: ahí únicamente quien administra esa actividad (G4, responsable o ayudante)
-- puede ver, subir, actualizar o borrar. Cualquier otro documento del bucket queda exactamente igual.
-- El service role (funciones del servidor) no pasa por estas políticas.

CREATE OR REPLACE FUNCTION public.activity_storage_ok(_name text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  seg text;
  aid uuid;
BEGIN
  seg := (storage.foldername(_name))[2];
  IF seg IS NULL OR seg !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN true;
  END IF;
  aid := seg::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.activities WHERE id = aid) THEN
    RETURN true;
  END IF;
  RETURN public.can_manage_activity(aid);
END;
$$;
REVOKE ALL ON FUNCTION public.activity_storage_ok(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activity_storage_ok(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "documents_actividad_select" ON storage.objects;
CREATE POLICY "documents_actividad_select" ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (bucket_id <> 'documents' OR public.activity_storage_ok(name));
DROP POLICY IF EXISTS "documents_actividad_insert" ON storage.objects;
CREATE POLICY "documents_actividad_insert" ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'documents' OR public.activity_storage_ok(name));
DROP POLICY IF EXISTS "documents_actividad_update" ON storage.objects;
CREATE POLICY "documents_actividad_update" ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'documents' OR public.activity_storage_ok(name))
  WITH CHECK (bucket_id <> 'documents' OR public.activity_storage_ok(name));
DROP POLICY IF EXISTS "documents_actividad_delete" ON storage.objects;
CREATE POLICY "documents_actividad_delete" ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'documents' OR public.activity_storage_ok(name));
