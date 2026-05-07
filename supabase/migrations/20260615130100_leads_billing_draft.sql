-- Borrador fiscal en lead (Savio solo tras etapa ganada «convertido»)

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS billing_rfc text,
  ADD COLUMN IF NOT EXISTS billing_service_description text,
  ADD COLUMN IF NOT EXISTS billing_legal_name text;

COMMENT ON COLUMN public.leads.billing_rfc IS 'RFC provisional para alta Savio (guardar antes de cerrar trato)';
COMMENT ON COLUMN public.leads.billing_service_description IS 'Descripción/servicio del cargo Savio planeado';
COMMENT ON COLUMN public.leads.billing_legal_name IS 'Razón social o nombre fiscal para Savio si difiere del contacto visible';
