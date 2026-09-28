-- =================================================================
-- Portal del cliente — M5: documentos sincronizados desde Dropbox,
-- mapeo carpeta→cliente, publicación y bucket privado `portal`.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-28
-- Rollback (a mano): migrations/2026-09-28_portal_documents.rollback.sql
--
-- Reglas que la BASE impone (además de la Edge portal-dropbox-sync):
--   · Nada nace publicado: todo INSERT queda 'pendiente'.
--   · Nunca entra ADMINISTRATIVO ni un archivo de credenciales (.key, .cer,
--     .dec, .pfx, .p12 o nombre con FIEL/CIEC/CSD/contraseña/clave).
--   · El cliente solo ve 'publicado' y solo si su cuenta es premier.
-- Ruta del bucket: {organization_id}/{client_id}/{area}/{...}. El primer
-- segmento es la organización y de ahí cuelga la policy del staff.
-- =================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('portal', 'portal', false)
ON CONFLICT (id) DO NOTHING;

-- ── Mapeo de carpetas de Dropbox ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_dropbox_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- id estable de Dropbox ("id:xxxx"): sobrevive a renombres de carpeta.
  dropbox_folder_id text NOT NULL UNIQUE,
  path_display text NOT NULL,
  name text NOT NULL,
  -- Lo fija una persona UNA vez. El nombre de la carpeta no vincula solo.
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  mapped_by uuid,
  mapped_at timestamptz,
  ignored boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz
);
ALTER TABLE public.portal_dropbox_folders ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_portal_dbx_folders_client ON public.portal_dropbox_folders (client_id);

-- El mapeo se fija una vez: cambiarlo exige desmapear (G3/G4) y queda en bitácora.
CREATE OR REPLACE FUNCTION public.portal_dropbox_mapping_once()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.client_id IS NOT NULL AND NEW.client_id IS NOT NULL AND NEW.client_id <> OLD.client_id THEN
    RAISE EXCEPTION 'La carpeta ya está vinculada a otro cliente; desvincúlela primero';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_portal_dropbox_mapping_once ON public.portal_dropbox_folders;
CREATE TRIGGER trg_portal_dropbox_mapping_once BEFORE UPDATE OF client_id ON public.portal_dropbox_folders
  FOR EACH ROW EXECUTE FUNCTION public.portal_dropbox_mapping_once();

-- ── Documentos ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_is_forbidden_filename(_name text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT lower(COALESCE(_name, '')) ~ '\.(key|cer|dec|pfx|p12|req|sdg)$'
      OR lower(COALESCE(_name, '')) ~ '(fiel|e[\.\-_ ]?firma|ciec|csd|contrase|password|passwd|clave|llave privada|sello digital)'
$$;
COMMENT ON FUNCTION public.portal_is_forbidden_filename(text) IS
  'Espejo de isForbiddenFileName() en supabase/functions/_shared/portal/dropboxFilter.ts. Una prueba compara ambos.';

CREATE TABLE IF NOT EXISTS public.portal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES public.portal_dropbox_folders(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('dropbox', 'subida')),
  -- Lista blanca. ADMINISTRATIVO no existe aquí a propósito.
  area text NOT NULL CHECK (area IN ('FISCAL', 'CONTABILIDAD', 'LEGAL', 'RECURSOS_HUMANOS')),
  dropbox_file_id text,
  dropbox_rev text,
  content_hash text,
  source_path text,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  storage_path text NOT NULL,
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'publicado', 'despublicado')),
  title text,
  doc_type text CHECK (doc_type IS NULL OR doc_type IN (
    'declaracion', 'pago', 'opinion_cumplimiento', 'constancia', 'estado_financiero', 'contrato', 'otro')),
  period_year int CHECK (period_year IS NULL OR period_year BETWEEN 2000 AND 2100),
  period_month int CHECK (period_month IS NULL OR period_month BETWEEN 1 AND 12),
  -- El archivo cambió en Dropbox después de publicarse: el staff debe revisarlo.
  changed_since_publish boolean NOT NULL DEFAULT false,
  published_by uuid,
  published_at timestamptz,
  unpublished_by uuid,
  unpublished_at timestamptz,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_documents_no_credentials CHECK (NOT public.portal_is_forbidden_filename(file_name)),
  CONSTRAINT portal_documents_publish_requires_metadata CHECK (
    status <> 'publicado' OR (title IS NOT NULL AND btrim(title) <> '' AND period_year IS NOT NULL AND doc_type IS NOT NULL)
  ),
  CONSTRAINT portal_documents_dropbox_has_id CHECK (source <> 'dropbox' OR dropbox_file_id IS NOT NULL)
);
ALTER TABLE public.portal_documents ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_documents_dropbox
  ON public.portal_documents (client_id, dropbox_file_id) WHERE dropbox_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_portal_documents_client_status ON public.portal_documents (client_id, status, period_year DESC);

DROP TRIGGER IF EXISTS trg_portal_documents_org ON public.portal_documents;
CREATE TRIGGER trg_portal_documents_org
  BEFORE INSERT OR UPDATE OF client_id ON public.portal_documents
  FOR EACH ROW EXECUTE FUNCTION public.portal_inherit_client_org();
DROP TRIGGER IF EXISTS update_portal_documents_updated_at ON public.portal_documents;
CREATE TRIGGER update_portal_documents_updated_at BEFORE UPDATE ON public.portal_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Nada se publica solo: todo INSERT nace pendiente, lo mande quien lo mande.
CREATE OR REPLACE FUNCTION public.portal_documents_force_pending()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.status := 'pendiente';
  NEW.published_at := NULL;
  NEW.published_by := NULL;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_portal_documents_force_pending ON public.portal_documents;
CREATE TRIGGER trg_portal_documents_force_pending BEFORE INSERT ON public.portal_documents
  FOR EACH ROW EXECUTE FUNCTION public.portal_documents_force_pending();

-- Cambio a 'publicado' solo desde la función de publicación (marca de sesión).
CREATE OR REPLACE FUNCTION public.portal_documents_guard_publish()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'publicado' AND OLD.status <> 'publicado'
     AND COALESCE(current_setting('portal.publishing', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Un documento solo se publica con portal_staff_publish_document()';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_portal_documents_guard_publish ON public.portal_documents;
CREATE TRIGGER trg_portal_documents_guard_publish BEFORE UPDATE OF status ON public.portal_documents
  FOR EACH ROW EXECUTE FUNCTION public.portal_documents_guard_publish();

CREATE TABLE IF NOT EXISTS public.portal_document_reads (
  document_id uuid NOT NULL REFERENCES public.portal_documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  first_read_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, user_id)
);
ALTER TABLE public.portal_document_reads ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.portal_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  mode text NOT NULL CHECK (mode IN ('dropbox', 'carpeta_local', 'descubrimiento')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  triggered_by uuid,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  rejected jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text
);
ALTER TABLE public.portal_sync_runs ENABLE ROW LEVEL SECURITY;

-- ── RLS ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS portal_dbx_folders_staff ON public.portal_dropbox_folders;
CREATE POLICY portal_dbx_folders_staff ON public.portal_dropbox_folders
  FOR SELECT TO authenticated USING (
    public.portal_is_staff(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS portal_documents_select_portal ON public.portal_documents;
CREATE POLICY portal_documents_select_portal ON public.portal_documents
  FOR SELECT TO authenticated USING (
    status = 'publicado'
    AND public.portal_can_read_client(client_id)
    AND public.portal_my_tier() = 'premier'
  );
DROP POLICY IF EXISTS portal_documents_select_staff ON public.portal_documents;
CREATE POLICY portal_documents_select_staff ON public.portal_documents
  FOR SELECT TO authenticated USING (
    public.portal_is_staff(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS portal_document_reads_select ON public.portal_document_reads;
CREATE POLICY portal_document_reads_select ON public.portal_document_reads
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS portal_sync_runs_staff ON public.portal_sync_runs;
CREATE POLICY portal_sync_runs_staff ON public.portal_sync_runs
  FOR SELECT TO authenticated USING (
    public.portal_is_staff(auth.uid())
    AND (organization_id IS NULL OR organization_id = public.get_user_org_id(auth.uid())));

REVOKE INSERT, UPDATE, DELETE ON public.portal_dropbox_folders, public.portal_documents,
  public.portal_document_reads, public.portal_sync_runs FROM anon, authenticated;

-- ── Storage: bucket `portal` ────────────────────────────────────────
-- Staff: su organización (primer segmento). Portal: SOLO puede SUBIR adjuntos
-- de mensajes en {org}/{client}/mensajes/{thread}/…; nunca lee directo:
-- toda descarga pasa por la Edge portal-api (enlace firmado de 120 s + bitácora).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'Portal staff org read') THEN
    CREATE POLICY "Portal staff org read" ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'portal' AND public.portal_is_staff(auth.uid())
             AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'Portal staff org insert') THEN
    CREATE POLICY "Portal staff org insert" ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'portal' AND public.portal_is_staff(auth.uid())
                  AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'Portal client message upload') THEN
    CREATE POLICY "Portal client message upload" ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'portal'
        AND (storage.foldername(name))[3] = 'mensajes'
        AND (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
        AND public.portal_has_client_role(((storage.foldername(name))[2])::uuid, ARRAY['administrador', 'operativo'])
        AND (storage.foldername(name))[1] = public.portal_client_org_id(((storage.foldername(name))[2])::uuid)::text
      );
  END IF;
END $$;

-- ── RPC del equipo ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_staff_map_folder(_folder_id uuid, _client_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_f public.portal_dropbox_folders;
BEGIN
  SELECT * INTO v_f FROM public.portal_dropbox_folders WHERE id = _folder_id;
  IF NOT FOUND OR NOT public.portal_is_staff_admin(auth.uid())
     OR v_f.organization_id <> public.get_user_org_id(auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _client_id IS NULL THEN
    -- Desvincular.
    UPDATE public.portal_dropbox_folders SET client_id = NULL, mapped_by = auth.uid(), mapped_at = now() WHERE id = _folder_id;
  ELSE
    IF NOT public.portal_staff_in_client_org(auth.uid(), _client_id) THEN
      RAISE EXCEPTION 'Cliente de otra organización' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.portal_dropbox_folders SET client_id = _client_id, mapped_by = auth.uid(), mapped_at = now(), ignored = false
     WHERE id = _folder_id;
  END IF;
  PERFORM public.portal_audit('dropbox_mapeo', COALESCE(_client_id, v_f.client_id), 'portal_dropbox_folders', _folder_id::text,
    jsonb_build_object('carpeta', v_f.path_display, 'antes', v_f.client_id, 'despues', _client_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_staff_ignore_folder(_folder_id uuid, _ignored boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
BEGIN
  IF NOT public.portal_is_staff_admin(auth.uid()) OR NOT EXISTS (
       SELECT 1 FROM public.portal_dropbox_folders
        WHERE id = _folder_id AND organization_id = public.get_user_org_id(auth.uid())) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.portal_dropbox_folders SET ignored = _ignored WHERE id = _folder_id AND client_id IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_staff_publish_document(
  _document_id uuid, _title text, _doc_type text, _period_year int, _period_month int DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_d public.portal_documents; v_client_name text;
BEGIN
  SELECT * INTO v_d FROM public.portal_documents WHERE id = _document_id FOR UPDATE;
  IF NOT FOUND OR NOT public.portal_is_staff(auth.uid())
     OR v_d.organization_id <> public.get_user_org_id(auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('portal.publishing', 'on', true);
  UPDATE public.portal_documents SET
    status = 'publicado', title = btrim(_title), doc_type = _doc_type,
    period_year = _period_year, period_month = _period_month,
    published_by = auth.uid(), published_at = now(),
    unpublished_by = NULL, unpublished_at = NULL, changed_since_publish = false
  WHERE id = _document_id;
  PERFORM set_config('portal.publishing', 'off', true);
  PERFORM public.portal_audit('publicacion', v_d.client_id, 'portal_documents', _document_id::text,
    jsonb_build_object('title', _title, 'doc_type', _doc_type, 'period_year', _period_year, 'period_month', _period_month));
  SELECT name INTO v_client_name FROM public.clients WHERE id = v_d.client_id;
  PERFORM public.portal_enqueue('correo', 'documento_nuevo', v_d.client_id, jsonb_build_object(
    'document_id', _document_id, 'title', _title, 'client_name', v_client_name,
    'to', to_jsonb(public.portal_client_admin_emails(v_d.client_id))));
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_staff_unpublish_document(_document_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_d public.portal_documents;
BEGIN
  SELECT * INTO v_d FROM public.portal_documents WHERE id = _document_id FOR UPDATE;
  IF NOT FOUND OR NOT public.portal_is_staff(auth.uid())
     OR v_d.organization_id <> public.get_user_org_id(auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.portal_documents SET status = 'despublicado', unpublished_by = auth.uid(), unpublished_at = now()
   WHERE id = _document_id;
  PERFORM public.portal_audit('despublicacion', v_d.client_id, 'portal_documents', _document_id::text, '{}'::jsonb);
END;
$$;

-- Subida expresa (LEGAL / RECURSOS_HUMANOS o cualquier área permitida) por una persona.
CREATE OR REPLACE FUNCTION public.portal_staff_register_upload(
  _client_id uuid, _area text, _storage_path text, _file_name text, _mime_type text, _size_bytes bigint
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_org uuid; v_id uuid;
BEGIN
  IF NOT public.portal_staff_in_client_org(auth.uid(), _client_id) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT organization_id INTO v_org FROM public.clients WHERE id = _client_id;
  IF left(_storage_path, 74) <> v_org::text || '/' || _client_id::text || '/' OR _storage_path LIKE '%..%' THEN
    RAISE EXCEPTION 'Ruta fuera del cliente';
  END IF;
  INSERT INTO public.portal_documents (organization_id, client_id, source, area, file_name, mime_type, size_bytes, storage_path, uploaded_by)
  VALUES (v_org, _client_id, 'subida', _area, _file_name, _mime_type, _size_bytes, _storage_path, auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.portal_audit('documento_subida', _client_id, 'portal_documents', v_id::text,
    jsonb_build_object('area', _area, 'file_name', _file_name));
  RETURN v_id;
END;
$$;

-- El cliente marca un documento como leído.
CREATE OR REPLACE FUNCTION public.portal_document_mark_read(_document_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_client uuid;
BEGIN
  SELECT client_id INTO v_client FROM public.portal_documents
   WHERE id = _document_id AND status = 'publicado';
  IF v_client IS NULL OR NOT public.portal_can_read_client(v_client) OR public.portal_my_tier() <> 'premier' THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.portal_document_reads (document_id, user_id) VALUES (_document_id, auth.uid())
  ON CONFLICT (document_id, user_id) DO UPDATE SET last_read_at = now();
  PERFORM public.portal_audit('documento_consulta', v_client, 'portal_documents', _document_id::text, '{}'::jsonb);
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'portal_staff_map_folder(uuid, uuid)', 'portal_staff_ignore_folder(uuid, boolean)',
    'portal_staff_publish_document(uuid, text, text, int, int)', 'portal_staff_unpublish_document(uuid)',
    'portal_staff_register_upload(uuid, text, text, text, text, bigint)', 'portal_document_mark_read(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
