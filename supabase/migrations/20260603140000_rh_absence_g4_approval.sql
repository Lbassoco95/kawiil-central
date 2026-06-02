-- =============================================================
-- RH — ajuste de aprobación de ausencias
-- Por ahora CUALQUIER G4 (transformador) puede autorizar solicitudes
-- (entre células), pero nadie puede aprobar la suya propia.
-- Avisos: solicitudes de miembros van al G4 responsable de su célula;
-- la solicitud de un G4 se avisa a los OTROS G4.
-- =============================================================

-- ---- Política de decisión: cualquier G4 salvo el propio solicitante ----
DROP POLICY IF EXISTS "Approver decides" ON public.rh_absence_requests;
CREATE POLICY "Approver decides" ON public.rh_absence_requests
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.has_role(auth.uid(), 'transformador')
    AND user_id <> auth.uid()
  )
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.has_role(auth.uid(), 'transformador')
    AND user_id <> auth.uid()
  );

-- ---- Aviso al crear: responsable de célula + (si es G4) los otros G4 ----
CREATE OR REPLACE FUNCTION public.rh_absence_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  responsible uuid;
  requester_name text;
  requester_is_g4 boolean;
  rango text;
  cuerpo text;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  SELECT responsible_user_id INTO responsible FROM public.celulas WHERE id = NEW.celula_id;
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

  -- Aviso al responsable de la célula (ruteo normal por área/célula).
  IF responsible IS NOT NULL AND responsible <> NEW.user_id THEN
    INSERT INTO public.notifications (user_id, organization_id, type, title, body, entity_type, entity_id, is_read, source_user_id)
    VALUES (responsible, NEW.organization_id, 'rh_request_pending', 'Solicitud de ausencia por aprobar', cuerpo, 'rh', NEW.id, false, NEW.user_id);
  END IF;

  -- Si el solicitante es G4, avisa a los OTROS G4 (aprobación cruzada).
  IF requester_is_g4 THEN
    INSERT INTO public.notifications (user_id, organization_id, type, title, body, entity_type, entity_id, is_read, source_user_id)
    SELECT ur.user_id, NEW.organization_id, 'rh_request_pending', 'Solicitud de ausencia por aprobar', cuerpo, 'rh', NEW.id, false, NEW.user_id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.user_id = ur.user_id AND p.organization_id = NEW.organization_id
    WHERE ur.role = 'transformador'
      AND ur.user_id <> NEW.user_id
      AND (responsible IS NULL OR ur.user_id <> responsible);
  END IF;

  RETURN NEW;
END $$;
