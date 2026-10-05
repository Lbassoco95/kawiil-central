-- 2026-09-28 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260929120500_portal_offboarding.sql (B2/B3).
-- Correr DESPUÉS del de 20260929120600 y ANTES del de 20260929120400.
-- Vuelve a las funciones de baja de 20260929120200 (copiadas tal cual abajo).
-- No revierte bajas ya ejecutadas (lo destruido no vuelve).
DROP TRIGGER IF EXISTS trg_portal_memberships_offboard_reactivation ON public.portal_memberships;
DROP FUNCTION IF EXISTS public.portal_memberships_offboard_reactivation();
DROP FUNCTION IF EXISTS public.portal_purge_queue_done(bigint[], text);
DROP FUNCTION IF EXISTS public.portal_offboarding_record_verification(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.portal_offboarding_verify(uuid, uuid, text, boolean);
DROP FUNCTION IF EXISTS public.portal_execute_account_deletion(uuid, int);
DROP FUNCTION IF EXISTS public.portal__offboard_company(uuid, uuid, int, text, uuid, boolean, text);
DROP FUNCTION IF EXISTS public.portal__scrub_client_refs(uuid);

CREATE OR REPLACE FUNCTION public.portal_deletion_scope(_uid uuid)
RETURNS TABLE (client_id uuid, client_name text, relation text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT m.client_id, c.name,
    CASE
      WHEN COALESCE(s.origin, 'kawiil') = 'basico' AND m.created_by = _uid
           AND NOT EXISTS (SELECT 1 FROM public.portal_memberships o
                            WHERE o.client_id = m.client_id AND o.user_id <> _uid)
        THEN 'owned'
      WHEN COALESCE(s.origin, 'kawiil') = 'basico' AND m.created_by = _uid
           AND NOT EXISTS (SELECT 1 FROM public.portal_memberships o
                            WHERE o.client_id = m.client_id AND o.user_id <> _uid AND o.status = 'activa')
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

DROP FUNCTION IF EXISTS public.portal__active_people(uuid, uuid);

CREATE OR REPLACE FUNCTION public.portal_account_deletion_plan(_uid uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_uid uuid := COALESCE(_uid, auth.uid());
  v_years int := public.portal_retention_years();
  v_confirmed boolean;
  v_elimina jsonb := '[]'::jsonb;
  v_conserva jsonb := '[]'::jsonb;
  v_bloqueos jsonb := '[]'::jsonb;
  r record;
  n_csd int; n_threads int; n_msgs int; n_att int; n_tk_open int; n_cfdi int; n_tk_done int; n_msgs_company int;
BEGIN
  IF auth.uid() IS NOT NULL AND v_uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_accounts WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Solo cuentas del portal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT confirmed INTO v_confirmed FROM public.portal_retention_policy WHERE key = 'fiscal_retention_years';

  v_elimina := v_elimina || jsonb_build_object('key', 'acceso', 'label', 'Su acceso al portal y su perfil',
    'detalle', 'Correo, nombre y contraseña. Se cierra la sesión en todos sus dispositivos.', 'cantidad', 1);

  FOR r IN SELECT * FROM public.portal_deletion_scope(v_uid) LOOP
    IF r.relation = 'owned' THEN
      SELECT count(*) INTO n_csd FROM public.client_sat_certificates WHERE client_id = r.client_id AND cert_type = 'csd_sello';
      SELECT count(*) INTO n_threads FROM public.portal_threads WHERE client_id = r.client_id;
      SELECT count(*) INTO n_msgs FROM public.portal_messages WHERE client_id = r.client_id;
      SELECT count(*) INTO n_att FROM public.portal_message_attachments WHERE client_id = r.client_id;
      SELECT count(*) INTO n_tk_open FROM public.fis_receipts WHERE client_id = r.client_id AND status <> 'invoiced';
      SELECT count(*) INTO n_cfdi FROM public.portal_cfdi WHERE client_id = r.client_id;
      SELECT count(*) INTO n_tk_done FROM public.fis_receipts WHERE client_id = r.client_id AND status = 'invoiced';
      v_elimina := v_elimina
        || jsonb_build_object('key', 'csd', 'client', r.client_name, 'cantidad', n_csd,
             'label', 'Certificado de sello digital, llave y contraseña',
             'detalle', 'Se destruyen de inmediato y se revoca la emisión.')
        || jsonb_build_object('key', 'mensajes', 'client', r.client_name, 'cantidad', n_msgs,
             'label', 'Mensajes y adjuntos', 'detalle', format('%s conversaciones, %s mensajes, %s adjuntos.', n_threads, n_msgs, n_att))
        || jsonb_build_object('key', 'tickets_no_facturados', 'client', r.client_name, 'cantidad', n_tk_open,
             'label', 'Tickets aún no facturados', 'detalle', 'Fotos y datos capturados.');
      v_conserva := v_conserva
        || jsonb_build_object('key', 'cfdi', 'client', r.client_name, 'cantidad', n_cfdi,
             'label', 'Facturas (CFDI) emitidas y recibidas', 'anios', v_years,
             'hasta', (now() + make_interval(years => v_years))::date,
             'detalle', 'Por el plazo de conservación fiscal; después se purgan automáticamente.')
        || jsonb_build_object('key', 'tickets_facturados', 'client', r.client_name, 'cantidad', n_tk_done,
             'label', 'Tickets ya facturados (y su factura)', 'anios', v_years,
             'hasta', (now() + make_interval(years => v_years))::date,
             'detalle', 'Por el plazo de conservación fiscal; después se purgan automáticamente.');
    ELSIF r.relation = 'sole_admin' THEN
      v_bloqueos := v_bloqueos || jsonb_build_object('client_id', r.client_id, 'client', r.client_name,
        'motivo', 'Usted es la única persona administradora de esta empresa en el portal. Designe a otra administradora o escriba a Kawiil antes de eliminar su cuenta.');
    ELSE
      SELECT count(*) INTO n_msgs_company FROM public.portal_messages WHERE client_id = r.client_id AND author_user_id = v_uid;
      v_elimina := v_elimina || jsonb_build_object('key', 'membresia', 'client', r.client_name, 'cantidad', 1,
        'label', 'Su acceso a la empresa', 'detalle', 'Se retira su membresía.');
      v_conserva := v_conserva || jsonb_build_object('key', 'datos_empresa', 'client', r.client_name, 'cantidad', n_msgs_company,
        'label', 'Facturas, documentos, CSD y conversaciones de la empresa',
        'detalle', 'Pertenecen a la empresa, no a la persona. En los mensajes que usted escribió su nombre se sustituye por «Usuario eliminado».');
    END IF;
  END LOOP;

  v_conserva := v_conserva
    || jsonb_build_object('key', 'bitacora', 'cantidad', (SELECT count(*) FROM public.portal_audit_log WHERE actor_user_id = v_uid),
         'label', 'Bitácora de actividad', 'detalle', 'Se conservan los hechos (qué, cuándo, sobre qué empresa); su nombre, correo e identificador se sustituyen por un seudónimo.')
    || jsonb_build_object('key', 'aceptaciones', 'cantidad', (SELECT count(*) FROM public.portal_legal_acceptances WHERE user_id = v_uid),
         'label', 'Constancia de aceptación de textos legales', 'detalle', 'Se conserva la versión y la fecha, con su identidad seudonimizada.');

  RETURN jsonb_build_object(
    'bloqueada', jsonb_array_length(v_bloqueos) > 0,
    'bloqueos', v_bloqueos,
    'elimina', v_elimina,
    'conserva', v_conserva,
    'politica', jsonb_build_object('fiscal_retention_years', v_years, 'confirmada', COALESCE(v_confirmed, false))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.portal_account_deletion_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_account_deletion_plan(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.portal_execute_account_deletion(_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_plan jsonb := public.portal_account_deletion_plan(_uid);
  v_email text;
  v_req uuid;
  v_years int := public.portal_retention_years();
  r record;
  v_counts jsonb := '{}'::jsonb;
  n int;
BEGIN
  SELECT email INTO v_email FROM public.portal_accounts WHERE user_id = _uid;
  IF (v_plan->>'bloqueada')::boolean THEN
    INSERT INTO public.portal_deletion_requests (subject_pseudonym, status, plan)
    VALUES (public.portal_pseudonym_uuid(_uid), 'bloqueada', v_plan) RETURNING id INTO v_req;
    PERFORM public.portal_audit('cuenta_eliminacion_bloqueada', NULL, 'portal_deletion_requests', v_req::text,
      jsonb_build_object('empresas', jsonb_array_length(v_plan->'bloqueos')), _uid);
    RETURN jsonb_build_object('request_id', v_req, 'bloqueada', true, 'bloqueos', v_plan->'bloqueos');
  END IF;

  INSERT INTO public.portal_deletion_requests (subject_pseudonym, status, plan)
  VALUES (public.portal_pseudonym_uuid(_uid), 'en_proceso', v_plan) RETURNING id INTO v_req;
  PERFORM public.portal_audit('cuenta_eliminacion_solicitud', NULL, 'portal_deletion_requests', v_req::text,
    jsonb_build_object('elimina', jsonb_array_length(v_plan->'elimina'), 'conserva', jsonb_array_length(v_plan->'conserva')), _uid);

  FOR r IN SELECT s.client_id, c.organization_id FROM public.portal_deletion_scope(_uid) s
             JOIN public.clients c ON c.id = s.client_id WHERE s.relation = 'owned' LOOP
    -- CSD, llave y contraseña: se destruyen siempre (cascada a registro y contraseña).
    DELETE FROM public.client_sat_certificates WHERE client_id = r.client_id AND cert_type = 'csd_sello';
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE public.portal_client_settings SET emission_enabled = false, emission_changed_at = now() WHERE client_id = r.client_id;
    PERFORM public.portal_audit('csd_destruccion', r.client_id, 'client_sat_certificates', NULL,
      jsonb_build_object('certificados', n, 'solicitud', v_req), NULL);
    v_counts := v_counts || jsonb_build_object('csd_destruidos', COALESCE((v_counts->>'csd_destruidos')::int, 0) + n);

    -- Mensajes y adjuntos (los archivos van a la cola de borrado).
    INSERT INTO public.portal_storage_purge_queue (bucket, path, reason)
    SELECT 'portal', a.storage_path, 'cuenta_eliminada' FROM public.portal_message_attachments a WHERE a.client_id = r.client_id;
    DELETE FROM public.portal_threads WHERE client_id = r.client_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('hilos_eliminados', COALESCE((v_counts->>'hilos_eliminados')::int, 0) + n);

    -- Tickets aún no facturados.
    INSERT INTO public.portal_storage_purge_queue (bucket, path, reason)
    SELECT 'juun', f.file_path, 'cuenta_eliminada' FROM public.fis_receipts f WHERE f.client_id = r.client_id AND f.status <> 'invoiced';
    DELETE FROM public.fis_receipts WHERE client_id = r.client_id AND status <> 'invoiced';
    GET DIAGNOSTICS n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('tickets_eliminados', COALESCE((v_counts->>'tickets_eliminados')::int, 0) + n);

    -- CFDI y tickets facturados: retención con fecha de purga.
    INSERT INTO public.portal_retention_holds (organization_id, client_id, subject, retain_until, deletion_request_id)
    VALUES (r.organization_id, r.client_id, 'cfdi', now() + make_interval(years => v_years), v_req),
           (r.organization_id, r.client_id, 'tickets_facturados', now() + make_interval(years => v_years), v_req);
  END LOOP;

  -- Membresías (en premier la empresa y su CSD no se tocan).
  DELETE FROM public.portal_memberships WHERE user_id = _uid;
  n := public.portal_pseudonymize_subject(_uid, v_email, v_req);
  v_counts := v_counts || jsonb_build_object('bitacora_seudonimizada', n);

  UPDATE public.portal_deletion_requests SET result = v_counts WHERE id = v_req;
  RETURN jsonb_build_object('request_id', v_req, 'bloqueada', false, 'result', v_counts);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_execute_account_deletion(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_execute_account_deletion(uuid) TO service_role;

DROP INDEX IF EXISTS public.idx_portal_purge_queue_request;
ALTER TABLE public.portal_storage_purge_queue DROP COLUMN IF EXISTS deletion_request_id;
ALTER TABLE public.portal_client_settings DROP COLUMN IF EXISTS offboard_request_id, DROP COLUMN IF EXISTS offboarded_at;
