-- 2026-09-28 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260929120000_portal_csd_authorization.sql.
-- No borra CSD ya cargados. La bitácora conserva los registros con acciones nuevas:
-- por eso la lista anterior se restaura como NOT VALID (aplica a filas nuevas, no reescribe las viejas).
DROP FUNCTION IF EXISTS public.portal_csd_store(uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.portal_csd_upload_check(uuid, uuid, text);
ALTER TABLE public.portal_csd_registry
  DROP COLUMN IF EXISTS key_secret_ref,
  DROP COLUMN IF EXISTS key_secret_version,
  DROP COLUMN IF EXISTS password_secret_version;
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
  'dropbox_mapeo', 'dropbox_sincronizacion'
)) NOT VALID;
