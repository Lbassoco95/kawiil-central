-- RH — Plantilla de correo faltante: "Recordatorio (48 h)".
-- Se agrega a las organizaciones que reclutan y que aún no la tengan por nombre.
DO $$
DECLARE o record;
BEGIN
  FOR o IN SELECT DISTINCT organization_id FROM public.rh_recruitment_processes LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.rh_email_templates
      WHERE organization_id = o.organization_id AND name = 'Recordatorio (48 h)'
    ) THEN
      INSERT INTO public.rh_email_templates (organization_id, name, subject, body) VALUES
      (o.organization_id, 'Recordatorio (48 h)',
       'Seguimiento de tu postulación — {{vacante}}',
       E'Hola {{nombre}},\n\nQueremos dar seguimiento a tu proceso para la vacante de {{vacante}} en {{empresa}}. Seguimos muy interesados en tu perfil.\n\n¿Nos confirmas si continúas interesado y tu disponibilidad? Quedamos atentos.\n\nSaludos,\n{{empresa}}');
    END IF;
  END LOOP;
END $$;
