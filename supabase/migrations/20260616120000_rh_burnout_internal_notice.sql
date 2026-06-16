-- El burnout se auto-aprueba (status='approved'), por lo que rh_absence_after_insert
-- lo omitía (solo notificaba solicitudes 'pending') y quedaba sin rastro en la
-- campana interna. Aquí añadimos un aviso informativo al G4 responsable cuando se
-- registra un burnout, manteniendo intacto el flujo de aprobación de 'pending'.
CREATE OR REPLACE FUNCTION public.rh_absence_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  approver uuid := NEW.assigned_approver_user_id;
  requester_name text;
  requester_is_g4 boolean;
  rango text;
  cuerpo text;
BEGIN
  SELECT full_name INTO requester_name FROM public.profiles WHERE user_id = NEW.user_id;
  requester_is_g4 := EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = NEW.user_id AND role = 'transformador'
  );

  rango := to_char(NEW.start_date, 'DD/MM')
           || CASE WHEN NEW.end_date <> NEW.start_date THEN '–' || to_char(NEW.end_date, 'DD/MM') ELSE '' END;

  IF NEW.status = 'pending' THEN
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

  ELSIF NEW.absence_type = 'burnout' AND NEW.status = 'approved' THEN
    -- Burnout auto-aprobado: aviso informativo (no requiere acción) al G4 responsable.
    cuerpo := coalesce(requester_name, 'Un colaborador')
              || CASE WHEN requester_is_g4 THEN ' (G4)' ELSE '' END
              || ' registró un día de burnout (aprobado automáticamente) · ' || rango
              || ' (' || public.rh_day_part_label(NEW.day_part) || ')';

    IF approver IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, organization_id, type, title, body, entity_type, entity_id, is_read, source_user_id)
      VALUES (approver, NEW.organization_id, 'rh_burnout_logged', 'Día de burnout registrado', cuerpo, 'rh', NEW.id, false, NEW.user_id);
    ELSE
      INSERT INTO public.notifications (user_id, organization_id, type, title, body, entity_type, entity_id, is_read, source_user_id)
      SELECT ur.user_id, NEW.organization_id, 'rh_burnout_logged', 'Día de burnout registrado', cuerpo, 'rh', NEW.id, false, NEW.user_id
      FROM public.user_roles ur
      JOIN public.profiles p ON p.user_id = ur.user_id AND p.organization_id = NEW.organization_id
      WHERE ur.role = 'transformador' AND ur.user_id <> NEW.user_id;
    END IF;
  END IF;

  RETURN NEW;
END $$;
