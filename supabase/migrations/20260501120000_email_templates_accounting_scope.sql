-- Amplía public.email_templates para soportar plantillas del área contable
-- ademas del pipeline existente. Añade columnas scope y variables, relaja el
-- CHECK de category según scope y siembra las 6 plantillas base en cada
-- organización.

-- 1) Columna scope
ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'pipeline';

-- 2) Columna variables (definición declarativa del formulario de llenado)
ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS variables jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.email_templates.scope IS
  'Dominio funcional de la plantilla: pipeline (ventas) o accounting (contabilidad).';
COMMENT ON COLUMN public.email_templates.variables IS
  'Esquema JSON de las variables de la plantilla: [{name,label,type:text|currency|date,bold:boolean,required:boolean}].';

-- 3) CHECK de scope
ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_scope_check;
ALTER TABLE public.email_templates
  ADD CONSTRAINT email_templates_scope_check
  CHECK (scope IN ('pipeline','accounting'));

-- 4) Reemplazar CHECK de category por uno condicional según scope
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
  );

-- 5) Índice por (organization_id, scope)
CREATE INDEX IF NOT EXISTS idx_email_templates_scope
  ON public.email_templates(organization_id, scope);

-- 6) Seed: insertar las 6 plantillas base en cada organización si no existen
DO $$
DECLARE
  org record;
BEGIN
  FOR org IN SELECT id FROM public.organizations LOOP

    -- ISN e IMSS
    IF NOT EXISTS (
      SELECT 1 FROM public.email_templates
      WHERE organization_id = org.id AND scope = 'accounting' AND category = 'isn_imss'
    ) THEN
      INSERT INTO public.email_templates (organization_id, name, subject, body_html, category, scope, variables)
      VALUES (
        org.id,
        'ISN e IMSS',
        '¡Tiembla, ISN e IMSS! Aquí llegan los Detalles de Pago 😄',
        $body$
<p>¡Hola {{razon_social}}! 👋</p>
<p>¡Esperamos que tu día esté tan lleno de buen humor como el nuestro!<br/>Solo una pequeña pausa para compartir contigo los detalles de los pagos de ISN e IMSS:</p>
<p><strong>ISN Impuesto Sobre Nómina</strong><br/>• Monto: ${{monto_isn}}</p>
<p><strong>IMSS Instituto Mexicano del Seguro Social</strong><br/>• Monto: ${{monto_imss}}</p>
<p>Tu fecha límite para el pago es: <strong>{{fecha_limite}}</strong></p>
<p>Si necesitas algo más que emojis y buen humor, ¡aquí estamos para ayudarte!</p>
<p>¡Un abrazo lleno de energía positiva!</p>
$body$,
        'isn_imss',
        'accounting',
        '[
          {"name":"razon_social","label":"Razón social","type":"text","bold":false,"required":true},
          {"name":"monto_isn","label":"Monto ISN","type":"currency","bold":false,"required":true},
          {"name":"monto_imss","label":"Monto IMSS","type":"currency","bold":false,"required":true},
          {"name":"fecha_limite","label":"Fecha límite de pago","type":"date","bold":true,"required":true}
        ]'::jsonb
      );
    END IF;

    -- Previos Provisionales
    IF NOT EXISTS (
      SELECT 1 FROM public.email_templates
      WHERE organization_id = org.id AND scope = 'accounting' AND category = 'previos_provisionales'
    ) THEN
      INSERT INTO public.email_templates (organization_id, name, subject, body_html, category, scope, variables)
      VALUES (
        org.id,
        'Previos provisionales',
        '¡Es hora de jugar al adelanto de impuestos!',
        $body$
<p>¡Hola {{razon_social}}!</p>
<p>Te enviamos un previo de tu pago provisional de IVA, ISR y retenciones. ¡Esperamos que te guste lo que ves y nos des luz verde para enviar la declaración completa!</p>
<p>¡Solo dinos cuándo estás listo para el gran final!</p>
<p>Quedo pendiente para enviar líneas de pago.</p>
<p>¡Saludos!</p>
$body$,
        'previos_provisionales',
        'accounting',
        '[
          {"name":"razon_social","label":"Razón social","type":"text","bold":false,"required":true}
        ]'::jsonb
      );
    END IF;

    -- Pagos Provisionales
    IF NOT EXISTS (
      SELECT 1 FROM public.email_templates
      WHERE organization_id = org.id AND scope = 'accounting' AND category = 'pagos_provisionales'
    ) THEN
      INSERT INTO public.email_templates (organization_id, name, subject, body_html, category, scope, variables)
      VALUES (
        org.id,
        'Pagos provisionales',
        '¡Tu Declaración de Pagos Provisionales Está Lista para Brillar!',
        $body$
<p>¡Hola {{razon_social}}!</p>
<p>Espero que estés teniendo un día tan increíble como recibir esta noticia: ¡Tu declaración de pagos provisionales está lista para hacer su gran entrada!</p>
<p>Aquí está el desglose de lo que necesitas saber:</p>
<ul>
  <li><strong>ISR Impuesto Sobre la Renta:</strong> <strong>${{monto_isr}}</strong></li>
  <li><strong>IVA Impuesto al Valor Agregado:</strong> <strong>${{monto_iva}}</strong></li>
  <li><strong>Retenciones por Sueldos:</strong> <strong>${{ret_sueldos}}</strong></li>
  <li><strong>Retenciones Asimiladas a Salarios:</strong> <strong>${{ret_asimilados}}</strong></li>
  <li><strong>Retenciones de IVA:</strong> <strong>${{ret_iva}}</strong></li>
  <li><strong>Retenciones de ISR:</strong> <strong>${{ret_isr}}</strong></li>
  <li><strong>IEPS (Impuesto Especial sobre Producción y Servicios):</strong> <strong>${{monto_ieps}}</strong></li>
  <li><strong>ISR Arrendamiento:</strong> <strong>${{isr_arrendamiento}}</strong></li>
</ul>
<p>Tu fecha límite para el pago es: <strong>{{fecha_limite}}</strong></p>
<p>Por favor, revisa los detalles y si tienes alguna pregunta, ¡no dudes en ponerte en contacto! Estamos aquí para ti.</p>
<p>¡Gracias por confiar en nosotros para manejar tus asuntos financieros!</p>
$body$,
        'pagos_provisionales',
        'accounting',
        '[
          {"name":"razon_social","label":"Razón social","type":"text","bold":false,"required":true},
          {"name":"monto_isr","label":"ISR (Impuesto Sobre la Renta)","type":"currency","bold":true,"required":true},
          {"name":"monto_iva","label":"IVA (Impuesto al Valor Agregado)","type":"currency","bold":true,"required":true},
          {"name":"ret_sueldos","label":"Retenciones por sueldos","type":"currency","bold":true,"required":true},
          {"name":"ret_asimilados","label":"Retenciones asimiladas a salarios","type":"currency","bold":true,"required":true},
          {"name":"ret_iva","label":"Retenciones de IVA","type":"currency","bold":true,"required":true},
          {"name":"ret_isr","label":"Retenciones de ISR","type":"currency","bold":true,"required":true},
          {"name":"monto_ieps","label":"IEPS","type":"currency","bold":true,"required":true},
          {"name":"isr_arrendamiento","label":"ISR Arrendamiento","type":"currency","bold":true,"required":true},
          {"name":"fecha_limite","label":"Fecha límite de pago","type":"date","bold":true,"required":true}
        ]'::jsonb
      );
    END IF;

    -- Declaración provisional en ceros
    IF NOT EXISTS (
      SELECT 1 FROM public.email_templates
      WHERE organization_id = org.id AND scope = 'accounting' AND category = 'declaracion_ceros'
    ) THEN
      INSERT INTO public.email_templates (organization_id, name, subject, body_html, category, scope, variables)
      VALUES (
        org.id,
        'Declaración provisional en ceros',
        'Declaración provisional en ceros presentada',
        $body$
<p>¡Hola {{razon_social}}!</p>
<p>Pasamos a darte una buena noticia ¡de esas que sí alegran el mes!:</p>
<p>Tu declaración provisional del mes de <strong>{{mes_anio}}</strong> ha sido presentada correctamente... y fue en ceros. Así es, este mes no hubo movimiento que reportar, pero nosotros cumplimos como siempre con dejar todo al día.</p>
<p>Nada que pagar, nada que temer. Solo tranquilidad fiscal.</p>
<p>Si necesitas el acuse o tienes dudas sobre cualquier otro tema, ¡estamos a un clic de distancia!</p>
<p>¡Gracias por seguir confiando en nosotros!<br/>Te mandamos un saludo libre de IVA, ISR y estrés.</p>
$body$,
        'declaracion_ceros',
        'accounting',
        '[
          {"name":"razon_social","label":"Razón social","type":"text","bold":false,"required":true},
          {"name":"mes_anio","label":"Mes y año de la declaración","type":"text","bold":false,"required":true}
        ]'::jsonb
      );
    END IF;

    -- Envío de Nóminas
    IF NOT EXISTS (
      SELECT 1 FROM public.email_templates
      WHERE organization_id = org.id AND scope = 'accounting' AND category = 'envio_nominas'
    ) THEN
      INSERT INTO public.email_templates (organization_id, name, subject, body_html, category, scope, variables)
      VALUES (
        org.id,
        'Envío de nóminas',
        'Abracadabra! Tus Recibos de Nómina están aquí',
        $body$
<p>¡Hola {{razon_social}}!</p>
<p>¡Es hora de darle un toque de magia a la jornada de pago! ✨ Los Recibos de Nómina de tus talentosos empleados han llegado, directo a tu bandeja de entrada. 🎩🎉</p>
<p>¿Listo para hacer que la magia suceda? Si necesitas ayuda extra, ¡solo dinos y estaremos encantados de ayudarte!</p>
<p>Gracias por confiar en nosotros una vez más.</p>
<p>Saludos mágicos,</p>
$body$,
        'envio_nominas',
        'accounting',
        '[
          {"name":"razon_social","label":"Razón social","type":"text","bold":false,"required":true}
        ]'::jsonb
      );
    END IF;

    -- Envío de Anuales
    IF NOT EXISTS (
      SELECT 1 FROM public.email_templates
      WHERE organization_id = org.id AND scope = 'accounting' AND category = 'envio_anuales'
    ) THEN
      INSERT INTO public.email_templates (organization_id, name, subject, body_html, category, scope, variables)
      VALUES (
        org.id,
        'Envío de declaración anual',
        '¡Tu declaración anual de ISR está lista! 🎉',
        $body$
<p>¡Hola {{razon_social}}!</p>
<p>Espero que estés teniendo un día increíble. 😊 Queríamos compartirte una noticia emocionante: ¡tu declaración anual de ISR está lista!</p>
<p><strong>Saldo a favor:</strong> <strong>${{saldo_favor}}</strong> ¡Un pequeño premio para ti! 💰<br/>Además, te emocionará saber que este saldo a favor se aplicará automáticamente a períodos posteriores, ¡así que sigue acumulando beneficios! 💳💸</p>
<p><strong>A pagar:</strong> <strong>${{a_pagar}}</strong> ¡Nada que te haga saltar de tu asiento! 💸</p>
<p><strong>Devolución:</strong> ¡Sí, lo has adivinado! ¡Te mereces una devolución! 🎁<br/>Esta es la CLABE bancaria <strong>{{clabe}}</strong> a la que se realizará la devolución para que puedas hacer tus planes de shopping, inversión o lo que desees.</p>
<p>Por favor, revisa los detalles adjuntos y si tienes alguna pregunta o necesitas más información, ¡estamos aquí para ayudarte!</p>
<p>¡Gracias por confiar en nosotros para manejar tu declaración! 🚀</p>
<p>¡Que tengas un día lleno de alegría y buenos números!</p>
<p>Saludos cordiales,</p>
$body$,
        'envio_anuales',
        'accounting',
        '[
          {"name":"razon_social","label":"Razón social","type":"text","bold":false,"required":true},
          {"name":"saldo_favor","label":"Saldo a favor","type":"currency","bold":true,"required":false},
          {"name":"a_pagar","label":"Monto a pagar","type":"currency","bold":true,"required":false},
          {"name":"clabe","label":"CLABE bancaria para devolución","type":"text","bold":true,"required":false}
        ]'::jsonb
      );
    END IF;

  END LOOP;
END $$;
