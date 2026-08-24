-- =================================================================
-- Pipeline: tipo de servicio por lead + campos de Constitución
--
-- Objetivo: la ficha del lead muestra SOLO el formulario del servicio
-- que corresponde (Soft Landing, Constitución, etc.) en lugar de
-- apilar todos los campos en una sola columna.
--
-- `service_type` reutiliza el enum `service_area` que ya usan proyectos
-- y clientes, para que las etiquetas (SERVICE_LABELS) sean las mismas.
-- =================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS service_type public.service_area;

COMMENT ON COLUMN public.leads.service_type IS
  'Servicio que solicita el prospecto. Define qué formulario de datos se muestra en la ficha del lead.';

-- ── Datos de Constitución (nacional o dentro de un Soft Landing) ────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS constitucion_denominacion_1 text,
  ADD COLUMN IF NOT EXISTS constitucion_denominacion_2 text,
  ADD COLUMN IF NOT EXISTS constitucion_denominacion_3 text,
  ADD COLUMN IF NOT EXISTS constitucion_entity_type text,
  ADD COLUMN IF NOT EXISTS constitucion_partners_count integer,
  ADD COLUMN IF NOT EXISTS constitucion_capital_social numeric,
  ADD COLUMN IF NOT EXISTS constitucion_objeto_social text,
  ADD COLUMN IF NOT EXISTS constitucion_estado text,
  ADD COLUMN IF NOT EXISTS constitucion_ciudad text,
  ADD COLUMN IF NOT EXISTS constitucion_notario text,
  ADD COLUMN IF NOT EXISTS constitucion_foreign_partners boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS constitucion_needs_fiel boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS constitucion_needs_bank_account boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS constitucion_notes text;

COMMENT ON COLUMN public.leads.constitucion_denominacion_1 IS
  'Opción 1 de denominación / razón social solicitada a la Secretaría de Economía.';
COMMENT ON COLUMN public.leads.constitucion_capital_social IS
  'Capital social propuesto en MXN.';

-- Índice para filtrar el tablero/lista por servicio.
CREATE INDEX IF NOT EXISTS idx_leads_service_type
  ON public.leads (service_type)
  WHERE service_type IS NOT NULL;
