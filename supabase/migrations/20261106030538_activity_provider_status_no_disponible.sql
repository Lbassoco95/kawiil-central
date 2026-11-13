-- Nuevo estatus de proveedor: "no_disponible" (la sede/proveedor no puede para la fecha).
-- Distinto de "descartado" (decisión propia): sirve para llevar el historial de quién dijo que no.
ALTER TABLE public.activity_providers
  DROP CONSTRAINT IF EXISTS activity_providers_status_check;
ALTER TABLE public.activity_providers
  ADD CONSTRAINT activity_providers_status_check
  CHECK (status IN ('cotizacion', 'elegido', 'apartado', 'pagado', 'descartado', 'no_disponible'));
