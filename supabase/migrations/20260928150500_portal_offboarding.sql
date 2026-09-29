-- =================================================================
-- Portal del cliente — B2 y B3: qué se elimina siempre al darse de baja, y
-- empresa básica sin personas activas = empresa dada de baja.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-28
-- Rollback (a mano): migrations/2026-09-28_portal_offboarding.rollback.sql
-- Depende de 20260928150400_portal_retention_terms.sql (plazos 5/10).
--
-- Relación de la persona con cada cliente al darse de baja (portal_deletion_scope):
--   owned     básico creado por ella, sin nadie más con acceso        → baja de la empresa; ELIGE 5 o 10 años.
--   orphaned  básico creado por ella; los demás están suspendidos     → baja de la empresa (B3); resguardo por omisión.
--   member    cualquier otro caso con personas activas                → se retira su membresía; no se destruye nada.
--   sole_admin premier donde es la única administradora activa        → la baja se detiene.
-- «Persona activa» = membresía activa Y cuenta activa.
--
-- Baja de una empresa (portal__offboard_company), de inmediato y sin excepción:
--   CSD, llave y contraseña de la llave destruidos; emisión apagada y revocada;
--   mensajes, adjuntos, tickets sin facturar y documentos publicados en el portal
--   eliminados (archivos a la cola de borrado, que portal-api vacía en el acto);
--   datos de contacto de la empresa básica borrados; referencias a personas en
--   lo resguardado seudonimizadas; resguardo fiscal abierto con su plazo.
-- No borra ni reescribe datos existentes al aplicarse: solo define funciones y
-- agrega columnas.
-- =================================================================

ALTER TABLE public.portal_client_settings
  ADD COLUMN IF NOT EXISTS offboarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS offboard_request_id uuid REFERENCES public.portal_deletion_requests(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.portal_client_settings.offboarded_at IS
  'Fecha en que la empresa quedó dada de baja en el portal (B2–B4). Se limpia si vuelve a tener una persona activa.';

ALTER TABLE public.portal_storage_purge_queue
  ADD COLUMN IF NOT EXISTS deletion_request_id uuid REFERENCES public.portal_deletion_requests(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_portal_purge_queue_request ON public.portal_storage_purge_queue (deletion_request_id) WHERE done_at IS NULL;

-- ── Personas activas de una empresa (membresía activa y cuenta activa) ──
CREATE OR REPLACE FUNCTION public.portal__active_people(_client_id uuid, _except uuid DEFAULT NULL)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_temp, public
AS $$
  SELECT count(*)::int FROM public.portal_memberships m JOIN public.portal_accounts a ON a.user_id = m.user_id
   WHERE m.client_id = _client_id AND m.status = 'activa' AND a.status = 'activa'
     AND m.user_id IS DISTINCT FROM _except
$$;
REVOKE ALL ON FUNCTION public.portal__active_people(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_deletion_scope(_uid uuid)
RETURNS TABLE (client_id uuid, client_name text, relation text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT m.client_id, c.name,
    CASE
      WHEN COALESCE(s.origin, 'kawiil') = 'basico' AND m.created_by = _uid
           AND NOT EXISTS (SELECT 1 FROM public.portal_memberships o WHERE o.client_id = m.client_id AND o.user_id <> _uid)
        THEN 'owned'
      WHEN COALESCE(s.origin, 'kawiil') = 'basico' AND m.created_by = _uid
           AND public.portal__active_people(m.client_id, _uid) = 0
        THEN 'orphaned'
      WHEN COALESCE(s.origin, 'kawiil') = 'basico' AND m.created_by = _uid
        THEN 'member'
      WHEN m.role = 'administrador' AND m.status = 'activa'
           AND NOT EXISTS (SELECT 1 FROM public.portal_memberships o
                            WHERE o.client_id = m.client_id AND o.user_id <> _uid
                              AND o.role = 'administrador' AND o.status = 'activa')
        THEN 'sole_admin'
      ELSE 'member'
    END
  FROM public.portal_memberships m
  JOIN public.clients c ON c.id = m.client_id
  LEFT JOIN public.portal_client_settings s ON s.client_id = m.client_id
  WHERE m.user_id = _uid
$$;
REVOKE ALL ON FUNCTION public.portal_deletion_scope(uuid) FROM PUBLIC, anon, authenticated;

-- ── Referencias a personas en lo que se resguarda → seudónimo ──────
CREATE OR REPLACE FUNCTION public.portal__scrub_client_refs(_client_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_temp, public
AS $$
  UPDATE public.portal_cfdi SET created_by = public.portal_pseudonym_uuid(created_by)
   WHERE client_id = _client_id AND created_by IN (SELECT user_id FROM public.portal_accounts);
  UPDATE public.portal_cfdi SET category_confirmed_by = public.portal_pseudonym_uuid(category_confirmed_by)
   WHERE client_id = _client_id AND category_confirmed_by IN (SELECT user_id FROM public.portal_accounts);
  UPDATE public.portal_emissions SET requested_by = public.portal_pseudonym_uuid(requested_by)
   WHERE client_id = _client_id AND requested_by IN (SELECT user_id FROM public.portal_accounts);
  UPDATE public.portal_cancel_requests SET requested_by = public.portal_pseudonym_uuid(requested_by)
   WHERE client_id = _client_id AND requested_by IN (SELECT user_id FROM public.portal_accounts);
$$;
REVOKE ALL ON FUNCTION public.portal__scrub_client_refs(uuid) FROM PUBLIC, anon, authenticated;

-- ── Baja de una empresa (uso interno; solo service_role) ────────────
CREATE OR REPLACE FUNCTION public.portal__offboard_company(
  _client_id uuid, _request_id uuid, _years int, _kind text, _by uuid, _basico boolean, _motivo text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_org uuid;
  n_csd int; n_threads int; n_tk int; n_docs int; n_susp int;
BEGIN
  SELECT organization_id INTO v_org FROM public.clients WHERE id = _client_id;

  -- 1. CSD, llave y contraseña: se destruyen (cascada a registro y contraseña).
  DELETE FROM public.client_sat_certificates WHERE client_id = _client_id AND cert_type = 'csd_sello';
  GET DIAGNOSTICS n_csd = ROW_COUNT;
  DELETE FROM public.portal_csd_registry WHERE client_id = _client_id;
  INSERT INTO public.portal_client_settings (client_id, organization_id, emission_enabled, emission_changed_at, offboarded_at, offboard_request_id)
  VALUES (_client_id, v_org, false, now(), now(), _request_id)
  ON CONFLICT (client_id) DO UPDATE
    SET emission_enabled = false, emission_changed_at = now(), offboarded_at = now(), offboard_request_id = _request_id;
  PERFORM public.portal_audit('csd_destruccion', _client_id, 'client_sat_certificates', NULL,
    jsonb_build_object('certificados', n_csd, 'solicitud', _request_id), NULL);

  -- 2. Mensajes y adjuntos.
  INSERT INTO public.portal_storage_purge_queue (bucket, path, reason, deletion_request_id)
  SELECT 'portal', a.storage_path, 'baja', _request_id FROM public.portal_message_attachments a WHERE a.client_id = _client_id;
  DELETE FROM public.portal_threads WHERE client_id = _client_id;
  GET DIAGNOSTICS n_threads = ROW_COUNT;

  -- 3. Tickets aún no facturados.
  INSERT INTO public.portal_storage_purge_queue (bucket, path, reason, deletion_request_id)
  SELECT 'juun', f.file_path, 'baja', _request_id FROM public.fis_receipts f
   WHERE f.client_id = _client_id AND f.status <> 'invoiced' AND f.file_path IS NOT NULL;
  DELETE FROM public.fis_receipts WHERE client_id = _client_id AND status <> 'invoiced';
  GET DIAGNOSTICS n_tk = ROW_COUNT;

  -- 4. Documentos publicados en el portal (copias; el original sigue en el archivo de Kawiil) y su sincronización.
  INSERT INTO public.portal_storage_purge_queue (bucket, path, reason, deletion_request_id)
  SELECT 'portal', d.storage_path, 'baja', _request_id FROM public.portal_documents d WHERE d.client_id = _client_id;
  DELETE FROM public.portal_documents WHERE client_id = _client_id;
  GET DIAGNOSTICS n_docs = ROW_COUNT;
  DELETE FROM public.portal_dropbox_folders WHERE client_id = _client_id;

  -- 5. Avisos pendientes de enviar sobre la empresa.
  DELETE FROM public.portal_outbox WHERE client_id = _client_id AND status = 'pendiente';

  -- 6. Datos de contacto de la empresa básica (la razón social y el RFC sí se resguardan: son fiscales).
  IF _basico THEN
    UPDATE public.clients SET email = NULL, phone = NULL, address = NULL, contact_name = NULL, contact_position = NULL
     WHERE id = _client_id
       AND (email IS NOT NULL OR phone IS NOT NULL OR address IS NOT NULL OR contact_name IS NOT NULL OR contact_position IS NOT NULL);
  END IF;

  -- 7. Lo resguardado no identifica a personas.
  PERFORM public.portal__scrub_client_refs(_client_id);
  SELECT count(*) INTO n_susp FROM public.portal_memberships WHERE client_id = _client_id AND status = 'suspendida';

  -- 8. Resguardo fiscal con su plazo.
  PERFORM public.portal__retention_open(_client_id, NULL, _request_id, _years, _kind, _by,
    ARRAY['cfdi', 'tickets_facturados'], _motivo);

  PERFORM public.portal_audit('empresa_baja', _client_id, 'clients', _client_id::text,
    jsonb_build_object('motivo', _motivo, 'solicitud', _request_id, 'certificados', n_csd, 'hilos', n_threads,
                       'tickets_no_facturados', n_tk, 'documentos', n_docs, 'personas_suspendidas', n_susp,
                       'resguardo_anios', _years), NULL);
  RETURN jsonb_build_object('csd_destruidos', n_csd, 'hilos_eliminados', n_threads, 'tickets_eliminados', n_tk,
                            'documentos_eliminados', n_docs, 'resguardo_anios', _years);
END;
$$;
REVOKE ALL ON FUNCTION public.portal__offboard_company(uuid, uuid, int, text, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal__offboard_company(uuid, uuid, int, text, uuid, boolean, text) TO service_role;

-- ── Plan: exactamente qué se elimina y qué se resguarda, y hasta cuándo ──
CREATE OR REPLACE FUNCTION public.portal_account_deletion_plan(_uid uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_uid uuid := COALESCE(_uid, auth.uid());
  v_def int := public.portal_retention_years();
  v_confirmed boolean;
  v_elige boolean := false;
  v_acc_years int := public.portal_retention_years();
  v_elimina jsonb := '[]'::jsonb;
  v_conserva jsonb := '[]'::jsonb;
  v_bloqueos jsonb := '[]'::jsonb;
  v_para_fiscal text := 'Cumplir la obligación de conservar los comprobantes fiscales y la contabilidad.';
  r record;
  n_csd int; n_threads int; n_msgs int; n_att int; n_tk_open int; n_cfdi int; n_tk_done int; n_docs int; n_susp int; n_msgs_company int;
  d5 date := (now() + interval '5 years')::date;
  d10 date := (now() + interval '10 years')::date;
BEGIN
  IF auth.uid() IS NOT NULL AND v_uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_accounts WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Solo cuentas del portal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT confirmed INTO v_confirmed FROM public.portal_retention_policy WHERE key = 'fiscal_retention_years';

  v_elimina := v_elimina || jsonb_build_object('key', 'acceso', 'label', 'Su acceso al portal', 'cantidad', 1,
    'detalle', 'Usuario, contraseña, sesiones abiertas en todos sus dispositivos, enlaces e invitaciones pendientes, y su correo y nombre.');

  FOR r IN SELECT * FROM public.portal_deletion_scope(v_uid) LOOP
    IF r.relation IN ('owned', 'orphaned') THEN
      SELECT count(*) INTO n_csd FROM public.client_sat_certificates WHERE client_id = r.client_id AND cert_type = 'csd_sello';
      SELECT count(*) INTO n_threads FROM public.portal_threads WHERE client_id = r.client_id;
      SELECT count(*) INTO n_msgs FROM public.portal_messages WHERE client_id = r.client_id;
      SELECT count(*) INTO n_att FROM public.portal_message_attachments WHERE client_id = r.client_id;
      SELECT count(*) INTO n_tk_open FROM public.fis_receipts WHERE client_id = r.client_id AND status <> 'invoiced';
      SELECT count(*) INTO n_cfdi FROM public.portal_cfdi WHERE client_id = r.client_id;
      SELECT count(*) INTO n_tk_done FROM public.fis_receipts WHERE client_id = r.client_id AND status = 'invoiced';
      SELECT count(*) INTO n_docs FROM public.portal_documents WHERE client_id = r.client_id;
      SELECT count(*) INTO n_susp FROM public.portal_memberships WHERE client_id = r.client_id AND user_id <> v_uid;
      v_elimina := v_elimina
        || jsonb_build_object('key', 'csd', 'client', r.client_name, 'cantidad', n_csd,
             'label', 'Certificado de sello digital, llave y contraseña de la llave',
             'detalle', 'Se destruyen de inmediato. La emisión de facturas se apaga y se revoca.')
        || jsonb_build_object('key', 'mensajes', 'client', r.client_name, 'cantidad', n_msgs,
             'label', 'Mensajes y adjuntos', 'detalle', format('%s conversaciones, %s mensajes, %s adjuntos.', n_threads, n_msgs, n_att))
        || jsonb_build_object('key', 'tickets_no_facturados', 'client', r.client_name, 'cantidad', n_tk_open,
             'label', 'Tickets aún no facturados', 'detalle', 'Fotos y datos capturados.')
        || jsonb_build_object('key', 'documentos', 'client', r.client_name, 'cantidad', n_docs,
             'label', 'Documentos publicados en el portal', 'detalle', 'Se retiran del portal.')
        || jsonb_build_object('key', 'datos_contacto', 'client', r.client_name, 'cantidad', 1,
             'label', 'Datos de contacto de la empresa', 'detalle', 'Correo, teléfono, dirección y persona de contacto.');
      IF r.relation = 'orphaned' THEN
        v_elimina := v_elimina || jsonb_build_object('key', 'empresa_sin_personas_activas', 'client', r.client_name, 'cantidad', n_susp,
          'label', 'Personas suspendidas de la empresa',
          'detalle', 'No queda ninguna persona activa: la empresa se da de baja. Las personas suspendidas conservan su ficha, sin acceso a certificados.');
      ELSE
        v_elige := true;
      END IF;
      v_conserva := v_conserva
        || jsonb_build_object('key', 'cfdi', 'client', r.client_name, 'cantidad', n_cfdi,
             'label', 'Facturas (CFDI) emitidas y recibidas', 'para', v_para_fiscal,
             'elige', r.relation = 'owned', 'anios', v_def, 'hasta', (now() + make_interval(years => v_def))::date,
             'hasta_por_opcion', CASE WHEN r.relation = 'owned' THEN jsonb_build_object('5', d5, '10', d10) END,
             'detalle', 'En resguardo durante el plazo; al vencer se eliminan automáticamente.')
        || jsonb_build_object('key', 'tickets_facturados', 'client', r.client_name, 'cantidad', n_tk_done,
             'label', 'Tickets ya facturados, con su factura', 'para', v_para_fiscal,
             'elige', r.relation = 'owned', 'anios', v_def, 'hasta', (now() + make_interval(years => v_def))::date,
             'hasta_por_opcion', CASE WHEN r.relation = 'owned' THEN jsonb_build_object('5', d5, '10', d10) END,
             'detalle', 'En resguardo durante el plazo; al vencer se eliminan automáticamente.');
    ELSIF r.relation = 'sole_admin' THEN
      v_bloqueos := v_bloqueos || jsonb_build_object('client_id', r.client_id, 'client', r.client_name,
        'motivo', 'Usted es la única persona administradora de esta empresa en el portal. Designe a otra administradora o escriba a Kawiil antes de eliminar su cuenta.');
    ELSE
      SELECT count(*) INTO n_msgs_company FROM public.portal_messages WHERE client_id = r.client_id AND author_user_id = v_uid;
      v_acc_years := GREATEST(v_acc_years, public.portal_client_retention_years(r.client_id));
      v_elimina := v_elimina || jsonb_build_object('key', 'membresia', 'client', r.client_name, 'cantidad', 1,
        'label', 'Su acceso a la empresa', 'detalle', 'Se retira su membresía.');
      v_conserva := v_conserva || jsonb_build_object('key', 'datos_empresa', 'client', r.client_name, 'cantidad', n_msgs_company,
        'label', 'Facturas, documentos, CSD y conversaciones de la empresa',
        'detalle', 'Pertenecen a la empresa, que sigue activa. En los mensajes que usted escribió su nombre se sustituye por «Usuario eliminado».');
    END IF;
  END LOOP;

  v_conserva := v_conserva
    || jsonb_build_object('key', 'aceptaciones', 'cantidad', (SELECT count(*) FROM public.portal_legal_acceptances WHERE user_id = v_uid),
         'label', 'Constancia de aceptación de textos legales', 'para', 'Acreditar el consentimiento que usted otorgó.',
         'elige', v_elige, 'anios', v_acc_years, 'hasta', (now() + make_interval(years => v_acc_years))::date,
         'hasta_por_opcion', CASE WHEN v_elige THEN jsonb_build_object(
             '5', (now() + make_interval(years => GREATEST(5, v_acc_years)))::date,
             '10', (now() + make_interval(years => GREATEST(10, v_acc_years)))::date) END,
         'detalle', 'Se conserva la versión y la fecha, con su identidad seudonimizada; al vencer el plazo se elimina.')
    || jsonb_build_object('key', 'bitacora', 'cantidad', (SELECT count(*) FROM public.portal_audit_log WHERE actor_user_id = v_uid),
         'label', 'Bitácora de actividad', 'para', 'Evidencia de cumplimiento.',
         'detalle', 'Se conservan los hechos (qué, cuándo, sobre qué empresa); su nombre, correo e identificador se sustituyen por un seudónimo.');

  RETURN jsonb_build_object(
    'bloqueada', jsonb_array_length(v_bloqueos) > 0,
    'bloqueos', v_bloqueos,
    'elimina', v_elimina,
    'conserva', v_conserva,
    'resguardo', jsonb_build_object('elige', v_elige, 'omision', v_def,
      'opciones', jsonb_build_array(jsonb_build_object('anios', 5, 'hasta', d5), jsonb_build_object('anios', 10, 'hasta', d10))),
    'politica', jsonb_build_object('fiscal_retention_years', v_def, 'opciones', jsonb_build_array(5, 10),
                                   'confirmada', COALESCE(v_confirmed, false))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.portal_account_deletion_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_account_deletion_plan(uuid) TO authenticated, service_role;

-- ── Ejecución (portal-api con service_role; después borra el usuario de Auth) ──
DROP FUNCTION IF EXISTS public.portal_execute_account_deletion(uuid);
CREATE OR REPLACE FUNCTION public.portal_execute_account_deletion(_uid uuid, _years int DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_plan jsonb;
  v_email text;
  v_req uuid;
  v_def int := public.portal_retention_years();
  v_chosen int;
  v_kind text;
  v_p uuid := public.portal_pseudonym_uuid(_uid);
  v_acc_years int := public.portal_retention_years();
  v_acc_kind text := 'omision';
  v_owned boolean := false;
  r record;
  v_counts jsonb := '{}'::jsonb;
  v_c jsonb;
  n int;
BEGIN
  IF _years IS NOT NULL AND NOT public.portal_retention_allowed(_years) THEN
    RAISE EXCEPTION 'Plazo de resguardo inválido: solo 5 o 10 años';
  END IF;
  v_chosen := COALESCE(_years, v_def);
  v_kind := CASE WHEN _years IS NOT NULL THEN 'titular' ELSE 'omision' END;
  v_plan := public.portal_account_deletion_plan(_uid);
  SELECT email INTO v_email FROM public.portal_accounts WHERE user_id = _uid;

  IF (v_plan->>'bloqueada')::boolean THEN
    INSERT INTO public.portal_deletion_requests (subject_pseudonym, status, plan)
    VALUES (v_p, 'bloqueada', v_plan) RETURNING id INTO v_req;
    PERFORM public.portal_audit('cuenta_eliminacion_bloqueada', NULL, 'portal_deletion_requests', v_req::text,
      jsonb_build_object('empresas', jsonb_array_length(v_plan->'bloqueos')), _uid);
    RETURN jsonb_build_object('request_id', v_req, 'bloqueada', true, 'bloqueos', v_plan->'bloqueos');
  END IF;

  INSERT INTO public.portal_deletion_requests (subject_pseudonym, status, plan)
  VALUES (v_p, 'en_proceso', v_plan || jsonb_build_object('plazo_elegido', _years)) RETURNING id INTO v_req;
  PERFORM public.portal_audit('cuenta_eliminacion_solicitud', NULL, 'portal_deletion_requests', v_req::text,
    jsonb_build_object('elimina', jsonb_array_length(v_plan->'elimina'), 'conserva', jsonb_array_length(v_plan->'conserva'),
                       'plazo_elegido', _years), _uid);

  FOR r IN SELECT * FROM public.portal_deletion_scope(_uid) LOOP
    IF r.relation = 'owned' THEN
      v_owned := true;
      v_c := public.portal__offboard_company(r.client_id, v_req, v_chosen, v_kind,
               CASE WHEN v_kind = 'titular' THEN v_p END, true, 'baja_titular');
    ELSIF r.relation = 'orphaned' THEN
      v_c := public.portal__offboard_company(r.client_id, v_req, v_def, 'omision', NULL, true, 'sin_personas_activas');
    ELSE
      v_c := NULL;
      IF public.portal_client_retention_years(r.client_id) > v_acc_years THEN
        v_acc_years := public.portal_client_retention_years(r.client_id);
        v_acc_kind := 'kawiil';
      END IF;
    END IF;
    IF v_c IS NOT NULL THEN
      v_counts := v_counts || jsonb_build_object(
        'csd_destruidos', COALESCE((v_counts->>'csd_destruidos')::int, 0) + (v_c->>'csd_destruidos')::int,
        'hilos_eliminados', COALESCE((v_counts->>'hilos_eliminados')::int, 0) + (v_c->>'hilos_eliminados')::int,
        'tickets_eliminados', COALESCE((v_counts->>'tickets_eliminados')::int, 0) + (v_c->>'tickets_eliminados')::int,
        'documentos_eliminados', COALESCE((v_counts->>'documentos_eliminados')::int, 0) + (v_c->>'documentos_eliminados')::int,
        'empresas_dadas_de_baja', COALESCE((v_counts->>'empresas_dadas_de_baja')::int, 0) + 1);
    END IF;
  END LOOP;

  -- Membresías (en una empresa que sigue activa, la empresa y su CSD no se tocan).
  DELETE FROM public.portal_memberships WHERE user_id = _uid;
  n := public.portal_pseudonymize_subject(_uid, v_email, v_req);
  UPDATE public.portal_cfdi SET category_confirmed_by = v_p WHERE category_confirmed_by = _uid;
  v_counts := v_counts || jsonb_build_object('bitacora_seudonimizada', n);

  -- Constancias legales en resguardo (una sola vez aunque la baja se reintente).
  IF v_owned AND v_chosen > v_acc_years THEN v_acc_years := v_chosen; v_acc_kind := v_kind; END IF;
  IF v_owned AND v_chosen = v_acc_years AND v_acc_kind = 'omision' THEN v_acc_kind := v_kind; END IF;
  IF EXISTS (SELECT 1 FROM public.portal_legal_acceptances WHERE user_id = v_p)
     AND NOT EXISTS (SELECT 1 FROM public.portal_retention_holds
                      WHERE subject = 'aceptaciones' AND subject_pseudonym = v_p AND purged_at IS NULL AND cancelled_at IS NULL) THEN
    PERFORM public.portal__retention_open(NULL, v_p, v_req, v_acc_years, v_acc_kind,
      CASE WHEN v_acc_kind = 'titular' THEN v_p END, ARRAY['aceptaciones'], 'baja_persona');
  END IF;

  UPDATE public.portal_deletion_requests SET result = v_counts WHERE id = v_req;
  RETURN jsonb_build_object('request_id', v_req, 'bloqueada', false, 'result', v_counts);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_execute_account_deletion(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_execute_account_deletion(uuid, int) TO service_role;

-- ── Verificación posterior a una baja (criterio de B2) ──────────────
-- Devuelve {ok, hallazgos[]}. Cada hallazgo es algo que NO debería existir.
CREATE OR REPLACE FUNCTION public.portal_offboarding_verify(
  _client_id uuid DEFAULT NULL, _subject uuid DEFAULT NULL, _email text DEFAULT NULL, _all_memberships boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_h jsonb := '[]'::jsonb;
  v_org uuid;
  v_pfx text; v_jpfx text;
  n bigint;
BEGIN
  IF _client_id IS NOT NULL THEN
    SELECT organization_id INTO v_org FROM public.clients WHERE id = _client_id;
    v_pfx := v_org || '/' || _client_id || '/';
    v_jpfx := v_org || '/juun/clients/' || _client_id || '/';
    SELECT count(*) INTO n FROM public.client_sat_certificates WHERE client_id = _client_id AND cert_type = 'csd_sello';
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'certificado_de_sello', 'cantidad', n); END IF;
    SELECT count(*) INTO n FROM public.portal_csd_registry WHERE client_id = _client_id;
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'registro_csd', 'cantidad', n); END IF;
    SELECT count(*) INTO n FROM public.portal_csd_secrets s JOIN public.client_sat_certificates c ON c.id = s.certificate_id
     WHERE c.client_id = _client_id;
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'contrasena_de_llave', 'cantidad', n); END IF;
    SELECT count(*) INTO n FROM public.portal_client_settings WHERE client_id = _client_id AND emission_enabled;
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'emision_encendida', 'cantidad', n); END IF;
    SELECT count(*) INTO n FROM public.portal_memberships m JOIN public.portal_accounts a ON a.user_id = m.user_id
     WHERE m.client_id = _client_id AND (_all_memberships OR (m.status = 'activa' AND a.status = 'activa'));
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', CASE WHEN _all_memberships THEN 'accesos' ELSE 'accesos_activos' END, 'cantidad', n); END IF;
    SELECT count(*) INTO n FROM public.portal_message_attachments WHERE client_id = _client_id;
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'adjuntos', 'cantidad', n); END IF;
    SELECT count(*) INTO n FROM public.portal_threads WHERE client_id = _client_id;
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'mensajes', 'cantidad', n); END IF;
    SELECT count(*) INTO n FROM public.fis_receipts WHERE client_id = _client_id AND status <> 'invoiced';
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'tickets_no_facturados', 'cantidad', n); END IF;
    SELECT count(*) INTO n FROM public.portal_documents WHERE client_id = _client_id;
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'documentos_publicados', 'cantidad', n); END IF;
    -- Storage: nada de la empresa salvo los archivos de lo resguardado.
    SELECT count(*) INTO n FROM storage.objects o
     WHERE o.bucket_id = 'portal' AND o.name LIKE v_pfx || '%'
       AND NOT EXISTS (SELECT 1 FROM public.portal_cfdi c WHERE c.client_id = _client_id AND o.name IN (c.xml_path, c.pdf_path));
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'archivos_en_storage', 'cantidad', n); END IF;
    SELECT count(*) INTO n FROM storage.objects o
     WHERE o.bucket_id = 'juun' AND o.name LIKE v_jpfx || '%'
       AND NOT EXISTS (SELECT 1 FROM public.fis_receipts f LEFT JOIN public.fis_cfdi c ON c.receipt_id = f.id
                        WHERE f.client_id = _client_id AND f.status = 'invoiced' AND o.name IN (f.file_path, c.xml_path, c.pdf_path));
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'tickets_en_storage', 'cantidad', n); END IF;
    SELECT count(*) INTO n FROM public.portal_storage_purge_queue q
     WHERE q.done_at IS NULL AND (q.path LIKE v_pfx || '%' OR q.path LIKE v_jpfx || '%') AND q.reason = 'baja';
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'archivos_pendientes_de_borrar', 'cantidad', n); END IF;
    -- Lo resguardado no identifica a personas del portal.
    SELECT count(*) INTO n FROM public.portal_cfdi c
     WHERE c.client_id = _client_id AND (c.created_by IN (SELECT user_id FROM public.portal_accounts)
                                         OR c.category_confirmed_by IN (SELECT user_id FROM public.portal_accounts));
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'resguardo_con_personas', 'cantidad', n); END IF;
  END IF;

  IF _subject IS NOT NULL THEN
    SELECT count(*) INTO n FROM auth.users WHERE id = _subject;
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'usuario_de_acceso', 'cantidad', n); END IF;
    IF to_regclass('auth.sessions') IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM auth.sessions WHERE user_id = $1' INTO n USING _subject;
      IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'sesiones', 'cantidad', n); END IF;
    END IF;
    IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM auth.refresh_tokens WHERE user_id = $1::text' INTO n USING _subject;
      IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'tokens', 'cantidad', n); END IF;
    END IF;
    IF to_regclass('auth.one_time_tokens') IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM auth.one_time_tokens WHERE user_id = $1' INTO n USING _subject;
      IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'enlaces_pendientes', 'cantidad', n); END IF;
    END IF;
    SELECT count(*) INTO n FROM public.portal_accounts WHERE user_id = _subject;
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'cuenta_del_portal', 'cantidad', n); END IF;
    SELECT count(*) INTO n FROM public.portal_memberships WHERE user_id = _subject;
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'membresias', 'cantidad', n); END IF;
    SELECT count(*) INTO n FROM public.portal_audit_log
     WHERE actor_user_id = _subject OR entity_id = _subject::text OR details->>'user_id' = _subject::text;
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'bitacora_identificable', 'cantidad', n); END IF;
    SELECT count(*) INTO n FROM public.portal_legal_acceptances WHERE user_id = _subject;
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'aceptaciones_identificables', 'cantidad', n); END IF;
    SELECT count(*) INTO n FROM public.portal_messages WHERE author_user_id = _subject;
    IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'mensajes_identificables', 'cantidad', n); END IF;
    IF _email IS NOT NULL THEN
      SELECT count(*) INTO n FROM public.portal_audit_log WHERE lower(actor_email) = lower(_email) OR lower(details->>'email') = lower(_email);
      IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'correo_en_bitacora', 'cantidad', n); END IF;
      SELECT count(*) INTO n FROM public.portal_legal_acceptances WHERE lower(user_email) = lower(_email);
      IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'correo_en_aceptaciones', 'cantidad', n); END IF;
      SELECT count(*) INTO n FROM public.portal_outbox WHERE payload->'to' ? _email OR payload->>'to' = _email;
      IF n > 0 THEN v_h := v_h || jsonb_build_object('hallazgo', 'correos_pendientes', 'cantidad', n); END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', jsonb_array_length(v_h) = 0, 'hallazgos', v_h);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_offboarding_verify(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_offboarding_verify(uuid, uuid, text, boolean) TO service_role;

-- Corre la verificación de una solicitud y la deja registrada (sin datos personales).
CREATE OR REPLACE FUNCTION public.portal_offboarding_record_verification(_request_id uuid, _subject uuid DEFAULT NULL, _email text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_all boolean;
  v_persona jsonb;
  v_empresas jsonb := '[]'::jsonb;
  v_ok boolean := true;
  c uuid;
  v jsonb;
BEGIN
  SELECT COALESCE(plan->>'tipo', 'persona') = 'empresa' INTO v_all FROM public.portal_deletion_requests WHERE id = _request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud inexistente'; END IF;
  IF _subject IS NOT NULL THEN
    v_persona := public.portal_offboarding_verify(NULL, _subject, _email);
    v_ok := v_ok AND (v_persona->>'ok')::boolean;
  END IF;
  FOR c IN SELECT client_id FROM public.portal_client_settings WHERE offboard_request_id = _request_id LOOP
    v := public.portal_offboarding_verify(c, NULL, NULL, v_all);
    v_empresas := v_empresas || (jsonb_build_object('client_id', c) || v);
    v_ok := v_ok AND (v->>'ok')::boolean;
  END LOOP;
  v := jsonb_build_object('ok', v_ok, 'persona', v_persona, 'empresas', v_empresas, 'verificado_en', now());
  UPDATE public.portal_deletion_requests SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('verificacion', v)
   WHERE id = _request_id;
  PERFORM public.portal_audit('baja_verificacion', NULL, 'portal_deletion_requests', _request_id::text,
    jsonb_build_object('ok', v_ok, 'empresas', jsonb_array_length(v_empresas),
                       'hallazgos', COALESCE(jsonb_array_length(v_persona->'hallazgos'), 0)
                                    + (SELECT COALESCE(sum(jsonb_array_length(e->'hallazgos')), 0) FROM jsonb_array_elements(v_empresas) e)), NULL);
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_offboarding_record_verification(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_offboarding_record_verification(uuid, uuid, text) TO service_role;

-- Marca como borrados los archivos de una solicitud (portal-api lo llama tras Storage.remove).
CREATE OR REPLACE FUNCTION public.portal_purge_queue_done(_ids bigint[], _error text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_temp, public
AS $$
  UPDATE public.portal_storage_purge_queue
     SET done_at = CASE WHEN _error IS NULL THEN now() END, error = left(_error, 300)
   WHERE id = ANY(_ids)
$$;
REVOKE ALL ON FUNCTION public.portal_purge_queue_done(bigint[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_purge_queue_done(bigint[], text) TO service_role;

-- ── B3: si la empresa vuelve a tener una persona activa, deja de estar de baja ──
-- (La emisión sigue apagada y no hay CSD: hay que cargarlo de nuevo, con toda la
-- validación y la autorización previa de siempre.)
CREATE OR REPLACE FUNCTION public.portal_memberships_offboard_reactivation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE n int;
BEGIN
  IF NEW.status = 'activa' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'activa')
     AND EXISTS (SELECT 1 FROM public.portal_client_settings WHERE client_id = NEW.client_id AND offboarded_at IS NOT NULL) THEN
    UPDATE public.portal_client_settings SET offboarded_at = NULL, offboard_request_id = NULL WHERE client_id = NEW.client_id;
    UPDATE public.portal_retention_holds SET cancelled_at = now(), cancel_reason = 'empresa_reactivada'
     WHERE client_id = NEW.client_id AND subject <> 'aceptaciones' AND purged_at IS NULL AND cancelled_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM public.portal_audit('resguardo_cancelado', NEW.client_id, 'portal_client_settings', NEW.client_id::text,
      jsonb_build_object('motivo', 'empresa_reactivada', 'resguardos', n));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_memberships_offboard_reactivation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_portal_memberships_offboard_reactivation ON public.portal_memberships;
CREATE TRIGGER trg_portal_memberships_offboard_reactivation
  AFTER INSERT OR UPDATE OF status ON public.portal_memberships
  FOR EACH ROW EXECUTE FUNCTION public.portal_memberships_offboard_reactivation();
