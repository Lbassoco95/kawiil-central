-- =================================================================
-- Pruebas de base de las correcciones previas al PR (C2, C3, C4, V1, V2).
-- Se corre DESPUÉS de 10_isolation_test.sql en la misma sesión (usa sus datos
-- sintéticos, variables y utilidades). Todo el material es sintético.
-- =================================================================
\set ON_ERROR_STOP 1
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT set_config('portal.pre_request_ran', 'on', false);

-- =================================================================
-- C2 · El CSD solo se recibe con autorización previa
-- =================================================================
-- ua (admin de A) ya aceptó el aviso vigente en 10_…; ub (admin de B) no.
SELECT portal_test.ok((public.portal_csd_upload_check(:'cla', :'ua', 'portal')->>'ok')::boolean,
  'C2 portal: admin con aviso vigente aceptado → puede cargar');
SELECT portal_test.ok(public.portal_csd_upload_check(:'clb', :'ub', 'portal')->'missing' @> '[{"key":"aviso_privacidad"}]',
  'C2 portal: sin aviso aceptado → falta «aviso_privacidad»');
SELECT portal_test.ok(public.portal_csd_upload_check(:'cla', :'uac', 'portal')->'missing' @> '[{"key":"rol"}]',
  'C2 portal: rol consulta → falta «rol»');
SELECT portal_test.ok(public.portal_csd_upload_check(:'cl_basic', :'up', 'portal')->'missing' @> '[{"key":"aviso_privacidad"},{"key":"contrato_uso"}]',
  'C2 básico: faltan aviso y contrato de uso');
SET ROLE authenticated;
SELECT portal_test.login(:'up');
SELECT public.portal_accept_legal('aviso_privacidad');
SELECT portal_test.ok(public.portal_csd_upload_check(:'cl_basic', :'up', 'portal')->'missing' = '[{"key":"contrato_uso","label":"Aceptar el contrato de uso vigente (versión 0.0-marcador)"}]'::jsonb,
  'C2 básico: con aviso, falta solo el contrato de uso');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_csd_upload_check(%L, %L, ''portal'')', :'cla', :'ua')),
  'C2: desde el navegador solo se pregunta por uno mismo');
SELECT public.portal_accept_legal('contrato_uso', :'cl_basic');
SELECT portal_test.ok((public.portal_csd_upload_check(:'cl_basic', :'up', 'portal')->>'ok')::boolean,
  'C2 básico: con aviso y contrato → puede cargar');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT portal_test.ok((public.portal_csd_upload_check(:'cla', :'staff', 'central')->>'ok')::boolean,
  'C2 central: G4 con carta de instrucción vigente → puede cargar');
SELECT portal_test.ok(public.portal_csd_upload_check(:'clb', :'staff', 'central')->'missing' @> '[{"key":"carta_instruccion"}]',
  'C2 central: sin carta de instrucción → falta «carta_instruccion»');
SELECT portal_test.ok(public.portal_csd_upload_check(:'cla', :'staff2', 'central')->'missing' @> '[{"key":"rol"}]',
  'C2 central: G1 → falta «rol»');
SELECT portal_test.ok(public.portal_csd_upload_check(:'cl_basic', :'staff', 'central')->'missing' @> '[{"key":"nivel_basico"}]',
  'C2 central: cliente básico → el CSD lo carga el titular');
-- La carta revocada deja de valer.
UPDATE public.portal_instruction_letters SET revoked_at = now() WHERE client_id = :'cla';
SELECT portal_test.ok(public.portal_csd_upload_check(:'cla', :'staff', 'central')->'missing' @> '[{"key":"carta_instruccion"}]',
  'C2 central: carta revocada → ya no autoriza');
UPDATE public.portal_instruction_letters SET revoked_at = NULL WHERE client_id = :'cla';

-- Guardado atómico: con la autorización incompleta, cero filas nuevas.
SELECT count(*) AS csd_antes FROM public.client_sat_certificates \gset
SELECT portal_test.ok(portal_test.raises(format(
  'SELECT public.portal_csd_store(%L, %L, ''portal'', ''C'', ''K'', ''P'', ''999'', ''BBB010101BBB'', now() - interval ''1 day'', now() + interval ''1 year'', ''h'')',
  :'clb', :'ub')), 'C2: portal_csd_store rechaza sin autorización (defensa en profundidad)');
SELECT portal_test.ok((SELECT count(*) FROM public.client_sat_certificates) = :csd_antes
  AND NOT EXISTS (SELECT 1 FROM public.portal_csd_registry WHERE cert_serial = '999'), 'C2: rechazado → cero filas nuevas');
SELECT public.portal_csd_store(:'cl_basic', :'up', 'portal', 'CIFRADO-CER-BASICO', 'CIFRADO-KEY-BASICO', 'CIFRADO-PASS-BASICO',
  '3330303031303030303030353030303030303933', 'EMPR800101AB1', now() - interval '1 day', now() + interval '1 year', 'huella') AS stored \gset
SELECT portal_test.ok((:'stored'::jsonb ? 'registry_id')
  AND (SELECT count(*) FROM public.client_sat_certificates WHERE client_id = :'cl_basic' AND cert_type = 'csd_sello') = 1
  AND (SELECT count(*) FROM public.portal_csd_secrets s JOIN public.portal_csd_registry r ON r.certificate_id = s.certificate_id WHERE r.client_id = :'cl_basic') = 1
  AND (SELECT key_secret_ref FROM public.portal_csd_registry WHERE client_id = :'cl_basic') = 'PORTAL_CSD_KEY_SECRET',
  'C2/C5: con autorización completa → certificado, registro y contraseña en una transacción, marcado con PORTAL_CSD_KEY_SECRET');
SELECT portal_test.ok((public.portal_csd_store(:'cl_basic', :'up', 'portal', 'X', 'Y', 'Z',
  '3330303031303030303030353030303030303933', 'EMPR800101AB1', now() - interval '1 day', now() + interval '1 year', 'h')->>'duplicate')::boolean,
  'C2: el mismo certificado dos veces → duplicado, sin filas nuevas');
SET ROLE authenticated;
SELECT portal_test.login(:'ua');
SELECT portal_test.ok(portal_test.raises(format(
  'SELECT public.portal_csd_store(%L, %L, ''portal'', ''C'', ''K'', ''P'', ''1'', ''AAA010101AAA'', now(), now() + interval ''1 year'', ''h'')', :'cla', :'ua')),
  'C2: el navegador no puede llamar portal_csd_store');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- =================================================================
-- C3 · Límite por IP / correo (huellas, no datos en claro)
-- =================================================================
SELECT portal_test.ok((SELECT bool_and((public.portal_rate_limit_hit('registro_ip', repeat('a', 64), 3, 3600)->>'allowed')::boolean)
                         FROM generate_series(1, 3)), 'C3: tres intentos dentro del límite');
SELECT portal_test.ok(NOT (public.portal_rate_limit_hit('registro_ip', repeat('a', 64), 3, 3600)->>'allowed')::boolean,
  'C3: el cuarto intento supera el límite');
SELECT portal_test.ok((public.portal_rate_limit_hit('registro_ip', repeat('b', 64), 3, 3600)->>'allowed')::boolean,
  'C3: otra IP no se ve afectada');
SELECT portal_test.ok(portal_test.raises('SELECT public.portal_rate_limit_hit(''x'', ''no-es-huella'', 3, 60)'),
  'C3: solo acepta huellas sha256 (nunca el dato en claro)');
SET ROLE authenticated;
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_rate_limit_hit(''x'', %L, 3, 60)', repeat('c', 64))),
  'C3: el navegador no puede tocar los límites');
RESET ROLE;

-- =================================================================
-- V1 · Sin cerco de rutas activo, no se vincula ni se activa el nivel básico
-- =================================================================
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('22222222-0000-0000-0000-0000000000e1', 'pendiente2@prueba.invalid', '{"kawiil_portal":true}'),
  ('22222222-0000-0000-0000-0000000000e2', 'operativo.b@prueba.invalid', '{"kawiil_portal":true,"full_name":"Operativo B"}');
SET ROLE authenticated;
SELECT portal_test.login(:'staff');
SELECT set_config('portal.pre_request_ran', '', false);
SELECT portal_test.ok(NOT (public.portal_route_guard_status()->>'ok')::boolean
  AND NOT (public.portal_route_guard_status()->>'pre_request_activo')::boolean, 'V1: sin pre-request en la petición → diagnóstico «no ok»');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_staff_link_account(%L, %L, ''operativo'', ''premier'')',
  '22222222-0000-0000-0000-0000000000e2', :'clb')), 'V1: cerco inactivo → la vinculación se bloquea');
SELECT portal_test.login('22222222-0000-0000-0000-0000000000e1');
SELECT portal_test.ok(portal_test.raises('SELECT public.portal_activate_basic(''Otra'', ''OTR800101AB1'')'),
  'V1: cerco inactivo → la activación del nivel básico se bloquea');
RESET ROLE;
ALTER ROLE authenticator RESET pgrst.db_pre_request;
SELECT set_config('portal.pre_request_ran', 'on', false);
SET ROLE authenticated;
SELECT portal_test.login(:'staff');
SELECT portal_test.ok(NOT (public.portal_route_guard_status()->>'pre_request_registrado')::boolean,
  'V1: pre-request no registrado en PostgREST → diagnóstico lo dice');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_staff_link_account(%L, %L, ''operativo'', ''premier'')',
  '22222222-0000-0000-0000-0000000000e2', :'clb')), 'V1: pre-request no registrado → la vinculación se bloquea');
RESET ROLE;
ALTER ROLE authenticator SET pgrst.db_pre_request TO 'public.portal_pre_request';
SET ROLE authenticated;
SELECT portal_test.login(:'staff');
SELECT portal_test.ok((public.portal_route_guard_status()->>'ok')::boolean, 'V1: registrado y activo → diagnóstico ok');
SELECT public.portal_staff_link_account('22222222-0000-0000-0000-0000000000e2', :'clb', 'operativo', 'premier');
SELECT portal_test.ok(EXISTS (SELECT 1 FROM public.portal_memberships WHERE user_id = '22222222-0000-0000-0000-0000000000e2'),
  'V1: con el cerco verificado la vinculación funciona');
RESET ROLE;
SET ROLE anon;
SELECT portal_test.ok(public.portal_route_guard_status() ? 'ok', 'V1: el diagnóstico responde también sin sesión (para portal-api)');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- =================================================================
-- V2 (base) · El alta SIN la marca del portal sigue idéntica al original
-- =================================================================
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-0000-0000-0000-0000000000f1', 'nuevo.equipo@prueba.invalid', '{"full_name":"Nuevo Equipo"}'),
  ('11111111-0000-0000-0000-0000000000f2', 'sin.nombre@prueba.invalid', '{}');
SELECT portal_test.ok(
  (SELECT row(organization_id, email, full_name)::text FROM public.profiles WHERE user_id = '11111111-0000-0000-0000-0000000000f1')
    = row('a0000000-0000-0000-0000-000000000001'::uuid, 'nuevo.equipo@prueba.invalid', 'Nuevo Equipo')::text
  AND (SELECT full_name FROM public.profiles WHERE user_id = '11111111-0000-0000-0000-0000000000f2') = 'sin.nombre'
  AND (SELECT array_agg(role::text) FROM public.user_roles WHERE user_id IN ('11111111-0000-0000-0000-0000000000f1', '11111111-0000-0000-0000-0000000000f2'))
      = ARRAY['en_formacion', 'en_formacion']
  AND NOT EXISTS (SELECT 1 FROM public.portal_accounts WHERE user_id IN ('11111111-0000-0000-0000-0000000000f1', '11111111-0000-0000-0000-0000000000f2')),
  'V2: alta sin marca → perfil en la organización Kawiil, nombre (o parte local del correo) y rol en_formacion; sin cuenta de portal');

-- =================================================================
-- C4 · Eliminación de cuenta y conservación
-- =================================================================
-- Datos del cliente básico de `up`: ticket pendiente, ticket facturado, CFDI y adjunto.
INSERT INTO public.portal_message_attachments (message_id, organization_id, client_id, storage_path, file_name)
SELECT id, :'orgk', :'cl_basic', :'orgk' || '/' || :'cl_basic' || '/mensajes/' || :'thread_basic' || '/a.pdf', 'a.pdf'
  FROM public.portal_messages WHERE thread_id = :'thread_basic' LIMIT 1;
INSERT INTO public.fis_receipts (id, organization_id, client_id, file_path, file_hash, status) VALUES
  ('e1000000-0000-0000-0000-000000000001', :'orgk', :'cl_basic', :'orgk' || '/juun/clients/' || :'cl_basic' || '/2026/09/receipts/pend.jpg', repeat('1', 64), 'received'),
  ('e1000000-0000-0000-0000-000000000002', :'orgk', :'cl_basic', :'orgk' || '/juun/clients/' || :'cl_basic' || '/2026/09/receipts/fact.jpg', repeat('2', 64), 'invoiced');
INSERT INTO public.fis_cfdi (organization_id, receipt_id, uuid_fiscal, xml_path, pdf_path)
VALUES (:'orgk', 'e1000000-0000-0000-0000-000000000002', 'E1E1E1E1-0000-4000-8000-000000000001', 'x/fact.xml', 'x/fact.pdf');
INSERT INTO public.portal_cfdi (organization_id, client_id, uuid, direction, source, rfc_emisor, rfc_receptor, total, xml_path)
VALUES (:'orgk', :'cl_basic', 'E1E1E1E1-0000-4000-8000-000000000002', 'emitida', 'emision_prueba', 'EMPR800101AB1', 'XAXX010101000', 116, 'x/em.xml');

-- Plan del básico: sale del estado real y de la política.
SET ROLE authenticated;
SELECT portal_test.login(:'up');
SELECT public.portal_account_deletion_plan() AS plan_up \gset
RESET ROLE;
SELECT portal_test.ok(NOT (:'plan_up'::jsonb->>'bloqueada')::boolean
  AND :'plan_up'::jsonb->'elimina' @> '[{"key":"csd","cantidad":1}]'
  AND :'plan_up'::jsonb->'elimina' @> '[{"key":"tickets_no_facturados","cantidad":1}]'
  AND :'plan_up'::jsonb->'conserva' @> '[{"key":"cfdi","cantidad":1,"anios":5}]'
  AND :'plan_up'::jsonb->'conserva' @> '[{"key":"tickets_facturados","cantidad":1,"anios":5}]'
  AND (:'plan_up'::jsonb->'politica'->>'confirmada')::boolean = false,
  'C4 plan básico: destruye CSD, borra ticket pendiente, conserva CFDI y ticket facturado 5 años (propuesta sin confirmar)');
UPDATE public.portal_retention_policy SET value = '7' WHERE key = 'fiscal_retention_years';
SELECT portal_test.ok(public.portal_account_deletion_plan(:'up')->'conserva' @> '[{"key":"cfdi","anios":7}]',
  'C4: el plazo es un parámetro (cambia el plan sin tocar código)');
UPDATE public.portal_retention_policy SET value = '5' WHERE key = 'fiscal_retention_years';
SET ROLE authenticated;
SELECT portal_test.login(:'ub');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_account_deletion_plan(%L)', :'up')), 'C4: nadie pide el plan de otra persona');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_execute_account_deletion(%L)', :'ub')), 'C4: el navegador no ejecuta eliminaciones');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- Administradora única de un cliente premier → bloqueada, sin tocar nada.
SELECT (public.portal_execute_account_deletion(:'ua')) AS del_ua \gset
SELECT portal_test.ok((:'del_ua'::jsonb->>'bloqueada')::boolean
  AND :'del_ua'::jsonb->'bloqueos' @> format('[{"client_id":"%s"}]', :'cla')::jsonb
  AND EXISTS (SELECT 1 FROM public.portal_memberships WHERE user_id = :'ua')
  AND (SELECT status FROM public.portal_deletion_requests WHERE id = (:'del_ua'::jsonb->>'request_id')::uuid) = 'bloqueada',
  'C4: administradora única de un premier → eliminación bloqueada y registrada');

-- Premier NO administradora única (operativo de B): se retira la membresía; el CSD de B no se toca.
SELECT count(*) AS csd_b FROM public.client_sat_certificates WHERE client_id = :'clb' \gset
SELECT public.portal_audit('acceso', :'clb', NULL, NULL, '{}'::jsonb, '22222222-0000-0000-0000-0000000000e2');
SELECT public.portal_execute_account_deletion('22222222-0000-0000-0000-0000000000e2') AS del_e2 \gset
SELECT portal_test.ok(NOT (:'del_e2'::jsonb->>'bloqueada')::boolean
  AND NOT EXISTS (SELECT 1 FROM public.portal_memberships WHERE user_id = '22222222-0000-0000-0000-0000000000e2')
  AND (SELECT count(*) FROM public.client_sat_certificates WHERE client_id = :'clb') = :csd_b
  AND (SELECT count(*) FROM public.portal_csd_registry WHERE client_id = :'clb' AND revoked_at IS NULL) >= 1,
  'C4 premier: se retira la membresía; el CSD de la empresa queda intacto');

-- Hechos de la bitácora del básico antes de eliminar (para comparar después).
CREATE TEMP TABLE hechos_antes AS
  SELECT id, occurred_at, action, client_id, entity_type FROM public.portal_audit_log WHERE actor_user_id = :'up';
SELECT count(*) AS n_hechos FROM hechos_antes \gset

SELECT public.portal_execute_account_deletion(:'up') AS del_up \gset
DELETE FROM auth.users WHERE id = :'up';   -- lo que hace portal-api después (auth.admin.deleteUser)
SELECT public.portal_finish_account_deletion((:'del_up'::jsonb->>'request_id')::uuid, true);

SELECT portal_test.ok(
  (SELECT count(*) FROM public.client_sat_certificates WHERE client_id = :'cl_basic' AND cert_type = 'csd_sello') = 0
  AND NOT EXISTS (SELECT 1 FROM public.portal_csd_registry WHERE client_id = :'cl_basic')
  AND NOT EXISTS (SELECT 1 FROM public.portal_csd_secrets s WHERE NOT EXISTS (SELECT 1 FROM public.client_sat_certificates c WHERE c.id = s.certificate_id))
  AND NOT (SELECT emission_enabled FROM public.portal_client_settings WHERE client_id = :'cl_basic'),
  'C4 básico: CSD, llave y contraseña destruidos de inmediato; emisión apagada');
SELECT portal_test.ok(NOT EXISTS (SELECT 1 FROM public.portal_threads WHERE client_id = :'cl_basic')
  AND NOT EXISTS (SELECT 1 FROM public.portal_message_attachments WHERE client_id = :'cl_basic')
  AND EXISTS (SELECT 1 FROM public.portal_storage_purge_queue WHERE bucket = 'portal' AND path LIKE '%/mensajes/%/a.pdf'),
  'C4 básico: mensajes y adjuntos eliminados (archivos a la cola de borrado)');
SELECT portal_test.ok(NOT EXISTS (SELECT 1 FROM public.fis_receipts WHERE id = 'e1000000-0000-0000-0000-000000000001')
  AND EXISTS (SELECT 1 FROM public.fis_receipts WHERE id = 'e1000000-0000-0000-0000-000000000002')
  AND EXISTS (SELECT 1 FROM public.portal_cfdi WHERE client_id = :'cl_basic'),
  'C4 básico: ticket pendiente eliminado; ticket facturado y CFDI conservados');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_retention_holds WHERE client_id = :'cl_basic'
                         AND retain_until BETWEEN now() + interval '4 years 11 months' AND now() + interval '5 years 1 day') = 2,
  'C4 básico: dos retenciones con fecha de purga a 5 años');
SELECT portal_test.ok(NOT EXISTS (SELECT 1 FROM public.portal_audit_log WHERE actor_user_id = :'up' OR entity_id = :'up' OR details->>'user_id' = :'up')
  AND NOT EXISTS (SELECT 1 FROM public.portal_audit_log WHERE actor_email = 'pendiente@prueba.invalid')
  AND NOT EXISTS (SELECT 1 FROM public.portal_legal_acceptances WHERE user_id = :'up' OR user_email = 'pendiente@prueba.invalid')
  AND NOT EXISTS (SELECT 1 FROM public.portal_deletion_requests WHERE plan::text LIKE '%' || :'up' || '%'),
  'C4: ningún identificador personal del básico queda en bitácora, aceptaciones ni solicitudes');
SELECT portal_test.ok(:n_hechos > 0 AND (SELECT count(*) FROM public.portal_audit_log l JOIN hechos_antes h USING (id)
   WHERE l.occurred_at = h.occurred_at AND l.action = h.action AND l.client_id IS NOT DISTINCT FROM h.client_id
     AND l.entity_type IS NOT DISTINCT FROM h.entity_type AND l.actor_email LIKE 'seud:%') = :n_hechos,
  format('C4: los %s hechos del básico siguen en la bitácora (qué, cuándo, cliente), con identidad seudonimizada', :n_hechos));
SELECT portal_test.ok(EXISTS (SELECT 1 FROM public.portal_audit_log WHERE action = 'seudonimizacion')
  AND EXISTS (SELECT 1 FROM public.portal_audit_log WHERE action = 'csd_destruccion' AND client_id = :'cl_basic')
  AND (SELECT status FROM public.portal_deletion_requests WHERE id = (:'del_up'::jsonb->>'request_id')::uuid) = 'ejecutada',
  'C4: solicitud y ejecución registradas (seudonimización y destrucción del CSD en bitácora)');

-- La bitácora sigue sin poder editarse: ni siquiera con la marca de seudonimizar.
SELECT portal_test.ok(portal_test.raises('UPDATE public.portal_audit_log SET action = ''acceso'' WHERE id = (SELECT min(id) FROM public.portal_audit_log)'),
  'C4: UPDATE del hecho sigue rechazado');
SELECT portal_test.ok(portal_test.raises($q$SELECT set_config('portal.pseudonymizing', 'on', false);
  UPDATE public.portal_audit_log SET action = 'acceso' WHERE id = (SELECT min(id) FROM public.portal_audit_log)$q$),
  'C4: con la marca activa, cambiar el hecho sigue rechazado');
SELECT portal_test.ok(portal_test.raises($q$SELECT set_config('portal.pseudonymizing', 'on', false);
  UPDATE public.portal_audit_log SET actor_email = 'otra@persona.mx' WHERE id = (SELECT min(id) FROM public.portal_audit_log)$q$),
  'C4: con la marca activa, poner un dato que no sea seudónimo sigue rechazado');
SELECT set_config('portal.pseudonymizing', 'off', false);
SELECT portal_test.ok(portal_test.raises('DELETE FROM public.portal_audit_log'), 'C4: DELETE sigue rechazado');

-- Purga programada: antes del plazo no hace nada; con el plazo vencido (simulado) purga.
SELECT public.portal_purge_expired_retention(now()) AS purga_hoy \gset
SELECT portal_test.ok(:purga_hoy = 0 AND EXISTS (SELECT 1 FROM public.portal_cfdi WHERE client_id = :'cl_basic'),
  'C4 purga: antes del plazo no borra nada');
SELECT public.portal_purge_expired_retention(now() + interval '5 years 2 days') AS purga_vencida \gset
SELECT portal_test.ok(:purga_vencida = 2
  AND NOT EXISTS (SELECT 1 FROM public.portal_cfdi WHERE client_id = :'cl_basic')
  AND NOT EXISTS (SELECT 1 FROM public.fis_receipts WHERE client_id = :'cl_basic')
  AND (SELECT count(*) FROM public.portal_retention_holds WHERE client_id = :'cl_basic' AND purged_at IS NOT NULL) = 2
  AND EXISTS (SELECT 1 FROM public.portal_audit_log WHERE action = 'retencion_purga' AND client_id = :'cl_basic')
  AND EXISTS (SELECT 1 FROM public.portal_storage_purge_queue WHERE reason = 'retencion_vencida' AND path = 'x/fact.pdf'),
  'C4 purga: plazo vencido simulado → CFDI y tickets facturados purgados, archivos a la cola, hecho en bitácora');
SELECT portal_test.ok(EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'portal-retention-purge'), 'C4: la purga está programada (pg_cron)');

RESET ROLE;
DROP SCHEMA portal_test CASCADE;
\echo 'TODAS LAS PRUEBAS DE BASE DEL PORTAL PASARON'
