-- Seed plantillas Backoffice PM (carátula) + Softlanding marco A1
-- Placeholders literales [TOKEN] alineados al inventario DOCX (D6).

DO $$
DECLARE
  v_bo uuid;
  v_sl uuid;
BEGIN
  -- Backoffice carátula + clausulado resumido (MVP HTML; DOCX legal de referencia en store)
  IF NOT EXISTS (
    SELECT 1 FROM public.contract_templates
    WHERE organization_id IS NULL AND package_kind = 'backoffice_pm' AND template_key = 'backoffice_pm_caratula' AND version = 1
  ) THEN
    INSERT INTO public.contract_templates (
      organization_id, package_kind, template_key, name, version, body_html, body_format,
      sign_policy, package_item_key, is_active, metadata
    ) VALUES (
      NULL, 'backoffice_pm', 'backoffice_pm_caratula',
      'Backoffice PM — Carátula + clausulado (MVP)',
      1,
      $html$
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"/><title>Contrato Backoffice PM</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;font-size:12pt;line-height:1.45;color:#111;max-width:720px;margin:2rem auto;padding:0 1rem}
  h1{font-size:14pt;text-align:center;text-transform:uppercase;letter-spacing:.04em}
  h2{font-size:12pt;margin-top:1.6rem;border-bottom:1px solid #333;padding-bottom:.2rem}
  table{width:100%;border-collapse:collapse;margin:.8rem 0}
  th,td{border:1px solid #444;padding:.35rem .5rem;vertical-align:top;text-align:left}
  th{background:#f3f3f3;width:38%}
  .muted{color:#555;font-size:10pt}
  .sign{margin-top:2.5rem;display:flex;justify-content:space-between;gap:2rem}
  .sign div{flex:1;text-align:center;border-top:1px solid #111;padding-top:.5rem}
</style>
</head>
<body>
  <h1>Contrato de prestación de servicios profesionales de Backoffice (Persona Moral)</h1>
  <p class="muted">Documento generado en Kawiil OS para firma externa. Los montos provienen del catálogo + ajustes del deal (no hardcode en plantilla legal).</p>

  <h2>Anexo A — Carátula</h2>
  <table>
    <tr><th>Fecha</th><td>[DD/MM/AAAA]</td></tr>
    <tr><th>Lugar</th><td>[CIUDAD DE MÉXICO, MÉXICO]</td></tr>
    <tr><th>Denominación o razón social</th><td>[DENOMINACIÓN O RAZÓN SOCIAL]</td></tr>
    <tr><th>Escritura / Notaría / Folio</th><td>[NÚMERO DE ESCRITURA] · [NOTARÍA Y FEDATARIO] · [FOLIO MERCANTIL ELECTRÓNICO]</td></tr>
    <tr><th>Representante</th><td>[NOMBRE DEL REPRESENTANTE] · [INSTRUMENTO DEL QUE DERIVAN SUS FACULTADES]</td></tr>
    <tr><th>RFC</th><td>[RFC]</td></tr>
    <tr><th>Domicilio fiscal</th><td>[DOMICILIO FISCAL]</td></tr>
    <tr><th>Servicios contratados</th><td>[SERVICIOS CONTRATADOS]</td></tr>
    <tr><th>Actividad vulnerable LFPIORPI</th><td>[SÍ / NO]</td></tr>
    <tr><th>Plan Backoffice</th><td>[PLAN NOMBRE] ([PLAN CÓDIGO])</td></tr>
    <tr><th>Honorario lista (mensual)</th><td>$[MONTO LISTA] M.N., más IVA</td></tr>
    <tr><th>Descuento / ajuste</th><td>[DESCUENTO]</td></tr>
    <tr><th>Honorario neto (mensual)</th><td>$[MONTO] M.N., más IVA</td></tr>
    <tr><th>Forma de pago</th><td>[FORMA DE PAGO]</td></tr>
    <tr><th>Personas autorizadas</th><td>[PERSONAS AUTORIZADAS]</td></tr>
    <tr><th>Correo de contacto</th><td>[CORREO CLIENTE]</td></tr>
  </table>

  <h2>Cláusulas (resumen operativo MVP)</h2>
  <p>El clausulado completo del contrato reforzado de Backoffice Persona Moral (objeto, obligaciones, honorarios, vigencia, confidencialidad, PLD, terminación, jurisdicción, firma electrónica y conservación) se incorpora por referencia al paquete legal vigente. Esta carátula fija los datos variables del cliente y las condiciones económicas del deal.</p>
  <p><strong>Objeto:</strong> servicios de backoffice marcados en la carátula (contabilidad y cumplimiento fiscal, asesoría fiscal, asesoría legal y/o asesoría empresarial). Servicios adicionales se documentarán mediante Orden de Servicio (Anexo B), emitida durante el servicio y no en esta firma inicial.</p>
  <p><strong>Honorarios:</strong> el monto neto mensual indicado en la carátula ([MONTO]), con IVA no incluido salvo pacto distinto. Lista y descuento quedan asentados para transparencia del deal.</p>

  <div class="sign">
    <div>LA PARTE CONTRATANTE<br/>[NOMBRE DEL REPRESENTANTE]</div>
    <div>LA PARTE PRESTADORA<br/>Bassoco, Vega, Salas, Morales, Servicios Empresariales S.C.<br/>Leopoldo Bassoco Nova</div>
  </div>
</body>
</html>
$html$,
      'html', 'with_marco', 'caratula_a1', true,
      '{"source_docx":"CONTRATO_DE_BACKOFFICE_PERSONA_MORAL_REFORZADO.docx","mvp_note":"HTML merge; clausulado completo vía Legal"}'::jsonb
    )
    RETURNING id INTO v_bo;

    INSERT INTO public.contract_template_fields (template_id, field_key, label, field_type, required, placeholder_in_body, sort_order, help_text) VALUES
      (v_bo, 'firma.fecha', 'Fecha del contrato', 'date', true, '[DD/MM/AAAA]', 10, NULL),
      (v_bo, 'firma.lugar', 'Lugar', 'text', true, '[CIUDAD DE MÉXICO, MÉXICO]', 20, NULL),
      (v_bo, 'client.legal_name', 'Denominación o razón social', 'text', true, '[DENOMINACIÓN O RAZÓN SOCIAL]', 30, NULL),
      (v_bo, 'client.escritura', 'Número de escritura', 'text', false, '[NÚMERO DE ESCRITURA]', 40, NULL),
      (v_bo, 'client.notaria', 'Notaría y fedatario', 'text', false, '[NOTARÍA Y FEDATARIO]', 50, NULL),
      (v_bo, 'client.folio_mercantil', 'Folio mercantil electrónico', 'text', false, '[FOLIO MERCANTIL ELECTRÓNICO]', 60, NULL),
      (v_bo, 'client.representante', 'Nombre del representante', 'text', true, '[NOMBRE DEL REPRESENTANTE]', 70, NULL),
      (v_bo, 'client.instrumento', 'Instrumento de facultades', 'text', false, '[INSTRUMENTO DEL QUE DERIVAN SUS FACULTADES]', 80, NULL),
      (v_bo, 'client.rfc', 'RFC', 'text', true, '[RFC]', 90, NULL),
      (v_bo, 'client.domicilio_fiscal', 'Domicilio fiscal', 'text', true, '[DOMICILIO FISCAL]', 100, NULL),
      (v_bo, 'services.labeled', 'Servicios contratados', 'text', true, '[SERVICIOS CONTRATADOS]', 110, NULL),
      (v_bo, 'client.lfpiorpi', 'Actividad vulnerable LFPIORPI', 'text', false, '[SÍ / NO]', 120, NULL),
      (v_bo, 'plan_name', 'Plan Backoffice', 'text', true, '[PLAN NOMBRE]', 130, NULL),
      (v_bo, 'plan_id', 'Código de plan', 'text', true, '[PLAN CÓDIGO]', 135, NULL),
      (v_bo, 'list_price', 'Honorario lista', 'number', true, '[MONTO LISTA]', 140, NULL),
      (v_bo, 'discount_label', 'Descuento / ajuste', 'text', false, '[DESCUENTO]', 150, NULL),
      (v_bo, 'net_price', 'Honorario neto', 'number', true, '[MONTO]', 160, NULL),
      (v_bo, 'payment_method', 'Forma de pago', 'text', false, '[FORMA DE PAGO]', 170, NULL),
      (v_bo, 'authorized_persons', 'Personas autorizadas', 'text', false, '[PERSONAS AUTORIZADAS]', 180, NULL),
      (v_bo, 'client.email', 'Correo de contacto', 'email', false, '[CORREO CLIENTE]', 190, NULL);
  END IF;

  -- Softlanding marco + A1 (MVP día 0); anexos B/C/D quedan pending en engagement
  IF NOT EXISTS (
    SELECT 1 FROM public.contract_templates
    WHERE organization_id IS NULL AND package_kind = 'softlanding' AND template_key = 'softlanding_marco_a1' AND version = 1
  ) THEN
    INSERT INTO public.contract_templates (
      organization_id, package_kind, template_key, name, version, body_html, body_format,
      sign_policy, package_item_key, is_active, metadata
    ) VALUES (
      NULL, 'softlanding', 'softlanding_marco_a1',
      'Softlanding — Contrato marco + Anexo A Sec.1 (MVP)',
      1,
      $html$
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"/><title>Contrato Marco Softlanding</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;font-size:12pt;line-height:1.45;color:#111;max-width:720px;margin:2rem auto;padding:0 1rem}
  h1{font-size:14pt;text-align:center;text-transform:uppercase}
  h2{font-size:12pt;margin-top:1.6rem;border-bottom:1px solid #333;padding-bottom:.2rem}
  table{width:100%;border-collapse:collapse;margin:.8rem 0}
  th,td{border:1px solid #444;padding:.35rem .5rem;vertical-align:top;text-align:left}
  th{background:#f3f3f3;width:38%}
  .muted{color:#555;font-size:10pt}
</style>
</head>
<body>
  <h1>Contrato marco de prestación de servicios profesionales de Softlanding en México</h1>
  <p class="muted">MVP: carátula Anexo A Sección 1 + referencia al clausulado. Anexos A2/B/C/D se emiten durante el servicio (D11), no en esta firma.</p>

  <h2>Anexo A — Sección 1 (firma inicial)</h2>
  <table>
    <tr><th>Fecha</th><td>[DD/MM/AAAA]</td></tr>
    <tr><th>Lugar</th><td>[CIUDAD DE MÉXICO, MÉXICO]</td></tr>
    <tr><th>Denominación opción 1</th><td>[OPCIÓN 1]</td></tr>
    <tr><th>Denominación opción 2</th><td>[OPCIÓN 2]</td></tr>
    <tr><th>Denominación opción 3</th><td>[OPCIÓN 3]</td></tr>
    <tr><th>Tipo societario</th><td>[TIPO SOCIETARIO]</td></tr>
    <tr><th>Capital social</th><td>$[CAPITAL] M.N.</td></tr>
    <tr><th>Objeto social</th><td>[OBJETO SOCIAL]</td></tr>
    <tr><th>Domicilio social</th><td>[DOMICILIO SOCIAL]</td></tr>
    <tr><th>Órgano de administración</th><td>[ORGANO ADMIN]: [ADMIN NOMBRES]</td></tr>
    <tr><th>Tendrá trabajadores</th><td>[SÍ / NO] (máx. [NÚMERO])</td></tr>
    <tr><th>Representante / contacto</th><td>[NOMBRE DEL REPRESENTANTE]</td></tr>
    <tr><th>Correo</th><td>[CORREO CLIENTE]</td></tr>
    <tr><th>Honorario constitución (lista)</th><td>$[FEE CONSTITUCION] M.N.</td></tr>
    <tr><th>Honorario recurrente</th><td>USD $[FEE RECURRENTE]</td></tr>
  </table>

  <h2>Cláusulas (referencia)</h2>
  <p>El clausulado completo del Contrato Marco Softlanding (29 cláusulas) se incorpora por referencia. Los Anexos B (e.firma), C (IMSS) y D (Orden de Servicio) <strong>no acompañan esta firma</strong> y se suscriben cuando exista el supuesto durante el servicio.</p>
</body>
</html>
$html$,
      'html', 'with_marco', 'marco', true,
      '{"source_docx":"CONTRATO_MARCO_SOFTLANDING_PLANTILLA.docx","deferred_items":["caratula_a2","anexo_b","anexo_c","anexo_d"]}'::jsonb
    )
    RETURNING id INTO v_sl;

    INSERT INTO public.contract_template_fields (template_id, field_key, label, field_type, required, placeholder_in_body, sort_order) VALUES
      (v_sl, 'firma.fecha', 'Fecha', 'date', true, '[DD/MM/AAAA]', 10),
      (v_sl, 'firma.lugar', 'Lugar', 'text', true, '[CIUDAD DE MÉXICO, MÉXICO]', 20),
      (v_sl, 'sociedad.denominacion_1', 'Denominación opción 1', 'text', true, '[OPCIÓN 1]', 30),
      (v_sl, 'sociedad.denominacion_2', 'Denominación opción 2', 'text', false, '[OPCIÓN 2]', 40),
      (v_sl, 'sociedad.denominacion_3', 'Denominación opción 3', 'text', false, '[OPCIÓN 3]', 50),
      (v_sl, 'sociedad.tipo', 'Tipo societario', 'text', true, '[TIPO SOCIETARIO]', 60),
      (v_sl, 'sociedad.capital', 'Capital social', 'number', false, '[CAPITAL]', 70),
      (v_sl, 'sociedad.objeto', 'Objeto social', 'textarea', false, '[OBJETO SOCIAL]', 80),
      (v_sl, 'sociedad.domicilio', 'Domicilio social', 'text', false, '[DOMICILIO SOCIAL]', 90),
      (v_sl, 'sociedad.orgao_admin', 'Órgano de administración', 'text', false, '[ORGANO ADMIN]', 100),
      (v_sl, 'sociedad.admin_nombres', 'Nombre(s) administrador(es)', 'text', false, '[ADMIN NOMBRES]', 110),
      (v_sl, 'sociedad.tendra_trabajadores', 'Tendrá trabajadores', 'text', false, '[SÍ / NO]', 120),
      (v_sl, 'sociedad.max_trabajadores', 'Máximo trabajadores', 'number', false, '[NÚMERO]', 130),
      (v_sl, 'client.legal_name', 'Nombre / razón (cliente)', 'text', true, '[DENOMINACIÓN O RAZÓN SOCIAL]', 140),
      (v_sl, 'client.representante', 'Representante', 'text', true, '[NOMBRE DEL REPRESENTANTE]', 150),
      (v_sl, 'client.rfc', 'RFC (si aplica)', 'text', false, '[RFC]', 160),
      (v_sl, 'client.email', 'Correo', 'email', false, '[CORREO CLIENTE]', 170),
      (v_sl, 'fees.constitucion', 'Honorario constitución', 'number', false, '[FEE CONSTITUCION]', 180),
      (v_sl, 'fees.recurrente_usd', 'Honorario recurrente USD', 'number', false, '[FEE RECURRENTE]', 190);
  END IF;
END $$;
