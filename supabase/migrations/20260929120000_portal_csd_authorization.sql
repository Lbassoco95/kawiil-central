-- =================================================================
-- Portal del cliente — C2/C5: el CSD solo se recibe con autorización
-- previa, se guarda en UNA transacción y su llave usa un secreto propio.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-28
-- Rollback (a mano): migrations/2026-09-28_portal_csd_authorization.rollback.sql
--
--   · Desde el portal: quien carga debe haber aceptado el aviso de privacidad
--     VIGENTE y, si el cliente es de nivel básico, el contrato de uso vigente.
--   · Desde central (G3/G4): el cliente debe tener carta de instrucción
--     registrada y vigente.
--   · `client_sat_certificates` no cambia de estructura. Las filas csd_sello del
--     portal se cifran con PORTAL_CSD_KEY_SECRET (no con MOFFIN_FIEL_SECRET);
--     `portal_csd_registry.key_secret_ref/key_secret_version` dicen con cuál.
--     Ninguna función existente descifra filas csd_sello (verificado: la vista
--     moffin_client_fiel filtra cert_type = 'fiel').
-- =================================================================

-- Acciones nuevas de bitácora de esta corrida (C2, C3, C4, V1).
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
  -- nuevas
  'csd_carga_rechazada', 'csd_destruccion',
  'cuenta_eliminacion_solicitud', 'cuenta_eliminacion_bloqueada',
  'seudonimizacion', 'retencion_purga', 'vinculacion_bloqueada'
));

ALTER TABLE public.portal_csd_registry
  ADD COLUMN IF NOT EXISTS key_secret_ref text NOT NULL DEFAULT 'PORTAL_CSD_KEY_SECRET',
  ADD COLUMN IF NOT EXISTS key_secret_version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS password_secret_version int NOT NULL DEFAULT 1;
COMMENT ON COLUMN public.portal_csd_registry.key_secret_ref IS
  'Secreto con el que están cifrados .cer/.key de este CSD. Nunca MOFFIN_FIEL_SECRET (ese es de la e.firma).';

-- ¿Qué falta para poder recibir el CSD? (lo usan la Edge y la pantalla).
CREATE OR REPLACE FUNCTION public.portal_csd_upload_check(_client_id uuid, _actor uuid, _via text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_missing jsonb := '[]'::jsonb;
  v_origin text;
  v_aviso public.portal_legal_documents := public.portal_current_legal('aviso_privacidad');
  v_contrato public.portal_legal_documents := public.portal_current_legal('contrato_uso');
BEGIN
  -- Desde el navegador solo se pregunta por uno mismo.
  IF auth.uid() IS NOT NULL AND _actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _via NOT IN ('portal', 'central') THEN RAISE EXCEPTION 'Vía inválida'; END IF;
  SELECT COALESCE(s.origin, 'kawiil') INTO v_origin
    FROM public.clients c LEFT JOIN public.portal_client_settings s ON s.client_id = c.id WHERE c.id = _client_id;
  IF v_origin IS NULL THEN RAISE EXCEPTION 'Cliente inexistente'; END IF;

  IF _via = 'portal' THEN
    IF NOT EXISTS (SELECT 1 FROM public.portal_memberships m JOIN public.portal_accounts a ON a.user_id = m.user_id
                    WHERE m.user_id = _actor AND m.client_id = _client_id AND m.role = 'administrador'
                      AND m.status = 'activa' AND a.status = 'activa') THEN
      v_missing := v_missing || jsonb_build_object('key', 'rol', 'label', 'Ser administrador activo de la empresa en el portal');
    END IF;
    IF v_aviso.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.portal_legal_acceptances
                                           WHERE user_id = _actor AND document_id = v_aviso.id) THEN
      v_missing := v_missing || jsonb_build_object('key', 'aviso_privacidad',
        'label', 'Aceptar el aviso de privacidad vigente' || COALESCE(' (versión ' || v_aviso.version || ')', ''));
    END IF;
    IF v_origin = 'basico' AND (v_contrato.id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.portal_legal_acceptances WHERE user_id = _actor AND document_id = v_contrato.id)) THEN
      v_missing := v_missing || jsonb_build_object('key', 'contrato_uso',
        'label', 'Aceptar el contrato de uso vigente' || COALESCE(' (versión ' || v_contrato.version || ')', ''));
    END IF;
  ELSE
    IF NOT (public.portal_is_staff_admin(_actor) AND public.portal_staff_in_client_org(_actor, _client_id)) THEN
      v_missing := v_missing || jsonb_build_object('key', 'rol', 'label', 'Ser G3/G4 de la organización del cliente');
    END IF;
    IF v_origin = 'basico' THEN
      v_missing := v_missing || jsonb_build_object('key', 'nivel_basico',
        'label', 'En el nivel básico el CSD lo carga el titular desde su portal');
    ELSIF NOT EXISTS (SELECT 1 FROM public.portal_instruction_letters
                       WHERE client_id = _client_id AND revoked_at IS NULL AND signed_date <= current_date) THEN
      v_missing := v_missing || jsonb_build_object('key', 'carta_instruccion', 'label', 'Carta de instrucción registrada y vigente');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', jsonb_array_length(v_missing) = 0, 'missing', v_missing);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_csd_upload_check(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_csd_upload_check(uuid, uuid, text) TO authenticated, service_role;

-- Guardado atómico: certificado + registro + contraseña, o nada. Vuelve a exigir
-- la autorización (defensa en profundidad: no confía en que la Edge la revisó).
CREATE OR REPLACE FUNCTION public.portal_csd_store(
  _client_id uuid, _actor uuid, _via text,
  _cert_ciphertext text, _key_ciphertext text, _password_ciphertext text,
  _serial text, _subject_rfc text, _not_before timestamptz, _not_after timestamptz, _fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_check jsonb; v_org uuid; v_cert uuid; v_reg uuid;
BEGIN
  v_check := public.portal_csd_upload_check(_client_id, _actor, _via);
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'Autorización previa incompleta' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _not_after <= now() THEN RAISE EXCEPTION 'Certificado vencido'; END IF;
  SELECT organization_id INTO v_org FROM public.clients WHERE id = _client_id;
  BEGIN
    INSERT INTO public.client_sat_certificates (organization_id, client_id, cert_type, label, cert_ciphertext, key_ciphertext,
      cert_serial, cert_subject_rfc, cert_not_before, cert_not_after, cert_fingerprint_sha256, updated_by)
    VALUES (v_org, _client_id, 'csd_sello', 'Portal del cliente', _cert_ciphertext, _key_ciphertext,
      _serial, _subject_rfc, _not_before, _not_after, _fingerprint, _actor)
    RETURNING id INTO v_cert;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('duplicate', true);
  END;
  INSERT INTO public.portal_csd_secrets (certificate_id, password_ciphertext) VALUES (v_cert, _password_ciphertext);
  INSERT INTO public.portal_csd_registry (organization_id, client_id, certificate_id, cert_serial, cert_not_before, cert_not_after,
    registered_via, registered_by)
  VALUES (v_org, _client_id, v_cert, _serial, _not_before, _not_after, _via, _actor)
  RETURNING id INTO v_reg;
  RETURN jsonb_build_object('registry_id', v_reg);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_csd_store(uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_csd_store(uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz, text)
  TO service_role;
