-- =================================================================
-- Portal del cliente — C4: eliminación de cuenta con conservación de datos.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-28
-- Rollback (a mano): migrations/2026-09-28_portal_account_deletion.rollback.sql
-- Política en lenguaje de cumplimiento: docs/portal/CONSERVACION.md.
-- Los plazos son PARÁMETROS (portal_retention_policy). Los valores sembrados son
-- PROPUESTA y quedan `confirmed = false` hasta que Polo (Oficial de
-- Cumplimiento) los confirme.
--
-- Bitácora inmutable vs. seudonimización: el trigger de inmutabilidad sigue
-- rechazando todo UPDATE/DELETE/TRUNCATE, con UNA excepción acotada: dentro de
-- `portal_pseudonymize_subject()` (solo service_role) se permite reemplazar
-- identificadores personales (actor_user_id, actor_email, entity_id cuando es el
-- id de la persona, y las llaves personales de `details`) por seudónimos
-- `seud:`. El hecho (qué, cuándo, sobre qué cliente, qué entidad) no cambia, y
-- el trigger lo comprueba columna por columna. Cada corrida deja su propio
-- registro `seudonimizacion`.
-- =================================================================

-- ── Parámetros de conservación ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_retention_policy (
  key text PRIMARY KEY,
  value text NOT NULL,
  description text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  confirmed_by uuid,
  confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.portal_retention_policy ENABLE ROW LEVEL SECURITY;
INSERT INTO public.portal_retention_policy (key, value, description) VALUES
  ('fiscal_retention_years', '5',
   'Años que se conservan los CFDI y los tickets ya facturados de un cliente de nivel básico después de eliminar la cuenta que lo creó. PROPUESTA pendiente de confirmación de Polo.'),
  ('purge_enabled', 'true',
   'Si la tarea programada purga lo que ya cumplió su plazo de conservación.')
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS portal_retention_policy_read ON public.portal_retention_policy;
CREATE POLICY portal_retention_policy_read ON public.portal_retention_policy
  FOR SELECT TO authenticated USING (public.portal_is_staff(auth.uid()));
DROP POLICY IF EXISTS portal_retention_policy_write ON public.portal_retention_policy;
CREATE POLICY portal_retention_policy_write ON public.portal_retention_policy
  FOR UPDATE TO authenticated
  USING (public.portal_is_staff(auth.uid()) AND public.has_role(auth.uid(), 'transformador'))
  WITH CHECK (public.portal_is_staff(auth.uid()) AND public.has_role(auth.uid(), 'transformador'));

CREATE OR REPLACE FUNCTION public.portal_retention_years()
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_temp, public
AS $$ SELECT COALESCE((SELECT value::int FROM public.portal_retention_policy WHERE key = 'fiscal_retention_years'), 5) $$;

-- ── Seudónimos ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_pseudonym_salt (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  salt text NOT NULL
);
ALTER TABLE public.portal_pseudonym_salt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_pseudonym_salt FROM PUBLIC, anon, authenticated;
INSERT INTO public.portal_pseudonym_salt (id, salt)
VALUES (true, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.portal_pseudonym_uuid(_uid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_temp, public
AS $$ SELECT md5((SELECT salt FROM public.portal_pseudonym_salt WHERE id) || _uid::text)::uuid $$;

CREATE OR REPLACE FUNCTION public.portal_pseudonym_text(_value text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_temp, public
AS $$ SELECT 'seud:' || left(encode(sha256(convert_to((SELECT salt FROM public.portal_pseudonym_salt WHERE id) || lower(_value), 'UTF8')), 'hex'), 16) $$;

REVOKE ALL ON FUNCTION public.portal_pseudonym_uuid(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_pseudonym_text(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_retention_years() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_retention_years() TO authenticated, service_role;

-- ── Inmutabilidad con la única excepción de seudonimizar ────────────
CREATE OR REPLACE FUNCTION public.portal_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  personal text[] := ARRAY['email', 'user_id', 'full_name', 'nombre'];
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(current_setting('portal.pseudonymizing', true), '') = 'on'
     -- El hecho no cambia:
     AND NEW.id = OLD.id
     AND NEW.occurred_at = OLD.occurred_at
     AND NEW.action = OLD.action
     AND NEW.actor_kind = OLD.actor_kind
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id
     AND NEW.entity_type IS NOT DISTINCT FROM OLD.entity_type
     AND (NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id OR NEW.entity_id LIKE 'seud:%')
     AND (NEW.details - personal) = (OLD.details - personal)
     -- Lo que sí cambia solo puede quedar como seudónimo:
     AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(NEW.details) e
                      WHERE e.key = ANY (personal) AND e.value IS DISTINCT FROM (OLD.details->>e.key)
                        AND e.value NOT LIKE 'seud:%')
     AND (NEW.actor_email IS NOT DISTINCT FROM OLD.actor_email OR NEW.actor_email LIKE 'seud:%')
     AND (NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id
          OR NEW.actor_user_id = public.portal_pseudonym_uuid(OLD.actor_user_id))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'portal_audit_log es inmutable (% rechazado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- ── Solicitudes, retenciones y cola de borrado de archivos ─────────
CREATE TABLE IF NOT EXISTS public.portal_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_pseudonym uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('bloqueada', 'en_proceso', 'ejecutada', 'error')),
  plan jsonb NOT NULL,
  result jsonb,
  executed_at timestamptz,
  error text
);
ALTER TABLE public.portal_deletion_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_deletion_requests_staff ON public.portal_deletion_requests;
CREATE POLICY portal_deletion_requests_staff ON public.portal_deletion_requests
  FOR SELECT TO authenticated USING (public.portal_is_staff_admin(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.portal_deletion_requests FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.portal_retention_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  subject text NOT NULL CHECK (subject IN ('cfdi', 'tickets_facturados')),
  retain_until timestamptz NOT NULL,
  deletion_request_id uuid REFERENCES public.portal_deletion_requests(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  purged_at timestamptz,
  purged_counts jsonb
);
ALTER TABLE public.portal_retention_holds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_retention_holds_staff ON public.portal_retention_holds;
CREATE POLICY portal_retention_holds_staff ON public.portal_retention_holds
  FOR SELECT TO authenticated USING (
    public.portal_is_staff(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.portal_retention_holds FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.portal_storage_purge_queue (
  id bigserial PRIMARY KEY,
  bucket text NOT NULL,
  path text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  error text
);
ALTER TABLE public.portal_storage_purge_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_storage_purge_queue FROM PUBLIC, anon, authenticated;

-- ── Qué clientes «son» de la persona ────────────────────────────────
-- owned  = cliente de nivel básico creado por la persona y del que es el ÚNICO miembro
--          (cuenta cualquier membresía no revocada, también las suspendidas; revocar = borrar la fila).
-- member (básico compartido) = básico creado por la persona donde los demás miembros están
--          suspendidos: se retira su membresía y NO se destruye nada (falla hacia conservar).
-- sole_admin = cliente de Kawiil (o compartido con miembros activos) donde es la única
--          administradora activa → bloquea.
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

-- ── Plan: exactamente qué se borra y qué se conserva, desde el estado real ──
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

-- ── Seudonimizar a una persona en todo el portal ────────────────────
CREATE OR REPLACE FUNCTION public.portal_pseudonymize_subject(_uid uuid, _email text, _request_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_p uuid := public.portal_pseudonym_uuid(_uid);
  v_pe text := public.portal_pseudonym_text(COALESCE(_email, _uid::text));
  v_pid text := public.portal_pseudonym_text(_uid::text);
  n int;
BEGIN
  PERFORM set_config('portal.pseudonymizing', 'on', true);
  UPDATE public.portal_audit_log SET
    actor_user_id = CASE WHEN actor_user_id = _uid THEN v_p ELSE actor_user_id END,
    actor_email = CASE WHEN actor_user_id = _uid OR lower(actor_email) = lower(_email) THEN v_pe ELSE actor_email END,
    entity_id = CASE WHEN entity_id = _uid::text THEN v_pid ELSE entity_id END,
    details = details
      || CASE WHEN details ? 'email' AND lower(details->>'email') = lower(_email) THEN jsonb_build_object('email', v_pe) ELSE '{}'::jsonb END
      || CASE WHEN details->>'user_id' = _uid::text THEN jsonb_build_object('user_id', v_pid) ELSE '{}'::jsonb END
  WHERE actor_user_id = _uid OR entity_id = _uid::text OR details->>'user_id' = _uid::text
     OR (_email IS NOT NULL AND (lower(actor_email) = lower(_email) OR lower(details->>'email') = lower(_email)));
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('portal.pseudonymizing', 'off', true);

  UPDATE public.portal_legal_acceptances SET user_id = v_p, user_email = v_pe WHERE user_id = _uid;
  UPDATE public.portal_messages SET author_user_id = v_p, author_name = 'Usuario eliminado' WHERE author_user_id = _uid;
  UPDATE public.portal_threads SET created_by = v_p WHERE created_by = _uid;
  UPDATE public.portal_cfdi SET created_by = v_p WHERE created_by = _uid;
  UPDATE public.portal_emissions SET requested_by = v_p WHERE requested_by = _uid;
  UPDATE public.portal_cancel_requests SET requested_by = v_p WHERE requested_by = _uid;
  DELETE FROM public.portal_message_reads WHERE user_id = _uid;
  DELETE FROM public.portal_document_reads WHERE user_id = _uid;
  DELETE FROM public.portal_outbox WHERE _email IS NOT NULL AND payload->'to' ? _email;

  INSERT INTO public.portal_audit_log (actor_user_id, actor_kind, action, entity_type, entity_id, details)
  VALUES (NULL, 'sistema', 'seudonimizacion', 'portal_deletion_requests', _request_id::text,
          jsonb_build_object('filas_bitacora', n, 'sujeto', v_pid));
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_pseudonymize_subject(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_pseudonymize_subject(uuid, text, uuid) TO service_role;

-- ── Ejecución (la llama portal-api con service_role; después borra el usuario de Auth) ──
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

CREATE OR REPLACE FUNCTION public.portal_finish_account_deletion(_request_id uuid, _ok boolean, _error text DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  UPDATE public.portal_deletion_requests
     SET status = CASE WHEN _ok THEN 'ejecutada' ELSE 'error' END, executed_at = now(), error = left(_error, 500)
   WHERE id = _request_id AND status = 'en_proceso'
$$;
REVOKE ALL ON FUNCTION public.portal_finish_account_deletion(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_finish_account_deletion(uuid, boolean, text) TO service_role;

-- ── Purga de lo que cumplió su plazo ────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_purge_expired_retention(_now timestamptz DEFAULT now())
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE h record; n int; total int := 0;
BEGIN
  IF COALESCE((SELECT value FROM public.portal_retention_policy WHERE key = 'purge_enabled'), 'true') <> 'true' THEN
    RETURN 0;
  END IF;
  FOR h IN SELECT * FROM public.portal_retention_holds WHERE purged_at IS NULL AND retain_until <= _now FOR UPDATE LOOP
    IF h.subject = 'cfdi' THEN
      INSERT INTO public.portal_storage_purge_queue (bucket, path, reason)
      SELECT 'portal', p, 'retencion_vencida' FROM public.portal_cfdi c, LATERAL unnest(ARRAY[c.xml_path, c.pdf_path]) p
       WHERE c.client_id = h.client_id AND p IS NOT NULL;
      DELETE FROM public.portal_emissions WHERE client_id = h.client_id;
      DELETE FROM public.portal_cfdi WHERE client_id = h.client_id;
    ELSE
      INSERT INTO public.portal_storage_purge_queue (bucket, path, reason)
      SELECT 'juun', p, 'retencion_vencida'
        FROM public.fis_receipts f LEFT JOIN public.fis_cfdi c ON c.receipt_id = f.id,
             LATERAL unnest(ARRAY[f.file_path, c.xml_path, c.pdf_path]) p
       WHERE f.client_id = h.client_id AND f.status = 'invoiced' AND p IS NOT NULL;
      DELETE FROM public.fis_receipts WHERE client_id = h.client_id AND status = 'invoiced';
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE public.portal_retention_holds SET purged_at = now(), purged_counts = jsonb_build_object('filas', n) WHERE id = h.id;
    PERFORM public.portal_audit('retencion_purga', h.client_id, 'portal_retention_holds', h.id::text,
      jsonb_build_object('materia', h.subject, 'filas', n), NULL);
    total := total + 1;
  END LOOP;
  RETURN total;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_purge_expired_retention(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_purge_expired_retention(timestamptz) TO service_role;

-- Tarea programada diaria (solo actúa sobre retenciones creadas por eliminaciones de cuenta).
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'portal-retention-purge';
EXCEPTION WHEN undefined_table OR undefined_function OR invalid_schema_name THEN NULL;
END $$;
SELECT cron.schedule('portal-retention-purge', '17 9 * * *', $cron$SELECT public.portal_purge_expired_retention()$cron$);

-- Las tablas nuevas de esta corrida llevan su propio prefijo portal_; el cerco
-- restrictivo de 20260928140500 no aplica a ellas y su RLS es propia.
