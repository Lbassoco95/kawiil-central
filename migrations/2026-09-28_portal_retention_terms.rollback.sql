-- 2026-09-28 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260928150400_portal_retention_terms.sql (B1).
-- Correr DESPUÉS de los rollbacks de 20260928150600 y 20260928150500.
-- Se pierden el registro de elecciones de plazo y los resguardos de constancias
-- legales (anótelos antes si hay vigentes:
--   SELECT * FROM public.portal_retention_elections;
--   SELECT subject_pseudonym, retain_until FROM public.portal_retention_holds WHERE subject = 'aceptaciones' AND purged_at IS NULL;).
-- Los resguardos de CFDI y tickets conservan su fecha de fin.
DROP FUNCTION IF EXISTS public.portal_staff_set_client_retention(uuid, int, text);
DROP FUNCTION IF EXISTS public.portal__retention_open(uuid, uuid, uuid, int, text, uuid, text[], text);

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

DELETE FROM public.portal_retention_holds WHERE subject = 'aceptaciones';
ALTER TABLE public.portal_retention_holds DROP CONSTRAINT IF EXISTS portal_retention_holds_target_check;
ALTER TABLE public.portal_retention_holds DROP CONSTRAINT IF EXISTS portal_retention_holds_subject_check;
ALTER TABLE public.portal_retention_holds ADD CONSTRAINT portal_retention_holds_subject_check
  CHECK (subject IN ('cfdi', 'tickets_facturados'));
ALTER TABLE public.portal_retention_holds DROP CONSTRAINT IF EXISTS portal_retention_holds_years_check;
ALTER TABLE public.portal_retention_holds
  DROP COLUMN IF EXISTS election_id, DROP COLUMN IF EXISTS years, DROP COLUMN IF EXISTS subject_pseudonym,
  DROP COLUMN IF EXISTS cancelled_at, DROP COLUMN IF EXISTS cancel_reason;
ALTER TABLE public.portal_retention_holds ALTER COLUMN organization_id SET NOT NULL, ALTER COLUMN client_id SET NOT NULL;

DROP TABLE IF EXISTS public.portal_retention_elections;
DROP FUNCTION IF EXISTS public.portal_retention_elections_append_only();

DROP FUNCTION IF EXISTS public.portal_client_retention_years(uuid);
DROP TRIGGER IF EXISTS trg_portal_client_settings_retention ON public.portal_client_settings;
DROP FUNCTION IF EXISTS public.portal_client_settings_retention_guard();
ALTER TABLE public.portal_client_settings DROP CONSTRAINT IF EXISTS portal_client_settings_retention_years_check;
ALTER TABLE public.portal_client_settings
  DROP COLUMN IF EXISTS retention_years, DROP COLUMN IF EXISTS retention_years_set_at, DROP COLUMN IF EXISTS retention_years_set_by;

DROP FUNCTION IF EXISTS public.portal_retention_allowed(int);
ALTER TABLE public.portal_retention_policy DROP CONSTRAINT IF EXISTS portal_retention_policy_years_check;
UPDATE public.portal_retention_policy
   SET description = 'Años que se conservan los CFDI y los tickets ya facturados de un cliente de nivel básico después de eliminar la cuenta que lo creó. PROPUESTA pendiente de confirmación de Polo.',
       confirmed = false, confirmed_at = NULL, confirmed_by = NULL
 WHERE key = 'fiscal_retention_years';

-- Lista de acciones de 20260928150000 (NOT VALID: las filas con acciones nuevas se conservan).
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
  'seudonimizacion', 'retencion_purga', 'vinculacion_bloqueada'
)) NOT VALID;
