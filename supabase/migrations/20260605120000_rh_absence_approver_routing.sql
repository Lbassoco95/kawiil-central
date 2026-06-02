-- =============================================================
-- RH — enrutado de aprobación de ausencias
-- Modelo: cada solicitud la aprueba el RESPONSABLE de la célula del
-- solicitante; si la célula no tiene responsable, cae en el
-- APROBADOR POR DEFECTO de la organización
-- (organizations.settings->>'default_absence_approver_user_id').
-- Nadie aprueba la suya propia (en ese caso queda sin asignar y la
-- ven los G4 como red de seguridad).
-- =============================================================

ALTER TABLE public.rh_absence_requests
  ADD COLUMN IF NOT EXISTS assigned_approver_user_id uuid REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_rh_absence_assigned
  ON public.rh_absence_requests(assigned_approver_user_id, status);

-- Resuelve el aprobador de una solicitud (responsable de célula → por defecto).
-- Devuelve NULL si el candidato sería el propio solicitante.
CREATE OR REPLACE FUNCTION public.rh_resolve_absence_approver(
  _celula_id uuid, _org_id uuid, _requester uuid
) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN cand = _requester THEN NULL ELSE cand END
  FROM (
    SELECT COALESCE(
      (SELECT responsible_user_id FROM public.celulas WHERE id = _celula_id),
      (SELECT (settings->>'default_absence_approver_user_id')::uuid
         FROM public.organizations WHERE id = _org_id)
    ) AS cand
  ) s;
$$;

-- Estampa el aprobador asignado al crear.
CREATE OR REPLACE FUNCTION public.rh_absence_set_approver()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_approver_user_id IS NULL THEN
    NEW.assigned_approver_user_id :=
      public.rh_resolve_absence_approver(NEW.celula_id, NEW.organization_id, NEW.user_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rh_absence_set_approver ON public.rh_absence_requests;
CREATE TRIGGER rh_absence_set_approver
  BEFORE INSERT ON public.rh_absence_requests
  FOR EACH ROW EXECUTE FUNCTION public.rh_absence_set_approver();

-- Aviso al crear: al aprobador asignado; si no hay, a todos los G4 (salvo el solicitante).
CREATE OR REPLACE FUNCTION public.rh_absence_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  approver uuid := NEW.assigned_approver_user_id;
  requester_name text;
  requester_is_g4 boolean;
  rango text;
  cuerpo text;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  SELECT full_name INTO requester_name FROM public.profiles WHERE user_id = NEW.user_id;
  requester_is_g4 := EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = NEW.user_id AND role = 'transformador'
  );

  rango := to_char(NEW.start_date, 'DD/MM')
           || CASE WHEN NEW.end_date <> NEW.start_date THEN '–' || to_char(NEW.end_date, 'DD/MM') ELSE '' END;
  cuerpo := coalesce(requester_name, 'Un colaborador')
            || CASE WHEN requester_is_g4 THEN ' (G4)' ELSE '' END
            || ' solicitó ' || public.rh_absence_type_label(NEW.absence_type)
            || ' · ' || rango || ' (' || public.rh_day_part_label(NEW.day_part) || ')';

  IF approver IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, organization_id, type, title, body, entity_type, entity_id, is_read, source_user_id)
    VALUES (approver, NEW.organization_id, 'rh_request_pending', 'Solicitud de ausencia por aprobar', cuerpo, 'rh', NEW.id, false, NEW.user_id);
  ELSE
    -- Sin aprobador asignado (p. ej. el solicitante es el aprobador): red de seguridad a los demás G4.
    INSERT INTO public.notifications (user_id, organization_id, type, title, body, entity_type, entity_id, is_read, source_user_id)
    SELECT ur.user_id, NEW.organization_id, 'rh_request_pending', 'Solicitud de ausencia por aprobar', cuerpo, 'rh', NEW.id, false, NEW.user_id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.user_id = ur.user_id AND p.organization_id = NEW.organization_id
    WHERE ur.role = 'transformador' AND ur.user_id <> NEW.user_id;
  END IF;

  RETURN NEW;
END $$;

-- ---- Bootstrap: aprobador por defecto = Polo (si aún no está configurado) ----
DO $$
DECLARE polo uuid; orgid uuid;
BEGIN
  SELECT id INTO polo FROM auth.users WHERE lower(email) = 'lbassoco@kawiil.mx' LIMIT 1;
  IF polo IS NOT NULL THEN
    SELECT organization_id INTO orgid FROM public.profiles WHERE user_id = polo LIMIT 1;
    IF orgid IS NOT NULL THEN
      UPDATE public.organizations
      SET settings = jsonb_set(coalesce(settings, '{}'::jsonb),
                               '{default_absence_approver_user_id}', to_jsonb(polo::text), true)
      WHERE id = orgid
        AND coalesce(settings->>'default_absence_approver_user_id', '') = '';
    END IF;
  END IF;
END $$;

-- ---- Backfill: asigna aprobador a solicitudes pendientes existentes ----
UPDATE public.rh_absence_requests r
SET assigned_approver_user_id =
      public.rh_resolve_absence_approver(r.celula_id, r.organization_id, r.user_id)
WHERE r.status = 'pending' AND r.assigned_approver_user_id IS NULL;
