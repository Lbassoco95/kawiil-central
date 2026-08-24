-- =================================================================
-- Pipeline: desglose del valor — pago único vs mensualidad recurrente
--
-- `leads.estimated_value` (un solo monto) no sirve para proyectar: un Soft
-- Landing típico es el servicio de implementación (pago único) MÁS el
-- backoffice de seguimiento (mensualidad). Mezclarlos en un número hace que
-- las proyecciones financieras sobre-cuenten el mes de cierre y pierdan el
-- ingreso recurrente.
--
-- Modelo:
--   * estimated_value_one_time  → implementación / servicio de una sola vez
--   * estimated_value_monthly   → retainer mensual (backoffice, cumplimiento…)
--   * estimated_months          → meses de compromiso a proyectar (default 12)
--
-- `estimated_value` se conserva como VALOR TOTAL DEL CONTRATO (TCV):
--   one_time + monthly * months
-- porque es lo que ya alimenta el tablero (sumatoria por etapa), la lista y el
-- alta en Savio. No se convierte en columna generada porque varios flujos la
-- escriben directo; la app la mantiene sincronizada al capturar el desglose.
-- =================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS estimated_value_one_time numeric(12,2),
  ADD COLUMN IF NOT EXISTS estimated_value_monthly numeric(12,2),
  ADD COLUMN IF NOT EXISTS estimated_months integer;

COMMENT ON COLUMN public.leads.estimated_value_one_time IS
  'Parte del deal que se cobra una sola vez (implementación, constitución, soft landing) en MXN.';
COMMENT ON COLUMN public.leads.estimated_value_monthly IS
  'Mensualidad recurrente esperada (backoffice, cumplimiento) en MXN. Alimenta el MRR proyectado.';
COMMENT ON COLUMN public.leads.estimated_months IS
  'Meses de compromiso usados para proyectar el recurrente. NULL = usar el default de 12.';
COMMENT ON COLUMN public.leads.estimated_value IS
  'Valor total del contrato (TCV) en MXN: one_time + monthly * months. Lo mantiene sincronizado la app.';

-- Backfill conservador: los leads que ya tenían un monto se interpretan como
-- pago único (es como se venía capturando). Solo toca los que no tienen
-- desglose, así que re-ejecutarlo es un no-op.
UPDATE public.leads
   SET estimated_value_one_time = estimated_value
 WHERE estimated_value IS NOT NULL
   AND estimated_value_one_time IS NULL
   AND estimated_value_monthly IS NULL;

-- Proyección lista para reportes: MRR esperado y TCV por lead activo, ya
-- ponderados por la probabilidad de la etapa.
CREATE OR REPLACE VIEW public.lead_revenue_projection AS
SELECT
  l.id                                  AS lead_id,
  l.organization_id,
  l.full_name,
  l.company_name,
  l.stage_id,
  s.slug                                AS stage_slug,
  s.is_terminal,
  l.service_types,
  COALESCE(l.estimated_value_one_time, 0)                AS one_time_mxn,
  COALESCE(l.estimated_value_monthly, 0)                 AS monthly_mxn,
  COALESCE(l.estimated_months, 12)                       AS months,
  COALESCE(l.estimated_value_one_time, 0)
    + COALESCE(l.estimated_value_monthly, 0) * COALESCE(l.estimated_months, 12) AS tcv_mxn,
  CASE s.slug
    WHEN 'registrado'  THEN 0.10
    WHEN 'contactado'  THEN 0.25
    WHEN 'calificado'  THEN 0.40
    WHEN 'propuesta'   THEN 0.55
    WHEN 'negociacion' THEN 0.70
    WHEN 'convertido'  THEN 1.00
    WHEN 'frio'        THEN 0.05
    ELSE 0.00
  END                                                    AS win_probability
FROM public.leads l
JOIN public.pipeline_stages s ON s.id = l.stage_id
WHERE l.is_active;

COMMENT ON VIEW public.lead_revenue_projection IS
  'Proyección por lead: pago único, mensualidad, TCV y probabilidad por etapa. Hereda RLS de leads.';

-- La vista corre con los permisos del consultante (no SECURITY DEFINER), así
-- que respeta el RLS de `leads`.
ALTER VIEW public.lead_revenue_projection SET (security_invoker = true);

GRANT SELECT ON public.lead_revenue_projection TO authenticated;
