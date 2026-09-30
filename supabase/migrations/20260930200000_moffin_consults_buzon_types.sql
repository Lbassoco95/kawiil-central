-- Buzón tributario SAT (SATgo comunicadosfiel / notificacionesfiel)
ALTER TABLE public.moffin_consults
  DROP CONSTRAINT IF EXISTS moffin_consults_consult_type_check;

ALTER TABLE public.moffin_consults
  ADD CONSTRAINT moffin_consults_consult_type_check
  CHECK (consult_type = ANY (ARRAY[
    'lista_69b'::text,
    'constancia_situacion_fiscal'::text,
    'opinion_cumplimiento'::text,
    'buzon_comunicados'::text,
    'buzon_notificaciones'::text
  ]));

COMMENT ON TABLE public.moffin_consults IS
  'Historial de consultas SAT (69-B, CSF, 32D, buzón comunicados/notificaciones). Proveedor principal: SATgo.';
