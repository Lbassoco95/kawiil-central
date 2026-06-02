-- RH — reglas del día de burnout:
--   * Siempre un único día (día completo).
--   * Se autoaprueba al instante.
--   * Máximo 2 días por año calendario por persona.

-- Etiqueta legible (usada en avisos y resumen diario).
CREATE OR REPLACE FUNCTION public.rh_absence_type_label(_t public.rh_absence_type)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _t
    WHEN 'vacaciones' THEN 'vacaciones'
    WHEN 'dia_personal' THEN 'día personal'
    WHEN 'evento_escolar_familiar' THEN 'evento escolar/familiar'
    WHEN 'permiso' THEN 'permiso'
    WHEN 'incapacidad' THEN 'incapacidad'
    WHEN 'burnout' THEN 'día de burnout'
  END
$$;

CREATE OR REPLACE FUNCTION public.rh_burnout_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used integer;
BEGIN
  IF NEW.absence_type <> 'burnout' THEN
    RETURN NEW;
  END IF;

  IF NEW.start_date <> NEW.end_date THEN
    RAISE EXCEPTION 'Cada día de burnout es de un solo día.';
  END IF;
  NEW.day_part := 'full_day';

  SELECT count(*) INTO used
  FROM public.rh_absence_requests
  WHERE user_id = NEW.user_id
    AND absence_type = 'burnout'
    AND status IN ('approved', 'pending')
    AND date_part('year', start_date) = date_part('year', NEW.start_date);

  IF used >= 2 THEN
    RAISE EXCEPTION 'Ya usaste tus 2 días de burnout de este año.';
  END IF;

  -- Autoaprobación inmediata.
  NEW.status := 'approved';
  NEW.approver_user_id := NEW.user_id;
  NEW.decided_at := now();
  NEW.decision_note := 'Autoaprobado (día de burnout)';
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rh_burnout_guard ON public.rh_absence_requests;
CREATE TRIGGER rh_burnout_guard
  BEFORE INSERT ON public.rh_absence_requests
  FOR EACH ROW EXECUTE FUNCTION public.rh_burnout_guard();

-- El día de burnout entra ya 'approved' (el trigger lo autoaprueba), así que la
-- política de INSERT debe permitir ese estado únicamente para burnout.
DROP POLICY IF EXISTS "Insert own request" ON public.rh_absence_requests;
CREATE POLICY "Insert own request" ON public.rh_absence_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = public.get_user_org_id(auth.uid())
    AND (status = 'pending' OR (status = 'approved' AND absence_type = 'burnout'))
  );
