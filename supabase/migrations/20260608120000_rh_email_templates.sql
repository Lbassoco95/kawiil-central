-- =============================================================
-- RH — Reclutamiento Fase C
-- Plantillas de email reutilizables (a nivel organización) con
-- variables tipo {{nombre}}, {{vacante}}, {{empresa}}, {{fase}}.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.rh_email_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  subject         text NOT NULL DEFAULT '',
  body            text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_email_tpl_org ON public.rh_email_templates(organization_id);

ALTER TABLE public.rh_email_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Recruiters manage rh_email_templates" ON public.rh_email_templates;
CREATE POLICY "Recruiters manage rh_email_templates" ON public.rh_email_templates
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()));

-- ---- Seed de plantillas por defecto para organizaciones que ya reclutan ----
DO $$
DECLARE o record;
BEGIN
  FOR o IN
    SELECT DISTINCT organization_id FROM public.rh_recruitment_processes
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.rh_email_templates WHERE organization_id = o.organization_id) THEN
      INSERT INTO public.rh_email_templates (organization_id, name, subject, body) VALUES
      (o.organization_id, 'Invitación a entrevista',
       'Entrevista para {{vacante}} en {{empresa}}',
       E'Hola {{nombre}},\n\nGracias por tu interés en la vacante de {{vacante}}. Nos gustaría invitarte a una entrevista para conocerte mejor.\n\n¿Qué disponibilidad tienes esta semana? Quedamos atentos para coordinar día y hora.\n\nSaludos,\n{{empresa}}'),
      (o.organization_id, 'Solicitud de documentos',
       'Documentos para tu proceso — {{vacante}}',
       E'Hola {{nombre}},\n\nPara continuar con tu proceso de {{vacante}} necesitamos los siguientes documentos:\n\n- Identificación oficial\n- Comprobante de estudios\n- CV actualizado\n\nGracias de antemano.\n\nSaludos,\n{{empresa}}'),
      (o.organization_id, 'Oferta laboral',
       '¡Tenemos una oferta para ti! — {{vacante}}',
       E'Hola {{nombre}},\n\nNos da mucho gusto extenderte una oferta para la posición de {{vacante}} en {{empresa}}. Adjuntamos los detalles de la propuesta.\n\nQuedamos atentos a tus comentarios.\n\nSaludos,\n{{empresa}}'),
      (o.organization_id, 'Agradecimiento (no seleccionado)',
       'Sobre tu proceso en {{empresa}}',
       E'Hola {{nombre}},\n\nAgradecemos mucho el tiempo que dedicaste al proceso de {{vacante}}. En esta ocasión hemos decidido avanzar con otros perfiles.\n\nConservaremos tus datos para futuras oportunidades y te deseamos mucho éxito.\n\nSaludos,\n{{empresa}}');
    END IF;
  END LOOP;
END $$;
