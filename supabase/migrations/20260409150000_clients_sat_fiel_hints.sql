-- Referencia interna para e.firma SAT (sin almacenar contraseñas ni llaves en la app)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS sat_fiel_managed_by_firm boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sat_fiel_location_hint text;

COMMENT ON COLUMN public.clients.sat_fiel_managed_by_firm IS 'Si true, la e.firma la custodia el despacho; no se sube a Kawiil.';
COMMENT ON COLUMN public.clients.sat_fiel_location_hint IS 'Nota interna: carpeta Dropbox, caja fuerte, etc. No guardar contraseñas.';
