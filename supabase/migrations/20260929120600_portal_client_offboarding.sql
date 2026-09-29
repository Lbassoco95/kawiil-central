-- =================================================================
-- Portal del cliente — B4: baja de un cliente premier desde central.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-28
-- Rollback (a mano): migrations/2026-09-28_portal_client_offboarding.rollback.sql
-- Depende de 20260929120400 (plazos) y 20260929120500 (baja de empresa).
--
-- Una sola acción registrada, solo G3/G4 de la organización del cliente, con doble
-- confirmación (escribir «DAR DE BAJA» y el RFC del cliente). La ejecuta portal-api
-- con service_role porque además borra usuarios de Auth; la base vuelve a comprobar
-- el rol del actor y las dos confirmaciones (defensa en profundidad).
--   · Se eliminan los accesos de todas las personas del cliente. Quien además tiene
--     acceso a OTRA empresa conserva su cuenta y pierde solo el de esta.
--   · CSD, llave y contraseña destruidos; emisión apagada (B2).
--   · Resguardo con el plazo del cliente (B1).
--   · Solicitud (con el plan mostrado) y ejecución quedan registradas.
-- =================================================================

ALTER TABLE public.portal_deletion_requests
  ALTER COLUMN subject_pseudonym DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_by uuid;
ALTER TABLE public.portal_deletion_requests DROP CONSTRAINT IF EXISTS portal_deletion_requests_status_check;
ALTER TABLE public.portal_deletion_requests ADD CONSTRAINT portal_deletion_requests_status_check
  CHECK (status IN ('bloqueada', 'rechazada', 'en_proceso', 'ejecutada', 'error'));
COMMENT ON COLUMN public.portal_deletion_requests.requested_by IS
  'Baja de un cliente (B4): integrante del equipo (G3/G4) que la pidió. Baja de una persona: NULL (la persona va seudonimizada en subject_pseudonym).';

-- Cuentas cuyo usuario de Auth falta borrar (para reintentar si Auth falla).
ALTER TABLE public.portal_accounts
  ADD COLUMN IF NOT EXISTS pending_deletion_request_id uuid REFERENCES public.portal_deletion_requests(id) ON DELETE SET NULL;

-- ── Plan (lo que muestra central antes de confirmar) ────────────────
CREATE OR REPLACE FUNCTION public.portal_client_offboarding_plan(_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_c public.clients;
  v_s public.portal_client_settings;
  v_years int := public.portal_client_retention_years(_client_id);
  v_bloqueos jsonb := '[]'::jsonb;
  v_personas jsonb;
  n_csd int; n_threads int; n_msgs int; n_att int; n_tk_open int; n_docs int; n_cfdi int; n_tk_done int; n_acc int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (public.portal_is_staff_admin(auth.uid()) AND public.portal_staff_in_client_org(auth.uid(), _client_id)) THEN
    RAISE EXCEPTION 'Solo G3/G4 de la organización del cliente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_c FROM public.clients WHERE id = _client_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente inexistente'; END IF;
  SELECT * INTO v_s FROM public.portal_client_settings WHERE client_id = _client_id;
  IF COALESCE(v_s.origin, 'kawiil') = 'basico' THEN
    v_bloqueos := v_bloqueos || jsonb_build_object('motivo', 'Un cliente del nivel básico se da de baja cuando lo hace su titular desde el portal.');
  END IF;
  IF v_s.offboarded_at IS NOT NULL THEN
    v_bloqueos := v_bloqueos || jsonb_build_object('motivo', format('Este cliente ya se dio de baja del portal el %s.', v_s.offboarded_at::date));
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'nombre', a.full_name, 'correo', a.email, 'rol', m.role, 'estado', m.status,
           'otras_empresas', (SELECT count(*) FROM public.portal_memberships o WHERE o.user_id = m.user_id AND o.client_id <> _client_id),
           'se_elimina_la_cuenta', NOT EXISTS (SELECT 1 FROM public.portal_memberships o WHERE o.user_id = m.user_id AND o.client_id <> _client_id))
           ORDER BY a.full_name), '[]'::jsonb)
    INTO v_personas
    FROM public.portal_memberships m JOIN public.portal_accounts a ON a.user_id = m.user_id
   WHERE m.client_id = _client_id;

  SELECT count(*) INTO n_csd FROM public.client_sat_certificates WHERE client_id = _client_id AND cert_type = 'csd_sello';
  SELECT count(*) INTO n_threads FROM public.portal_threads WHERE client_id = _client_id;
  SELECT count(*) INTO n_msgs FROM public.portal_messages WHERE client_id = _client_id;
  SELECT count(*) INTO n_att FROM public.portal_message_attachments WHERE client_id = _client_id;
  SELECT count(*) INTO n_tk_open FROM public.fis_receipts WHERE client_id = _client_id AND status <> 'invoiced';
  SELECT count(*) INTO n_docs FROM public.portal_documents WHERE client_id = _client_id;
  SELECT count(*) INTO n_cfdi FROM public.portal_cfdi WHERE client_id = _client_id;
  SELECT count(*) INTO n_tk_done FROM public.fis_receipts WHERE client_id = _client_id AND status = 'invoiced';
  SELECT count(*) INTO n_acc FROM public.portal_legal_acceptances l
   WHERE l.user_id IN (SELECT m.user_id FROM public.portal_memberships m WHERE m.client_id = _client_id
                        AND NOT EXISTS (SELECT 1 FROM public.portal_memberships o WHERE o.user_id = m.user_id AND o.client_id <> _client_id));

  RETURN jsonb_build_object(
    'cliente', jsonb_build_object('id', v_c.id, 'nombre', v_c.name, 'rfc', v_c.rfc),
    'bloqueada', jsonb_array_length(v_bloqueos) > 0,
    'bloqueos', v_bloqueos,
    'personas', v_personas,
    'elimina', jsonb_build_array(
      jsonb_build_object('key', 'accesos', 'label', 'Accesos al portal de todas las personas del cliente', 'cantidad', jsonb_array_length(v_personas),
        'detalle', 'Usuario, contraseña, sesiones e invitaciones pendientes. Quien tenga acceso a otra empresa conserva su cuenta y pierde solo el de esta.'),
      jsonb_build_object('key', 'csd', 'label', 'Certificado de sello digital, llave y contraseña de la llave', 'cantidad', n_csd,
        'detalle', 'Se destruyen de inmediato. La emisión se apaga y se revoca.'),
      jsonb_build_object('key', 'mensajes', 'label', 'Mensajes y adjuntos del portal', 'cantidad', n_msgs,
        'detalle', format('%s conversaciones, %s mensajes, %s adjuntos.', n_threads, n_msgs, n_att)),
      jsonb_build_object('key', 'tickets_no_facturados', 'label', 'Tickets aún no facturados', 'cantidad', n_tk_open),
      jsonb_build_object('key', 'documentos', 'label', 'Documentos publicados en el portal', 'cantidad', n_docs,
        'detalle', 'Se retiran del portal y se detiene su sincronización. El archivo de Kawiil no se toca.')),
    'conserva', jsonb_build_array(
      jsonb_build_object('key', 'cfdi', 'label', 'Facturas (CFDI) emitidas y recibidas', 'cantidad', n_cfdi),
      jsonb_build_object('key', 'tickets_facturados', 'label', 'Tickets ya facturados, con su factura', 'cantidad', n_tk_done),
      jsonb_build_object('key', 'aceptaciones', 'label', 'Constancias de aceptación de textos legales (identidad seudonimizada)', 'cantidad', n_acc)),
    'resguardo', jsonb_build_object('anios', v_years, 'hasta', (now() + make_interval(years => v_years))::date,
      'fijado_por', CASE WHEN v_s.retention_years IS NOT NULL THEN 'kawiil' ELSE 'omision' END,
      'para', 'Cumplir la obligación de conservar los comprobantes fiscales y la contabilidad; acreditar el consentimiento otorgado.'),
    'confirmacion', jsonb_build_object('palabra', 'DAR DE BAJA', 'dato', CASE WHEN v_c.rfc IS NOT NULL THEN 'rfc' ELSE 'nombre' END)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.portal_client_offboarding_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_client_offboarding_plan(uuid) TO authenticated, service_role;

-- ── Ejecución (solo service_role: portal-api después borra los usuarios de Auth) ──
CREATE OR REPLACE FUNCTION public.portal_client_offboarding_execute(
  _client_id uuid, _actor uuid, _confirmacion text, _dato text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_c public.clients;
  v_plan jsonb;
  v_motivo text;
  v_req uuid;
  v_years int := public.portal_client_retention_years(_client_id);
  v_kind text;
  v_by uuid;
  v_users uuid[] := '{}';
  v_keep int := 0;
  v_company jsonb;
  v_email text;
  v_p uuid;
  p record;
BEGIN
  SELECT * INTO v_c FROM public.clients WHERE id = _client_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente inexistente'; END IF;

  IF _actor IS NULL OR NOT (public.portal_is_staff_admin(_actor) AND public.portal_staff_in_client_org(_actor, _client_id)) THEN
    v_motivo := 'sin_rol';
  ELSE
    v_plan := public.portal_client_offboarding_plan(_client_id);
    IF (v_plan->>'bloqueada')::boolean THEN
      v_motivo := 'bloqueada';
    ELSIF COALESCE(btrim(_confirmacion), '') <> 'DAR DE BAJA' THEN
      v_motivo := 'confirmacion';
    ELSIF upper(regexp_replace(COALESCE(_dato, ''), '\s', '', 'g'))
          <> upper(regexp_replace(COALESCE(v_c.rfc, v_c.name), '\s', '', 'g')) THEN
      v_motivo := 'dato_no_coincide';
    END IF;
  END IF;
  IF v_motivo IS NOT NULL THEN
    INSERT INTO public.portal_deletion_requests (client_id, requested_by, status, plan, error)
    VALUES (_client_id, _actor, 'rechazada', jsonb_build_object('tipo', 'empresa', 'motivo', v_motivo), v_motivo)
    RETURNING id INTO v_req;
    PERFORM public.portal_audit('cliente_baja_rechazada', _client_id, 'portal_deletion_requests', v_req::text,
      jsonb_build_object('motivo', v_motivo), _actor);
    RETURN jsonb_build_object('rechazada', true, 'motivo', v_motivo, 'request_id', v_req,
                              'bloqueos', CASE WHEN v_motivo = 'bloqueada' THEN v_plan->'bloqueos' END);
  END IF;

  INSERT INTO public.portal_deletion_requests (client_id, requested_by, status, plan)
  VALUES (_client_id, _actor, 'en_proceso', v_plan - 'personas' || jsonb_build_object('tipo', 'empresa',
          'personas', jsonb_array_length(v_plan->'personas')))
  RETURNING id INTO v_req;
  PERFORM public.portal_audit('cliente_baja_solicitud', _client_id, 'portal_deletion_requests', v_req::text,
    jsonb_build_object('personas', jsonb_array_length(v_plan->'personas'), 'resguardo_anios', v_years), _actor);

  SELECT CASE WHEN retention_years IS NOT NULL THEN 'kawiil' ELSE 'omision' END,
         CASE WHEN retention_years IS NOT NULL THEN retention_years_set_by END
    INTO v_kind, v_by FROM public.portal_client_settings WHERE client_id = _client_id;
  v_kind := COALESCE(v_kind, 'omision');

  -- 1. La empresa: CSD, mensajes, tickets sin facturar, documentos; resguardo fiscal.
  v_company := public.portal__offboard_company(_client_id, v_req, v_years, v_kind, v_by, false, 'fin_de_servicio');

  -- 2. Las personas.
  FOR p IN SELECT m.id, m.user_id FROM public.portal_memberships m WHERE m.client_id = _client_id LOOP
    DELETE FROM public.portal_memberships WHERE id = p.id;
    IF EXISTS (SELECT 1 FROM public.portal_memberships o WHERE o.user_id = p.user_id) THEN
      v_keep := v_keep + 1;
      CONTINUE;
    END IF;
    SELECT email INTO v_email FROM public.portal_accounts WHERE user_id = p.user_id;
    v_p := public.portal_pseudonym_uuid(p.user_id);
    UPDATE public.portal_accounts SET status = 'suspendida', suspended_at = now(), suspended_by = _actor,
                                      pending_deletion_request_id = v_req
     WHERE user_id = p.user_id;
    PERFORM public.portal_pseudonymize_subject(p.user_id, v_email, v_req);
    UPDATE public.portal_cfdi SET category_confirmed_by = v_p WHERE category_confirmed_by = p.user_id;
    IF EXISTS (SELECT 1 FROM public.portal_legal_acceptances WHERE user_id = v_p)
       AND NOT EXISTS (SELECT 1 FROM public.portal_retention_holds
                        WHERE subject = 'aceptaciones' AND subject_pseudonym = v_p AND purged_at IS NULL AND cancelled_at IS NULL) THEN
      PERFORM public.portal__retention_open(_client_id, v_p, v_req, v_years, v_kind, v_by, ARRAY['aceptaciones'], 'fin_de_servicio');
    END IF;
    v_users := v_users || p.user_id;
  END LOOP;

  v_company := v_company || jsonb_build_object('cuentas_eliminadas', cardinality(v_users), 'personas_con_otra_empresa', v_keep);
  UPDATE public.portal_deletion_requests SET result = v_company WHERE id = v_req;
  PERFORM public.portal_audit('cliente_baja', _client_id, 'portal_deletion_requests', v_req::text, v_company, _actor);
  RETURN jsonb_build_object('request_id', v_req, 'rechazada', false, 'usuarios', to_jsonb(v_users), 'result', v_company);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_client_offboarding_execute(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_client_offboarding_execute(uuid, uuid, text, text) TO service_role;

-- Usuarios de Auth que faltan por borrar de una baja (reintento).
CREATE OR REPLACE FUNCTION public.portal_client_offboarding_pending(_request_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_temp, public
AS $$ SELECT COALESCE(array_agg(user_id), '{}') FROM public.portal_accounts WHERE pending_deletion_request_id = _request_id $$;
REVOKE ALL ON FUNCTION public.portal_client_offboarding_pending(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_client_offboarding_pending(uuid) TO service_role;

-- Cierre: ejecutada si ya no queda ningún usuario por borrar; si no, error (se puede reintentar).
CREATE OR REPLACE FUNCTION public.portal_client_offboarding_finish(_request_id uuid, _error text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_status text;
BEGIN
  v_status := CASE WHEN _error IS NULL AND NOT EXISTS (
                     SELECT 1 FROM public.portal_accounts WHERE pending_deletion_request_id = _request_id)
                   THEN 'ejecutada' ELSE 'error' END;
  UPDATE public.portal_deletion_requests SET status = v_status, executed_at = now(), error = left(_error, 500)
   WHERE id = _request_id AND status IN ('en_proceso', 'error') AND plan->>'tipo' = 'empresa';
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_client_offboarding_finish(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_client_offboarding_finish(uuid, text) TO service_role;
