-- Plantilla de correo para el "Reporte de reembolso a cliente": cuando el
-- despacho absorbe un gasto que debe cobrarse al cliente, finanzas genera un
-- reporte con el desglose de gastos y lo envía. Se guarda en el catálogo de
-- plantillas (public.email_templates) con scope 'finance'.

-- 1) Ampliar el CHECK de scope para admitir 'finance'
ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_scope_check;
ALTER TABLE public.email_templates
  ADD CONSTRAINT email_templates_scope_check
  CHECK (scope IN ('pipeline', 'accounting', 'finance'));

-- 2) Ampliar el CHECK de category con la rama de finanzas
ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_category_check;
ALTER TABLE public.email_templates
  ADD CONSTRAINT email_templates_category_check
  CHECK (
    (scope = 'pipeline' AND category IN ('first_contact','follow_up','proposal','reactivation'))
    OR
    (scope = 'accounting' AND category IN (
      'isn_imss',
      'previos_provisionales',
      'pagos_provisionales',
      'declaracion_ceros',
      'envio_nominas',
      'envio_anuales'
    ))
    OR
    (scope = 'finance' AND category IN ('reembolso_cliente'))
  );

-- 3) Seed: una plantilla base de reporte de reembolso por organización
DO $$
DECLARE
  org record;
BEGIN
  FOR org IN SELECT id FROM public.organizations LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.email_templates
      WHERE organization_id = org.id AND scope = 'finance' AND category = 'reembolso_cliente'
    ) THEN
      INSERT INTO public.email_templates (organization_id, name, subject, body_html, category, scope, variables)
      VALUES (
        org.id,
        'Reporte de reembolso a cliente',
        'Reembolso de gastos — {{cliente}}',
        $body$
<p>Estimado(a) {{cliente}}:</p>
<p>Por medio del presente le compartimos el desglose de los gastos que el despacho cubrió por su cuenta y que corresponden a reembolso. Agradecemos su atención para gestionar el pago correspondiente.</p>
{{tabla_gastos}}
<p><strong>Total a reembolsar: {{total}}</strong></p>
<p>Quedamos atentos a cualquier aclaración. Puede encontrar los comprobantes correspondientes adjuntos o disponibles a solicitud.</p>
<p>Saludos cordiales,<br/>Área de Finanzas</p>
$body$,
        'reembolso_cliente',
        'finance',
        '[
          {"name":"cliente","label":"Cliente","type":"text","bold":false,"required":true},
          {"name":"tabla_gastos","label":"Desglose de gastos (tabla)","type":"text","bold":false,"required":true},
          {"name":"total","label":"Total a reembolsar","type":"currency","bold":true,"required":true}
        ]'::jsonb
      );
    END IF;
  END LOOP;
END $$;
