-- Plantilla nominal usada en pipeline: PDF Softlanding + texto para revisión e inicio de proceso.
-- Coincide por nombre (mayúsculas/espacios) y variantes comunes del guion.

UPDATE public.email_templates
SET
  default_attachment_key = 'softlanding_hub_mexico',
  category = 'proposal',
  subject = '{{nombre}} — Propuesta comercial Softlanding México (adjunto para revisión)',
  body_html = $body$
<p>Hola {{nombre}},</p>
<p>Te adjuntamos en PDF nuestra <strong>propuesta comercial – Softlanding Hub en México</strong>. Incluye alcance, modalidades y siguientes pasos para que <strong>{{empresa}}</strong> pueda revisarlo con el equipo y tomar una decisión informada.</p>
<p>Cuando lo hayan leído, escríbenos si desean <strong>iniciar el proceso</strong> con Kawiil o si prefieren una llamada breve para resolver dudas: basta con responder a este correo.</p>
<p>Saludos cordiales,<br/>Equipo Kawiil</p>
$body$,
  updated_at = now()
WHERE lower(regexp_replace(regexp_replace(trim(name), '[–—]', '-', 'g'), '\s+', ' ', 'g'))
  LIKE 'propuesta comercial - softlanding%';
