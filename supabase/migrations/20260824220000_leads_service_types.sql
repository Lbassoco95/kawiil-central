-- =================================================================
-- Pipeline: un lead puede buscar VARIOS servicios
--
-- `leads.service_type` (singular) no alcanza: un prospecto suele contratar
-- más de un servicio, y "Backoffice" es un paquete que siempre implica
-- Legal + Contabilidad.
--
-- Decisión de modelado: "Backoffice" NO se guarda como si fuera un servicio.
-- Es un atajo de captura que se expande a sus servicios reales, para que los
-- reportes sumen por servicio sin ambigüedad (un lead de backoffice cuenta en
-- Legal y en Contabilidad).
--
-- `service_type` se conserva y se mantiene sincronizado con el servicio
-- principal (el primero del arreglo) para no romper lo que ya lo lee.
-- =================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS service_types public.service_area[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.leads.service_types IS
  'Servicios que busca o contratará el prospecto. "Backoffice" se guarda expandido como {legal, contabilidad}.';

-- Backfill: los leads que ya tenían un servicio único quedan con ese servicio
-- en el arreglo. Idempotente: solo toca los que tienen el arreglo vacío.
UPDATE public.leads
   SET service_types = ARRAY[service_type]
 WHERE service_type IS NOT NULL
   AND COALESCE(array_length(service_types, 1), 0) = 0;

-- Búsquedas por servicio ("¿qué leads buscan contabilidad?").
CREATE INDEX IF NOT EXISTS idx_leads_service_types
  ON public.leads USING GIN (service_types);
