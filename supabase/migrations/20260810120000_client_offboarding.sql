-- Seguimiento del cierre / baja de clientes — estructura (no bloquea nada)
--
-- Se guarda como JSONB en la ficha del cliente para heredar las políticas RLS
-- existentes de `clients` (mismo criterio que constitution_details / lawsuit_details
-- en `projects`). No se agrega un nuevo estatus al enum client_status: el proceso
-- de baja tiene su propio ciclo interno (en_proceso | cerrado) dentro del JSON, y
-- el cambio de estatus del cliente a "inactivo" queda a decisión del usuario.
--
-- Forma esperada del objeto (todas las claves opcionales salvo stage/steps):
--   {
--     "stage": "en_proceso" | "cerrado",
--     "reason": text,
--     "target_exit_date": "YYYY-MM-DD",
--     "closing_responsible_user_id": uuid,
--     "steps": [ { "key": text, "label": text, "done": bool, "note": text, "date": "YYYY-MM-DD" } ],
--     "notes": text,
--     "started_at": timestamptz, "started_by": uuid,
--     "closed_at": timestamptz, "closed_by": uuid
--   }
-- NULL = el cliente no está en proceso de baja.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS offboarding jsonb;

COMMENT ON COLUMN public.clients.offboarding IS
  'Seguimiento del cierre/baja del cliente (JSONB). NULL = sin proceso de baja. Ver migración 20260810120000_client_offboarding.sql.';
