-- =============================================================
-- RH — Entrega 3: solicitudes de ausencias
-- Vacaciones, día personal, evento escolar/familiar, permiso e
-- incapacidad. Medio día (mañana/tarde). Aprueba el G4 responsable
-- de la célula del solicitante. Avisos vía notifications y memoria
-- para Kawiil AI (ai_user_memories).
-- =============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rh_absence_type') THEN
    CREATE TYPE public.rh_absence_type AS ENUM (
      'vacaciones', 'dia_personal', 'evento_escolar_familiar', 'permiso', 'incapacidad'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rh_day_part') THEN
    CREATE TYPE public.rh_day_part AS ENUM ('full_day', 'morning', 'afternoon');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rh_request_status') THEN
    CREATE TYPE public.rh_request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.rh_absence_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  celula_id        uuid REFERENCES public.celulas(id) ON DELETE SET NULL,
  absence_type     public.rh_absence_type NOT NULL,
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  day_part         public.rh_day_part NOT NULL DEFAULT 'full_day',
  reason           text,
  status           public.rh_request_status NOT NULL DEFAULT 'pending',
  approver_user_id uuid REFERENCES auth.users(id),
  decided_at       timestamptz,
  decision_note    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rh_absence_dates_ok CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_rh_absence_user ON public.rh_absence_requests(user_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_rh_absence_celula ON public.rh_absence_requests(celula_id, status);
CREATE INDEX IF NOT EXISTS idx_rh_absence_org ON public.rh_absence_requests(organization_id, status);

DROP TRIGGER IF EXISTS set_updated_at_rh_absence ON public.rh_absence_requests;
CREATE TRIGGER set_updated_at_rh_absence
  BEFORE UPDATE ON public.rh_absence_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- RLS
-- =============================================================
ALTER TABLE public.rh_absence_requests ENABLE ROW LEVEL SECURITY;

-- ¿Es auth.uid() el responsable (G4) de la célula de la solicitud?
CREATE OR REPLACE FUNCTION public.rh_is_celula_responsible(_celula_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.celulas c
    WHERE c.id = _celula_id AND c.responsible_user_id = auth.uid()
  )
$$;

DROP POLICY IF EXISTS "Read own or approver or G4" ON public.rh_absence_requests;
CREATE POLICY "Read own or approver or G4" ON public.rh_absence_requests
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      user_id = auth.uid()
      OR public.rh_is_celula_responsible(celula_id)
      OR public.has_role(auth.uid(), 'transformador')
    )
  );

DROP POLICY IF EXISTS "Insert own request" ON public.rh_absence_requests;
CREATE POLICY "Insert own request" ON public.rh_absence_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = public.get_user_org_id(auth.uid())
    AND status = 'pending'
  );

-- El solicitante puede editar/cancelar mientras esté pendiente.
DROP POLICY IF EXISTS "Requester updates own pending" ON public.rh_absence_requests;
CREATE POLICY "Requester updates own pending" ON public.rh_absence_requests
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid());

-- El G4 responsable de la célula decide (aprueba/rechaza).
DROP POLICY IF EXISTS "Approver decides" ON public.rh_absence_requests;
CREATE POLICY "Approver decides" ON public.rh_absence_requests
  FOR UPDATE TO authenticated
  USING (public.rh_is_celula_responsible(celula_id))
  WITH CHECK (public.rh_is_celula_responsible(celula_id));

-- =============================================================
-- Avisos + memoria de IA
-- =============================================================
CREATE OR REPLACE FUNCTION public.rh_absence_type_label(_t public.rh_absence_type)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _t
    WHEN 'vacaciones' THEN 'vacaciones'
    WHEN 'dia_personal' THEN 'día personal'
    WHEN 'evento_escolar_familiar' THEN 'evento escolar/familiar'
    WHEN 'permiso' THEN 'permiso'
    WHEN 'incapacidad' THEN 'incapacidad'
  END
$$;

CREATE OR REPLACE FUNCTION public.rh_day_part_label(_p public.rh_day_part)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _p
    WHEN 'full_day' THEN 'día completo'
    WHEN 'morning' THEN 'medio día (mañana)'
    WHEN 'afternoon' THEN 'medio día (tarde)'
  END
$$;

-- Al crear: avisa al G4 responsable de la célula.
CREATE OR REPLACE FUNCTION public.rh_absence_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  responsible uuid;
  requester_name text;
  rango text;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  SELECT responsible_user_id INTO responsible FROM public.celulas WHERE id = NEW.celula_id;
  IF responsible IS NULL OR responsible = NEW.user_id THEN RETURN NEW; END IF;
  SELECT full_name INTO requester_name FROM public.profiles WHERE user_id = NEW.user_id;
  rango := to_char(NEW.start_date, 'DD/MM')
           || CASE WHEN NEW.end_date <> NEW.start_date THEN '–' || to_char(NEW.end_date, 'DD/MM') ELSE '' END;
  INSERT INTO public.notifications (user_id, organization_id, type, title, body, entity_type, entity_id, is_read, source_user_id)
  VALUES (
    responsible, NEW.organization_id, 'rh_request_pending',
    'Solicitud de ausencia por aprobar',
    coalesce(requester_name, 'Un colaborador') || ' solicitó ' || public.rh_absence_type_label(NEW.absence_type)
      || ' · ' || rango || ' (' || public.rh_day_part_label(NEW.day_part) || ')',
    'rh', NEW.id, false, NEW.user_id
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rh_absence_after_insert_t ON public.rh_absence_requests;
CREATE TRIGGER rh_absence_after_insert_t
  AFTER INSERT ON public.rh_absence_requests
  FOR EACH ROW EXECUTE FUNCTION public.rh_absence_after_insert();

-- Al decidir: avisa al solicitante y, si se aprueba, deja memoria para Kawiil AI.
CREATE OR REPLACE FUNCTION public.rh_absence_after_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rango text;
  mem text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved', 'rejected') THEN RETURN NEW; END IF;

  rango := to_char(NEW.start_date, 'DD/MM/YYYY')
           || CASE WHEN NEW.end_date <> NEW.start_date THEN ' al ' || to_char(NEW.end_date, 'DD/MM/YYYY') ELSE '' END;

  INSERT INTO public.notifications (user_id, organization_id, type, title, body, entity_type, entity_id, is_read, source_user_id)
  VALUES (
    NEW.user_id, NEW.organization_id, 'rh_request_decided',
    CASE WHEN NEW.status = 'approved' THEN 'Solicitud aprobada' ELSE 'Solicitud rechazada' END,
    'Tu ' || public.rh_absence_type_label(NEW.absence_type) || ' (' || rango || ') fue '
      || CASE WHEN NEW.status = 'approved' THEN 'aprobada' ELSE 'rechazada' END
      || coalesce('. Nota: ' || NEW.decision_note, ''),
    'rh', NEW.id, false, NEW.approver_user_id
  );

  IF NEW.status = 'approved' THEN
    mem := 'Ausencia aprobada: ' || public.rh_absence_type_label(NEW.absence_type) || ' del ' || rango
           || ' (' || public.rh_day_part_label(NEW.day_part) || ').';
    INSERT INTO public.ai_user_memories (organization_id, user_id, memory_type, content, content_hash, enabled)
    VALUES (NEW.organization_id, NEW.user_id, 'context', mem, md5(mem), true)
    ON CONFLICT (organization_id, user_id, content_hash) DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rh_absence_after_update_t ON public.rh_absence_requests;
CREATE TRIGGER rh_absence_after_update_t
  AFTER UPDATE ON public.rh_absence_requests
  FOR EACH ROW EXECUTE FUNCTION public.rh_absence_after_update();
