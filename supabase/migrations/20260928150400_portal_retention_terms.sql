-- =================================================================
-- Portal del cliente — B1: plazo de resguardo de cinco años, o diez si se elige.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-28
-- Rollback (a mano): migrations/2026-09-28_portal_retention_terms.rollback.sql
-- Política en lenguaje de cumplimiento: docs/portal/CONSERVACION.md.
--
-- Criterio fijado por Polo (Oficial de Cumplimiento) el 2026-09-28:
--   · Omisión: cinco años. Única alternativa: diez. No hay otras.
--   · Básico: elige la persona titular al darse de baja.
--   · Premier: lo fija Kawiil por cliente (G3/G4, a solicitud del cliente).
--   · Se resguardan: CFDI emitidos y recibidos, tickets facturados con su factura,
--     y las constancias de aceptación de textos legales (identidad seudonimizada).
--   · Nunca se resguardan: certificados, llaves, contraseñas, accesos ni mensajes.
--   · Cada resguardo guarda SU plazo. Cambiar la omisión no lo mueve; solo una
--     nueva elección expresa (G3/G4 en premier) lo modifica.
-- No borra ni reescribe datos existentes: agrega columnas, una tabla de elecciones
-- y reemplaza la función de purga.
-- =================================================================

-- ── Bitácora: acciones nuevas de B1–B4 (se agregan juntas aquí) ─────
ALTER TABLE public.portal_audit_log DROP CONSTRAINT IF EXISTS portal_audit_log_action_check;
ALTER TABLE public.portal_audit_log ADD CONSTRAINT portal_audit_log_action_check CHECK (action IN (
  'acceso', 'documento_consulta', 'documento_descarga', 'archivo_descarga',
  'emision', 'emision_rechazada', 'emision_interruptor',
  'cancelacion_solicitud', 'cancelacion_resolucion',
  'mensaje', 'hilo_asignacion', 'hilo_estado',
  'publicacion', 'despublicacion', 'documento_subida',
  'rol_cambio', 'nivel_cambio', 'vinculacion', 'invitacion', 'suspension', 'reactivacion',
  'cuenta_registro', 'cuenta_eliminada', 'nivel_basico_activado',
  'legal_aceptacion', 'carta_instruccion_registro',
  'csd_carga', 'csd_uso', 'csd_revocacion',
  'ticket_carga', 'ticket_estado', 'ticket_facturado',
  'cfdi_carga', 'cfdi_importacion', 'categoria_confirmada',
  'dropbox_mapeo', 'dropbox_sincronizacion',
  'csd_carga_rechazada', 'csd_destruccion',
  'cuenta_eliminacion_solicitud', 'cuenta_eliminacion_bloqueada',
  'seudonimizacion', 'retencion_purga', 'vinculacion_bloqueada',
  -- B1–B4
  'resguardo_eleccion', 'resguardo_cambio', 'resguardo_cancelado',
  'empresa_baja', 'cliente_baja_solicitud', 'cliente_baja', 'cliente_baja_rechazada',
  'baja_verificacion'
));

-- ── Omisión: cinco años, confirmada; solo 5 o 10 ────────────────────
UPDATE public.portal_retention_policy
   SET value = '5',
       description = 'Plazo de resguardo por omisión (años) de la información fiscal al darse de baja. Solo 5 o 10. Fijado por el Oficial de Cumplimiento el 2026-09-28.',
       confirmed = true,
       confirmed_at = COALESCE(confirmed_at, '2026-09-28 00:00:00-06'::timestamptz),
       updated_at = now()
 WHERE key = 'fiscal_retention_years' AND (NOT confirmed OR value NOT IN ('5', '10'));
ALTER TABLE public.portal_retention_policy DROP CONSTRAINT IF EXISTS portal_retention_policy_years_check;
ALTER TABLE public.portal_retention_policy ADD CONSTRAINT portal_retention_policy_years_check
  CHECK (key <> 'fiscal_retention_years' OR value IN ('5', '10'));

CREATE OR REPLACE FUNCTION public.portal_retention_allowed(_years int)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT _years IN (5, 10) $$;

-- ── Premier: plazo por cliente, solo por RPC de G3/G4 ───────────────
ALTER TABLE public.portal_client_settings
  ADD COLUMN IF NOT EXISTS retention_years int,
  ADD COLUMN IF NOT EXISTS retention_years_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_years_set_by uuid;
ALTER TABLE public.portal_client_settings DROP CONSTRAINT IF EXISTS portal_client_settings_retention_years_check;
ALTER TABLE public.portal_client_settings ADD CONSTRAINT portal_client_settings_retention_years_check
  CHECK (retention_years IS NULL OR retention_years IN (5, 10));
COMMENT ON COLUMN public.portal_client_settings.retention_years IS
  'Premier: plazo de resguardo (5 o 10) fijado por Kawiil a solicitud del cliente. NULL = omisión. Solo cambia con portal_staff_set_client_retention().';

CREATE OR REPLACE FUNCTION public.portal_client_settings_retention_guard()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.retention_years IS DISTINCT FROM OLD.retention_years
     AND COALESCE(current_setting('portal.retention_rpc', true), '') <> 'on' THEN
    RAISE EXCEPTION 'El plazo de resguardo solo se cambia con portal_staff_set_client_retention()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_portal_client_settings_retention ON public.portal_client_settings;
CREATE TRIGGER trg_portal_client_settings_retention
  BEFORE UPDATE OF retention_years ON public.portal_client_settings
  FOR EACH ROW EXECUTE FUNCTION public.portal_client_settings_retention_guard();

CREATE OR REPLACE FUNCTION public.portal_client_retention_years(_client_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_temp, public
AS $$ SELECT COALESCE((SELECT retention_years FROM public.portal_client_settings WHERE client_id = _client_id),
                      public.portal_retention_years()) $$;
REVOKE ALL ON FUNCTION public.portal_client_retention_years(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_client_retention_years(uuid) TO authenticated, service_role;

-- ── Registro de elecciones (quién, cuándo, cuántos años, hasta cuándo) ──
CREATE TABLE IF NOT EXISTS public.portal_retention_elections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  deletion_request_id uuid REFERENCES public.portal_deletion_requests(id) ON DELETE SET NULL,
  years int NOT NULL CHECK (years IN (5, 10)),
  -- titular = la persona al darse de baja (básico); kawiil = G3/G4 (premier); omision = nadie eligió.
  elected_kind text NOT NULL CHECK (elected_kind IN ('titular', 'kawiil', 'omision')),
  -- titular: su seudónimo (nunca el id real); kawiil: id del integrante del equipo; omision: NULL.
  elected_by uuid,
  elected_at timestamptz NOT NULL DEFAULT now(),
  -- Fecha de fin del resguardo que resulta (NULL si el plazo premier se fija antes de una baja).
  retain_until timestamptz,
  motivo text
);
ALTER TABLE public.portal_retention_elections ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.portal_retention_elections FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS portal_retention_elections_staff ON public.portal_retention_elections;
CREATE POLICY portal_retention_elections_staff ON public.portal_retention_elections
  FOR SELECT TO authenticated USING (
    public.portal_is_staff(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_portal_retention_elections_client ON public.portal_retention_elections (client_id);

CREATE OR REPLACE FUNCTION public.portal_retention_elections_append_only()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  -- Única excepción: el ON DELETE SET NULL de la solicitud referida (nada más cambia).
  IF NEW.deletion_request_id IS NULL AND OLD.deletion_request_id IS NOT NULL
     AND to_jsonb(NEW) - 'deletion_request_id' = to_jsonb(OLD) - 'deletion_request_id' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'portal_retention_elections solo admite altas (% rechazado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
DROP TRIGGER IF EXISTS trg_portal_retention_elections_append_only ON public.portal_retention_elections;
CREATE TRIGGER trg_portal_retention_elections_append_only
  BEFORE UPDATE ON public.portal_retention_elections
  FOR EACH ROW EXECUTE FUNCTION public.portal_retention_elections_append_only();

-- ── Resguardos: cada uno con su plazo; también las constancias legales ──
ALTER TABLE public.portal_retention_holds
  ALTER COLUMN organization_id DROP NOT NULL,
  ALTER COLUMN client_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS years int,
  ADD COLUMN IF NOT EXISTS election_id uuid REFERENCES public.portal_retention_elections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subject_pseudonym uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;
-- Resguardos anteriores (de 20260928150200): su plazo se deduce de sus propias fechas.
UPDATE public.portal_retention_holds
   SET years = CASE WHEN retain_until >= created_at + interval '9 years' THEN 10 ELSE 5 END
 WHERE years IS NULL;
ALTER TABLE public.portal_retention_holds ALTER COLUMN years SET NOT NULL;
ALTER TABLE public.portal_retention_holds DROP CONSTRAINT IF EXISTS portal_retention_holds_years_check;
ALTER TABLE public.portal_retention_holds ADD CONSTRAINT portal_retention_holds_years_check CHECK (years IN (5, 10));
ALTER TABLE public.portal_retention_holds DROP CONSTRAINT IF EXISTS portal_retention_holds_subject_check;
ALTER TABLE public.portal_retention_holds ADD CONSTRAINT portal_retention_holds_subject_check
  CHECK (subject IN ('cfdi', 'tickets_facturados', 'aceptaciones'));
ALTER TABLE public.portal_retention_holds DROP CONSTRAINT IF EXISTS portal_retention_holds_target_check;
ALTER TABLE public.portal_retention_holds ADD CONSTRAINT portal_retention_holds_target_check
  CHECK ((subject = 'aceptaciones' AND subject_pseudonym IS NOT NULL)
      OR (subject <> 'aceptaciones' AND client_id IS NOT NULL AND organization_id IS NOT NULL));

-- Abre un resguardo con su elección (uso interno de las bajas; solo service_role).
CREATE OR REPLACE FUNCTION public.portal__retention_open(
  _client_id uuid, _subject_pseudonym uuid, _request_id uuid,
  _years int, _kind text, _by uuid, _subjects text[], _motivo text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_org uuid;
  v_until timestamptz := now() + make_interval(years => _years);
  v_el uuid;
  s text;
BEGIN
  IF NOT public.portal_retention_allowed(_years) THEN
    RAISE EXCEPTION 'Plazo de resguardo inválido: solo 5 o 10 años';
  END IF;
  SELECT organization_id INTO v_org FROM public.clients WHERE id = _client_id;
  INSERT INTO public.portal_retention_elections
    (organization_id, client_id, deletion_request_id, years, elected_kind, elected_by, retain_until, motivo)
  VALUES (v_org, _client_id, _request_id, _years, _kind, _by, v_until, _motivo)
  RETURNING id INTO v_el;
  FOREACH s IN ARRAY _subjects LOOP
    INSERT INTO public.portal_retention_holds
      (organization_id, client_id, subject, subject_pseudonym, retain_until, years, election_id, deletion_request_id)
    VALUES (v_org, _client_id, s, CASE WHEN s = 'aceptaciones' THEN _subject_pseudonym END,
            v_until, _years, v_el, _request_id);
  END LOOP;
  PERFORM public.portal_audit('resguardo_eleccion', _client_id, 'portal_retention_elections', v_el::text,
    jsonb_build_object('anios', _years, 'quien', _kind, 'hasta', v_until::date, 'materias', to_jsonb(_subjects)), NULL);
  RETURN v_el;
END;
$$;
REVOKE ALL ON FUNCTION public.portal__retention_open(uuid, uuid, uuid, int, text, uuid, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal__retention_open(uuid, uuid, uuid, int, text, uuid, text[], text) TO service_role;

-- ── G3/G4 fija el plazo de un cliente premier (a solicitud del cliente) ──
-- Si ese cliente ya tiene un resguardo en curso, esta es la «nueva elección
-- expresa» que lo modifica: el plazo se recalcula desde el inicio del resguardo.
CREATE OR REPLACE FUNCTION public.portal_staff_set_client_retention(_client_id uuid, _years int, _motivo text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_org uuid;
  v_origin text;
  v_before int;
  v_el uuid;
  v_until timestamptz;
  n int;
BEGIN
  IF v_me IS NULL OR NOT (public.portal_is_staff_admin(v_me) AND public.portal_staff_in_client_org(v_me, _client_id)) THEN
    RAISE EXCEPTION 'Solo G3/G4 de la organización del cliente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.portal_retention_allowed(_years) THEN
    RAISE EXCEPTION 'Plazo de resguardo inválido: solo 5 o 10 años';
  END IF;
  IF btrim(COALESCE(_motivo, '')) = '' THEN
    RAISE EXCEPTION 'Indique el motivo (la solicitud del cliente)';
  END IF;
  SELECT c.organization_id, COALESCE(s.origin, 'kawiil'), s.retention_years
    INTO v_org, v_origin, v_before
    FROM public.clients c LEFT JOIN public.portal_client_settings s ON s.client_id = c.id
   WHERE c.id = _client_id;
  IF v_origin = 'basico' THEN
    RAISE EXCEPTION 'En el nivel básico el plazo lo elige la persona titular al darse de baja';
  END IF;

  PERFORM set_config('portal.retention_rpc', 'on', true);
  INSERT INTO public.portal_client_settings (client_id, organization_id, retention_years, retention_years_set_at, retention_years_set_by)
  VALUES (_client_id, v_org, _years, now(), v_me)
  ON CONFLICT (client_id) DO UPDATE
    SET retention_years = excluded.retention_years, retention_years_set_at = now(), retention_years_set_by = v_me;
  PERFORM set_config('portal.retention_rpc', 'off', true);

  -- Resguardo en curso de este cliente (si ya se dio de baja): se recalcula.
  UPDATE public.portal_retention_holds
     SET years = _years, retain_until = created_at + make_interval(years => _years)
   WHERE client_id = _client_id AND purged_at IS NULL AND cancelled_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT max(retain_until) INTO v_until FROM public.portal_retention_holds
   WHERE client_id = _client_id AND purged_at IS NULL AND cancelled_at IS NULL;

  INSERT INTO public.portal_retention_elections (organization_id, client_id, years, elected_kind, elected_by, retain_until, motivo)
  VALUES (v_org, _client_id, _years, 'kawiil', v_me, v_until, btrim(_motivo))
  RETURNING id INTO v_el;
  UPDATE public.portal_retention_holds SET election_id = v_el
   WHERE client_id = _client_id AND purged_at IS NULL AND cancelled_at IS NULL;

  PERFORM public.portal_audit('resguardo_cambio', _client_id, 'portal_retention_elections', v_el::text,
    jsonb_build_object('antes', COALESCE(v_before, public.portal_retention_years()), 'despues', _years,
                       'resguardos_en_curso', n, 'hasta', v_until::date));
  RETURN jsonb_build_object('anios', _years, 'resguardos_en_curso', n, 'hasta', v_until::date);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_staff_set_client_retention(uuid, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_staff_set_client_retention(uuid, int, text) TO authenticated;

-- ── Purga: cada resguardo con SU fecha; también las constancias legales ──
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
  FOR h IN SELECT * FROM public.portal_retention_holds
            WHERE purged_at IS NULL AND cancelled_at IS NULL AND retain_until <= _now FOR UPDATE LOOP
    -- Defensa: si la empresa volvió a tener personas activas, no se purga (el resguardo ya no aplica).
    IF h.client_id IS NOT NULL AND h.subject <> 'aceptaciones' AND EXISTS (
         SELECT 1 FROM public.portal_memberships m JOIN public.portal_accounts a ON a.user_id = m.user_id
          WHERE m.client_id = h.client_id AND m.status = 'activa' AND a.status = 'activa') THEN
      UPDATE public.portal_retention_holds SET cancelled_at = now(), cancel_reason = 'empresa_activa' WHERE id = h.id;
      PERFORM public.portal_audit('resguardo_cancelado', h.client_id, 'portal_retention_holds', h.id::text,
        jsonb_build_object('materia', h.subject, 'motivo', 'empresa_activa'), NULL);
      CONTINUE;
    END IF;
    IF h.subject = 'cfdi' THEN
      INSERT INTO public.portal_storage_purge_queue (bucket, path, reason)
      SELECT 'portal', p, 'retencion_vencida' FROM public.portal_cfdi c, LATERAL unnest(ARRAY[c.xml_path, c.pdf_path]) p
       WHERE c.client_id = h.client_id AND p IS NOT NULL;
      DELETE FROM public.portal_emissions WHERE client_id = h.client_id;
      DELETE FROM public.portal_cfdi WHERE client_id = h.client_id;
    ELSIF h.subject = 'tickets_facturados' THEN
      INSERT INTO public.portal_storage_purge_queue (bucket, path, reason)
      SELECT 'juun', p, 'retencion_vencida'
        FROM public.fis_receipts f LEFT JOIN public.fis_cfdi c ON c.receipt_id = f.id,
             LATERAL unnest(ARRAY[f.file_path, c.xml_path, c.pdf_path]) p
       WHERE f.client_id = h.client_id AND f.status = 'invoiced' AND p IS NOT NULL;
      DELETE FROM public.fis_receipts WHERE client_id = h.client_id AND status = 'invoiced';
    ELSE
      DELETE FROM public.portal_legal_acceptances WHERE user_id = h.subject_pseudonym;
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE public.portal_retention_holds SET purged_at = now(), purged_counts = jsonb_build_object('filas', n) WHERE id = h.id;
    PERFORM public.portal_audit('retencion_purga', h.client_id, 'portal_retention_holds', h.id::text,
      jsonb_build_object('materia', h.subject, 'filas', n, 'anios', h.years), NULL);
    total := total + 1;
  END LOOP;
  RETURN total;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_purge_expired_retention(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_purge_expired_retention(timestamptz) TO service_role;
