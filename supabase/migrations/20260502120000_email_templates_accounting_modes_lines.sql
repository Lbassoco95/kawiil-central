-- Ampliación de las plantillas contables:
--   1) Envolver <li> (y un <p> en anuales) con data-kvt-var="<nombre>" para poder
--      omitir esa línea completa cuando el modo de la variable sea "perdida" /
--      "no aplica".
--   2) Agregar `mode_support: true` (y `favor_text` cuando aplica) a las
--      variables de Pagos Provisionales y Anuales que soportan los modos
--      pago/saldo a favor/pérdida.
--
-- Idempotente: se ejecuta en UPDATE sobre filas existentes. Si el UPDATE no
-- encuentra fila (porque el seed inicial no se ejecutó para esa organización)
-- no pasa nada: cuando corra la 20260501120000 seed original, los variables ya
-- tendrán el esquema base y quedarán sin mode_support; se puede re-ejecutar
-- esta migración tantas veces como se necesite y el resultado es estable.

-- Pagos provisionales: envolver los 8 montos y fecha_limite en <li> con
-- data-kvt-var. Los 8 montos llevan mode_support; fecha_limite no (es
-- obligatoria).
UPDATE public.email_templates
SET body_html = $body$
<p>¡Hola {{razon_social}}!</p>
<p>Espero que estés teniendo un día tan increíble como recibir esta noticia: ¡Tu declaración de pagos provisionales está lista para hacer su gran entrada!</p>
<p>Aquí está el desglose de lo que necesitas saber:</p>
<ul>
  <li data-kvt-var="monto_isr"><strong>ISR Impuesto Sobre la Renta:</strong> <strong>${{monto_isr}}</strong></li>
  <li data-kvt-var="monto_iva"><strong>IVA Impuesto al Valor Agregado:</strong> <strong>${{monto_iva}}</strong></li>
  <li data-kvt-var="ret_sueldos"><strong>Retenciones por Sueldos:</strong> <strong>${{ret_sueldos}}</strong></li>
  <li data-kvt-var="ret_asimilados"><strong>Retenciones Asimiladas a Salarios:</strong> <strong>${{ret_asimilados}}</strong></li>
  <li data-kvt-var="ret_iva"><strong>Retenciones de IVA:</strong> <strong>${{ret_iva}}</strong></li>
  <li data-kvt-var="ret_isr"><strong>Retenciones de ISR:</strong> <strong>${{ret_isr}}</strong></li>
  <li data-kvt-var="monto_ieps"><strong>IEPS (Impuesto Especial sobre Producción y Servicios):</strong> <strong>${{monto_ieps}}</strong></li>
  <li data-kvt-var="isr_arrendamiento"><strong>ISR Arrendamiento:</strong> <strong>${{isr_arrendamiento}}</strong></li>
</ul>
<p>Tu fecha límite para el pago es: <strong>{{fecha_limite}}</strong></p>
<p>Por favor, revisa los detalles y si tienes alguna pregunta, ¡no dudes en ponerte en contacto! Estamos aquí para ti.</p>
<p>¡Gracias por confiar en nosotros para manejar tus asuntos financieros!</p>
$body$,
    variables = '[
      {"name":"razon_social","label":"Razón social","type":"text","bold":false,"required":true},
      {"name":"monto_isr","label":"ISR (Impuesto Sobre la Renta)","type":"currency","bold":true,"required":true,"mode_support":true,"favor_text":"(saldo a favor)"},
      {"name":"monto_iva","label":"IVA (Impuesto al Valor Agregado)","type":"currency","bold":true,"required":true,"mode_support":true,"favor_text":"(saldo a favor)"},
      {"name":"ret_sueldos","label":"Retenciones por sueldos","type":"currency","bold":true,"required":true,"mode_support":true,"favor_text":"(saldo a favor)"},
      {"name":"ret_asimilados","label":"Retenciones asimiladas a salarios","type":"currency","bold":true,"required":true,"mode_support":true,"favor_text":"(saldo a favor)"},
      {"name":"ret_iva","label":"Retenciones de IVA","type":"currency","bold":true,"required":true,"mode_support":true,"favor_text":"(saldo a favor)"},
      {"name":"ret_isr","label":"Retenciones de ISR","type":"currency","bold":true,"required":true,"mode_support":true,"favor_text":"(saldo a favor)"},
      {"name":"monto_ieps","label":"IEPS","type":"currency","bold":true,"required":true,"mode_support":true,"favor_text":"(saldo a favor)"},
      {"name":"isr_arrendamiento","label":"ISR Arrendamiento","type":"currency","bold":true,"required":true,"mode_support":true,"favor_text":"(saldo a favor)"},
      {"name":"fecha_limite","label":"Fecha límite de pago","type":"date","bold":true,"required":true}
    ]'::jsonb,
    updated_at = now()
WHERE scope = 'accounting' AND category = 'pagos_provisionales';

-- Envío de declaración anual: envolver saldo_favor, a_pagar y clabe en <p>
-- con data-kvt-var para poder omitir esa línea si no aplica.
UPDATE public.email_templates
SET body_html = $body$
<p>¡Hola {{razon_social}}!</p>
<p>Espero que estés teniendo un día increíble. 😊 Queríamos compartirte una noticia emocionante: ¡tu declaración anual de ISR está lista!</p>
<p data-kvt-var="saldo_favor"><strong>Saldo a favor:</strong> <strong>${{saldo_favor}}</strong> ¡Un pequeño premio para ti! 💰<br/>Además, te emocionará saber que este saldo a favor se aplicará automáticamente a períodos posteriores, ¡así que sigue acumulando beneficios! 💳💸</p>
<p data-kvt-var="a_pagar"><strong>A pagar:</strong> <strong>${{a_pagar}}</strong> ¡Nada que te haga saltar de tu asiento! 💸</p>
<p data-kvt-var="clabe"><strong>Devolución:</strong> ¡Sí, lo has adivinado! ¡Te mereces una devolución! 🎁<br/>Esta es la CLABE bancaria <strong>{{clabe}}</strong> a la que se realizará la devolución para que puedas hacer tus planes de shopping, inversión o lo que desees.</p>
<p>Por favor, revisa los detalles adjuntos y si tienes alguna pregunta o necesitas más información, ¡estamos aquí para ayudarte!</p>
<p>¡Gracias por confiar en nosotros para manejar tu declaración! 🚀</p>
<p>¡Que tengas un día lleno de alegría y buenos números!</p>
<p>Saludos cordiales,</p>
$body$,
    variables = '[
      {"name":"razon_social","label":"Razón social","type":"text","bold":false,"required":true},
      {"name":"saldo_favor","label":"Saldo a favor","type":"currency","bold":true,"required":false,"mode_support":true,"favor_text":"(saldo a favor)"},
      {"name":"a_pagar","label":"Monto a pagar","type":"currency","bold":true,"required":false,"mode_support":true,"favor_text":"(saldo a favor)"},
      {"name":"clabe","label":"CLABE bancaria para devolución","type":"text","bold":true,"required":false}
    ]'::jsonb,
    updated_at = now()
WHERE scope = 'accounting' AND category = 'envio_anuales';
