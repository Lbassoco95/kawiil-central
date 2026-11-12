-- Juicios: historial de fechas clave (audiencia / plazo) y evento de Outlook vinculado.

-- Evento de Outlook creado al guardar la fecha (vive en el calendario de *_owner).
ALTER TABLE public.project_lawsuits
  ADD COLUMN IF NOT EXISTS hearing_event_id text,
  ADD COLUMN IF NOT EXISTS hearing_event_owner uuid,
  ADD COLUMN IF NOT EXISTS deadline_event_id text,
  ADD COLUMN IF NOT EXISTS deadline_event_owner uuid;

-- Bitácora append-only: la llena el trigger; los usuarios solo pueden leerla.
CREATE TABLE IF NOT EXISTS public.project_lawsuit_date_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  lawsuit_id uuid NOT NULL REFERENCES public.project_lawsuits(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('audiencia', 'plazo')),
  old_date date,
  old_time time,
  old_note text,
  new_date date,
  new_time time,
  new_note text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_lawsuit_date_history_lawsuit_idx
  ON public.project_lawsuit_date_history (lawsuit_id, changed_at DESC);

ALTER TABLE public.project_lawsuit_date_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_lawsuit_date_history_select ON public.project_lawsuit_date_history;
CREATE POLICY project_lawsuit_date_history_select ON public.project_lawsuit_date_history
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.log_lawsuit_date_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o_hd date;
  o_ht time;
  o_dd date;
  o_dn text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    o_hd := OLD.next_hearing_date;
    o_ht := OLD.next_hearing_time;
    o_dd := OLD.next_deadline_date;
    o_dn := OLD.next_deadline_note;
  END IF;

  IF (o_hd, o_ht) IS DISTINCT FROM (NEW.next_hearing_date, NEW.next_hearing_time) THEN
    INSERT INTO public.project_lawsuit_date_history
      (organization_id, lawsuit_id, kind, old_date, old_time, new_date, new_time, changed_by)
    VALUES
      (NEW.organization_id, NEW.id, 'audiencia', o_hd, o_ht, NEW.next_hearing_date, NEW.next_hearing_time, auth.uid());
  END IF;

  IF (o_dd, o_dn) IS DISTINCT FROM (NEW.next_deadline_date, NEW.next_deadline_note) THEN
    INSERT INTO public.project_lawsuit_date_history
      (organization_id, lawsuit_id, kind, old_date, old_note, new_date, new_note, changed_by)
    VALUES
      (NEW.organization_id, NEW.id, 'plazo', o_dd, o_dn, NEW.next_deadline_date, NEW.next_deadline_note, auth.uid());
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS project_lawsuits_log_dates ON public.project_lawsuits;
CREATE TRIGGER project_lawsuits_log_dates
  AFTER INSERT OR UPDATE OF next_hearing_date, next_hearing_time, next_deadline_date, next_deadline_note
  ON public.project_lawsuits
  FOR EACH ROW EXECUTE FUNCTION public.log_lawsuit_date_changes();

-- Punto de partida: las fechas vigentes antes de activar el historial (changed_by NULL).
INSERT INTO public.project_lawsuit_date_history (organization_id, lawsuit_id, kind, new_date, new_time, changed_at)
SELECT l.organization_id, l.id, 'audiencia', l.next_hearing_date, l.next_hearing_time, l.updated_at
FROM public.project_lawsuits l
WHERE l.next_hearing_date IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.project_lawsuit_date_history h WHERE h.lawsuit_id = l.id AND h.kind = 'audiencia');

INSERT INTO public.project_lawsuit_date_history (organization_id, lawsuit_id, kind, new_date, new_note, changed_at)
SELECT l.organization_id, l.id, 'plazo', l.next_deadline_date, l.next_deadline_note, l.updated_at
FROM public.project_lawsuits l
WHERE l.next_deadline_date IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.project_lawsuit_date_history h WHERE h.lawsuit_id = l.id AND h.kind = 'plazo');

NOTIFY pgrst, 'reload schema';
