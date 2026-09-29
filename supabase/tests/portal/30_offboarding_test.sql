-- =================================================================
-- Pruebas de base de la baja de cuentas y el resguardo (B1–B5).
-- Se corre DESPUÉS de 10_isolation_test.sql y 20_corrections_test.sql en la misma
-- sesión (usa sus datos sintéticos, variables y utilidades). Todo es sintético.
-- Numeración de las pruebas = sección 4 del encargo.
-- =================================================================
\set ON_ERROR_STOP 1
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT set_config('portal.pre_request_ran', 'on', false);

-- Utilidad: da de alta a una titular del nivel básico con CSD, aviso y contrato aceptados,
-- un hilo con adjunto (y su archivo en Storage), un ticket pendiente, uno facturado y un CFDI.
CREATE FUNCTION portal_test.basic_titular(_uid uuid, _email text, _name text, _rfc text, _serial text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_client uuid; v_thread uuid; v_org uuid; v_msg uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (_uid, _email, '{"kawiil_portal":true}');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  v_client := (public.portal_activate_basic(_name, _rfc)->>'client_id')::uuid;
  v_thread := public.portal_thread_create(v_client, 'Hilo', 'Mensaje sintético');
  PERFORM public.portal_accept_legal('aviso_privacidad');
  PERFORM public.portal_accept_legal('contrato_uso', v_client);
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT organization_id INTO v_org FROM public.clients WHERE id = v_client;
  PERFORM public.portal_csd_store(v_client, _uid, 'portal', 'CIFRADO-CER', 'CIFRADO-KEY', 'CIFRADO-PASS',
    _serial, _rfc, now() - interval '1 day', now() + interval '1 year', 'huella');
  SELECT id INTO v_msg FROM public.portal_messages WHERE client_id = v_client LIMIT 1;
  INSERT INTO public.portal_message_attachments (message_id, organization_id, client_id, storage_path, file_name)
  VALUES (v_msg, v_org, v_client, v_org || '/' || v_client || '/mensajes/x/adj.pdf', 'adj.pdf');
  INSERT INTO storage.objects (bucket_id, name) VALUES ('portal', v_org || '/' || v_client || '/mensajes/x/adj.pdf');
  INSERT INTO public.fis_receipts (organization_id, client_id, file_path, file_hash, status) VALUES
    (v_org, v_client, v_org || '/juun/clients/' || v_client || '/r/pend.jpg', md5(_email || 'p') || md5(_email || 'q'), 'received'),
    (v_org, v_client, v_org || '/juun/clients/' || v_client || '/r/fact.jpg', md5(_email || 'f') || md5(_email || 'g'), 'invoiced');
  INSERT INTO storage.objects (bucket_id, name) VALUES
    ('juun', v_org || '/juun/clients/' || v_client || '/r/pend.jpg'),
    ('juun', v_org || '/juun/clients/' || v_client || '/r/fact.jpg');
  INSERT INTO public.portal_cfdi (organization_id, client_id, uuid, direction, source, rfc_emisor, rfc_receptor, total, xml_path, created_by)
  VALUES (v_org, v_client, upper(gen_random_uuid()::text), 'emitida', 'emision_prueba', _rfc, 'XAXX010101000', 116,
          v_org || '/' || v_client || '/cfdi/f.xml', _uid);
  INSERT INTO storage.objects (bucket_id, name) VALUES ('portal', v_org || '/' || v_client || '/cfdi/f.xml');
  RETURN v_client;
END $$;

-- Simula lo que hace portal-api después de la base: borra el usuario de Auth,
-- vacía la cola de archivos de la solicitud y registra la verificación.
CREATE FUNCTION portal_test.finish_person(_req uuid, _uid uuid, _email text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM auth.users WHERE id = _uid;
  PERFORM public.portal_finish_account_deletion(_req, true);
  DELETE FROM storage.objects o USING public.portal_storage_purge_queue q
   WHERE q.deletion_request_id = _req AND q.done_at IS NULL AND o.bucket_id = q.bucket AND o.name = q.path;
  PERFORM public.portal_purge_queue_done(ARRAY(SELECT id FROM public.portal_storage_purge_queue WHERE deletion_request_id = _req AND done_at IS NULL));
  RETURN public.portal_offboarding_record_verification(_req, _uid, _email);
END $$;

-- =================================================================
-- 1 · Baja de titular en básico, plazo por omisión (cinco años)
-- =================================================================
\set u5 '22222222-0000-0000-0000-0000000000d5'
SELECT portal_test.basic_titular(:'u5', 'cinco@prueba.invalid', 'Cinco Sintética', 'CINC800101AB1', '3330303031303030303030353030303030303935') AS cl5 \gset
-- Una sesión abierta con su token de refresco y un enlace de recuperación pendiente.
INSERT INTO auth.sessions (id, user_id) VALUES ('5e550000-0000-0000-0000-0000000000d5', :'u5');
INSERT INTO auth.refresh_tokens (token, user_id, session_id) VALUES ('token-sintetico', :'u5', '5e550000-0000-0000-0000-0000000000d5');
INSERT INTO auth.one_time_tokens (user_id, token_type, token_hash) VALUES (:'u5', 'recovery_token', 'hash-sintetico');
SET ROLE authenticated;
SELECT portal_test.login(:'u5');
SELECT public.portal_account_deletion_plan() AS plan5 \gset
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT portal_test.ok((:'plan5'::jsonb->'resguardo'->>'elige')::boolean
  AND (:'plan5'::jsonb->'resguardo'->>'omision')::int = 5
  AND :'plan5'::jsonb->'resguardo'->'opciones' @> '[{"anios":5},{"anios":10}]'
  AND jsonb_array_length(:'plan5'::jsonb->'resguardo'->'opciones') = 2
  AND :'plan5'::jsonb->'conserva' @> format('[{"key":"cfdi","para":"Cumplir la obligación de conservar los comprobantes fiscales y la contabilidad.","hasta_por_opcion":{"5":"%s","10":"%s"}}]',
        (now() + interval '5 years')::date, (now() + interval '10 years')::date)::jsonb
  AND :'plan5'::jsonb->'conserva' @> '[{"key":"aceptaciones","elige":true}]'
  AND :'plan5'::jsonb->'elimina' @> '[{"key":"acceso"},{"key":"csd","cantidad":1},{"key":"datos_contacto"}]',
  '1 plan: dos opciones (5 preseleccionado por omisión, 10), qué se resguarda, para qué y hasta qué fecha');
SELECT public.portal_execute_account_deletion(:'u5') AS del5 \gset
SELECT portal_test.finish_person((:'del5'::jsonb->>'request_id')::uuid, :'u5', 'cinco@prueba.invalid') AS ver5 \gset
SELECT portal_test.ok((:'ver5'::jsonb->>'ok')::boolean
  AND NOT EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = :'u5')
  AND NOT EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE user_id = :'u5')
  AND NOT EXISTS (SELECT 1 FROM auth.one_time_tokens WHERE user_id = :'u5'),
  '1/6: accesos, sesiones, tokens, enlaces pendientes y CSD eliminados; la verificación de B2 no encuentra nada');
SELECT portal_test.ok(
  (SELECT count(*) FROM public.portal_retention_holds WHERE client_id = :'cl5' AND years = 5
     AND retain_until::date = (now() + interval '5 years')::date) = 2
  AND EXISTS (SELECT 1 FROM public.portal_retention_holds WHERE subject = 'aceptaciones'
                AND subject_pseudonym = public.portal_pseudonym_uuid(:'u5') AND years = 5)
  AND EXISTS (SELECT 1 FROM public.portal_retention_elections WHERE client_id = :'cl5' AND elected_kind = 'omision' AND years = 5
                AND retain_until::date = (now() + interval '5 years')::date),
  '1: resguardo fiscal y de constancias con fin a cinco años; la omisión queda registrada');
SELECT portal_test.ok(
  (SELECT email IS NULL AND phone IS NULL AND address IS NULL AND contact_name IS NULL AND rfc = 'CINC800101AB1' FROM public.clients WHERE id = :'cl5')
  AND EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'juun' AND name LIKE '%/' || :'cl5' || '/r/fact.jpg')
  AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'juun' AND name LIKE '%/' || :'cl5' || '/r/pend.jpg')
  AND NOT EXISTS (SELECT 1 FROM public.portal_legal_acceptances WHERE user_email NOT LIKE 'seud:%' AND user_id = public.portal_pseudonym_uuid(:'u5')),
  '1: sin datos de contacto; el RFC y el ticket facturado se resguardan; el pendiente se borró de Storage');

-- =================================================================
-- 2 · Igual, eligiendo diez años
-- =================================================================
\set u10 '22222222-0000-0000-0000-0000000000da'
SELECT portal_test.basic_titular(:'u10', 'diez@prueba.invalid', 'Diez Sintética', 'DIEZ800101AB1', '3330303031303030303030353030303030303936') AS cl10 \gset
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_execute_account_deletion(%L, 7)', :'u10')),
  '2: solo 5 o 10 años (7 se rechaza)');
SELECT public.portal_execute_account_deletion(:'u10', 10) AS del10 \gset
SELECT portal_test.finish_person((:'del10'::jsonb->>'request_id')::uuid, :'u10', 'diez@prueba.invalid') AS ver10 \gset
SELECT portal_test.ok((:'ver10'::jsonb->>'ok')::boolean
  AND (SELECT count(*) FROM public.portal_retention_holds WHERE client_id = :'cl10' AND years = 10
         AND retain_until::date = (now() + interval '10 years')::date) = 2
  AND EXISTS (SELECT 1 FROM public.portal_retention_holds WHERE subject = 'aceptaciones'
                AND subject_pseudonym = public.portal_pseudonym_uuid(:'u10') AND years = 10),
  '2/6: fin del resguardo a diez años; la verificación de B2 no encuentra nada');
SELECT portal_test.ok(EXISTS (SELECT 1 FROM public.portal_retention_elections
   WHERE client_id = :'cl10' AND elected_kind = 'titular' AND years = 10
     AND elected_by = public.portal_pseudonym_uuid(:'u10') AND elected_at::date = now()::date
     AND retain_until::date = (now() + interval '10 years')::date)
  AND (SELECT (plan->>'plazo_elegido')::int FROM public.portal_deletion_requests WHERE id = (:'del10'::jsonb->>'request_id')::uuid) = 10,
  '2: la elección queda registrada con fecha, quién (seudónimo de la titular) y fecha de fin');
SELECT portal_test.ok(portal_test.raises('UPDATE public.portal_retention_elections SET years = 5'),
  '2: el registro de elecciones no se puede reescribir');

-- =================================================================
-- 8 · Un plazo en curso no cambia al modificar el valor por omisión
-- =================================================================
CREATE TEMP TABLE plazos_antes AS SELECT id, retain_until, years FROM public.portal_retention_holds WHERE purged_at IS NULL;
UPDATE public.portal_retention_policy SET value = '10' WHERE key = 'fiscal_retention_years';
SELECT portal_test.ok(NOT EXISTS (SELECT 1 FROM public.portal_retention_holds h JOIN plazos_antes a USING (id)
   WHERE h.retain_until <> a.retain_until OR h.years <> a.years),
  '8: cambiar la omisión a 10 no mueve ningún resguardo en curso');
UPDATE public.portal_retention_policy SET value = '5' WHERE key = 'fiscal_retention_years';

-- =================================================================
-- 4 · Básico con otra persona activa: no se destruye nada
-- =================================================================
\set u4 '22222222-0000-0000-0000-0000000000d4'
\set u4b '22222222-0000-0000-0000-0000000000d6'
SELECT portal_test.basic_titular(:'u4', 'cuatro@prueba.invalid', 'Cuatro Sintética', 'CUAT800101AB1', '3330303031303030303030353030303030303937') AS cl4 \gset
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (:'u4b', 'activa.cuatro@prueba.invalid', '{"kawiil_portal":true}');
UPDATE public.portal_accounts SET status = 'activa', tier = 'basico' WHERE user_id = :'u4b';
INSERT INTO public.portal_memberships (client_id, user_id, role, status, created_by) VALUES (:'cl4', :'u4b', 'operativo', 'activa', :'u4');
SELECT count(*) AS n4_threads FROM public.portal_threads WHERE client_id = :'cl4' \gset
SELECT public.portal_account_deletion_plan(:'u4') AS plan4 \gset
SELECT portal_test.ok(:'plan4'::jsonb->'elimina' @> '[{"key":"membresia"}]' AND NOT :'plan4'::jsonb->'elimina' @> '[{"key":"csd"}]'
  AND NOT (:'plan4'::jsonb->'resguardo'->>'elige')::boolean,
  '4 plan: con otra persona activa solo se retira la membresía');
SELECT public.portal_execute_account_deletion(:'u4', 10) AS del4 \gset
SELECT portal_test.finish_person((:'del4'::jsonb->>'request_id')::uuid, :'u4', 'cuatro@prueba.invalid') AS ver4 \gset
SELECT portal_test.ok((:'ver4'::jsonb->'persona'->>'ok')::boolean
  AND jsonb_array_length(:'ver4'::jsonb->'empresas') = 0
  AND (SELECT count(*) FROM public.client_sat_certificates WHERE client_id = :'cl4' AND cert_type = 'csd_sello') = 1
  AND (SELECT count(*) FROM public.portal_threads WHERE client_id = :'cl4') = :n4_threads
  AND EXISTS (SELECT 1 FROM public.portal_memberships WHERE client_id = :'cl4' AND user_id = :'u4b' AND status = 'activa')
  AND NOT EXISTS (SELECT 1 FROM public.portal_retention_holds WHERE client_id = :'cl4')
  AND (SELECT offboarded_at IS NULL FROM public.portal_client_settings WHERE client_id = :'cl4'),
  '4: la empresa sigue: CSD, conversaciones y la otra persona intactos; sin resguardo; el acceso de quien se fue, eliminado');

-- =================================================================
-- 5 · Baja de un cliente premier desde central (y plazo por cliente, B1)
-- =================================================================
\set cld  'dddddddd-0000-0000-0000-00000000000d'
\set pd1  '22222222-0000-0000-0000-0000000000e5'
\set pd2  '22222222-0000-0000-0000-0000000000e6'
INSERT INTO public.clients (id, organization_id, name, rfc) VALUES (:'cld', :'orgk', 'Cliente Sintético D', 'DDD010101DDD');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'pd1', 'admin.d@prueba.invalid', '{"kawiil_portal":true,"full_name":"Admin D"}'),
  (:'pd2', 'oper.d@prueba.invalid', '{"kawiil_portal":true,"full_name":"Operativo D"}');
SET ROLE authenticated;
SELECT portal_test.login(:'staff');
SELECT public.portal_staff_link_account(:'pd1', :'cld', 'administrador', 'premier');
SELECT public.portal_staff_link_account(:'pd2', :'cld', 'operativo', 'premier');
SELECT public.portal_staff_link_account(:'pd2', :'clb', 'consulta', 'premier');
-- B1 premier: el plazo lo fija G3/G4 por cliente, a solicitud del cliente.
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_staff_set_client_retention(%L, 7, ''x'')', :'cld')), 'B1: G3/G4 solo puede fijar 5 o 10');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_staff_set_client_retention(%L, 10, '''')', :'cld')), 'B1: sin motivo no se cambia');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_staff_set_client_retention(%L, 10, ''x'')', :'cl4')),
  'B1: en básico el plazo no lo fija Kawiil (lo elige la titular)');
SELECT public.portal_staff_set_client_retention(:'cld', 10, 'Solicitud del cliente por escrito (sintética)');
SELECT portal_test.login(:'staff2');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_staff_set_client_retention(%L, 5, ''x'')', :'cld')), 'B1: G1 no cambia el plazo');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_client_offboarding_plan(%L)', :'cld')), '5: G1 no ve el plan de baja');
SELECT portal_test.login(:'pd1');
SELECT public.portal_accept_legal('aviso_privacidad');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_client_offboarding_plan(%L)', :'cld')), '5: el portal no ve el plan de baja');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_client_offboarding_execute(%L, %L, ''DAR DE BAJA'', ''DDD010101DDD'')', :'cld', :'staff')),
  '5: el navegador no ejecuta la baja (solo portal-api)');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT portal_test.ok(portal_test.raises(format('UPDATE public.portal_client_settings SET retention_years = 5 WHERE client_id = %L', :'cld')),
  'B1: el plazo por cliente no se cambia por fuera de la función de G3/G4');
SELECT portal_test.ok(EXISTS (SELECT 1 FROM public.portal_retention_elections WHERE client_id = :'cld' AND elected_kind = 'kawiil'
   AND elected_by = :'staff' AND years = 10 AND retain_until IS NULL AND motivo LIKE 'Solicitud del cliente%'),
  'B1: la elección de Kawiil queda registrada (quién, cuándo, motivo)');

SELECT public.portal_csd_store(:'cld', :'pd1', 'portal', 'CIFRADO-CER-D', 'CIFRADO-KEY-D', 'CIFRADO-PASS-D',
  '3330303031303030303030353030303030303938', 'DDD010101DDD', now() - interval '1 day', now() + interval '1 year', 'huella-d');
SET ROLE authenticated;
SELECT portal_test.login(:'pd1');
SELECT public.portal_thread_create(:'cld', 'Hilo D', 'Mensaje sintético D') AS thread_d \gset
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
INSERT INTO public.portal_message_attachments (message_id, organization_id, client_id, storage_path, file_name)
SELECT id, :'orgk', :'cld', :'orgk' || '/' || :'cld' || '/mensajes/d/adj.pdf', 'adj.pdf' FROM public.portal_messages WHERE thread_id = :'thread_d' LIMIT 1;
INSERT INTO public.portal_documents (organization_id, client_id, source, area, file_name, storage_path, status)
VALUES (:'orgk', :'cld', 'subida', 'FISCAL', 'decl_d.pdf', :'orgk' || '/' || :'cld' || '/FISCAL/decl_d.pdf', 'pendiente');
INSERT INTO public.portal_cfdi (organization_id, client_id, uuid, direction, source, rfc_emisor, rfc_receptor, total, xml_path, created_by)
VALUES (:'orgk', :'cld', 'D5D5D5D5-0000-4000-8000-000000000001', 'emitida', 'carga_xml', 'DDD010101DDD', 'XAXX010101000', 116,
        :'orgk' || '/' || :'cld' || '/cfdi/d.xml', :'pd1');
INSERT INTO public.fis_receipts (organization_id, client_id, file_path, file_hash, status) VALUES
  (:'orgk', :'cld', :'orgk' || '/juun/clients/' || :'cld' || '/r/p.jpg', repeat('d', 64), 'received');
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('portal', :'orgk' || '/' || :'cld' || '/mensajes/d/adj.pdf'), ('portal', :'orgk' || '/' || :'cld' || '/FISCAL/decl_d.pdf'),
  ('portal', :'orgk' || '/' || :'cld' || '/cfdi/d.xml'), ('juun', :'orgk' || '/juun/clients/' || :'cld' || '/r/p.jpg');

SET ROLE authenticated;
SELECT portal_test.login(:'staff');
SELECT public.portal_client_offboarding_plan(:'cld') AS pland \gset
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT portal_test.ok(NOT (:'pland'::jsonb->>'bloqueada')::boolean
  AND jsonb_array_length(:'pland'::jsonb->'personas') = 2
  AND :'pland'::jsonb->'personas' @> '[{"correo":"admin.d@prueba.invalid","se_elimina_la_cuenta":true},{"correo":"oper.d@prueba.invalid","se_elimina_la_cuenta":false,"otras_empresas":1}]'
  AND :'pland'::jsonb->'elimina' @> '[{"key":"csd","cantidad":1},{"key":"accesos","cantidad":2},{"key":"documentos","cantidad":1}]'
  AND :'pland'::jsonb->'resguardo' @> format('{"anios":10,"fijado_por":"kawiil","hasta":"%s"}', (now() + interval '10 years')::date)::jsonb,
  '5 plan: muestra qué se elimina (accesos, CSD…) y qué se resguarda, con el plazo del cliente (10) y su fecha');

SELECT count(*) AS csd_d FROM public.client_sat_certificates WHERE client_id = :'cld' \gset
SELECT public.portal_client_offboarding_execute(:'cld', :'staff2', 'DAR DE BAJA', 'DDD010101DDD') AS r_g1 \gset
SELECT public.portal_client_offboarding_execute(:'cld', :'staff', 'dar de baja', 'DDD010101DDD') AS r_conf \gset
SELECT public.portal_client_offboarding_execute(:'cld', :'staff', 'DAR DE BAJA', 'DDD010101XXX') AS r_rfc \gset
SELECT public.portal_client_offboarding_execute(:'cld', NULL, 'DAR DE BAJA', 'DDD010101DDD') AS r_null \gset
SELECT portal_test.ok(:'r_g1'::jsonb->>'motivo' = 'sin_rol' AND :'r_conf'::jsonb->>'motivo' = 'confirmacion'
  AND :'r_rfc'::jsonb->>'motivo' = 'dato_no_coincide' AND :'r_null'::jsonb->>'motivo' = 'sin_rol'
  AND (SELECT count(*) FROM public.client_sat_certificates WHERE client_id = :'cld') = :csd_d
  AND (SELECT count(*) FROM public.portal_memberships WHERE client_id = :'cld') = 2
  AND (SELECT count(*) FROM public.portal_deletion_requests WHERE client_id = :'cld' AND status = 'rechazada') = 4
  AND (SELECT count(*) FROM public.portal_audit_log WHERE action = 'cliente_baja_rechazada' AND client_id = :'cld') = 4,
  '5: sin rol G3/G4 o sin la doble confirmación se rechaza, queda registrado y no se toca nada');

SELECT public.portal_client_offboarding_execute(:'cld', :'staff', 'DAR DE BAJA', ' ddd010101ddd ') AS offd \gset
SELECT portal_test.ok(NOT (:'offd'::jsonb->>'rechazada')::boolean
  AND :'offd'::jsonb->'usuarios' = to_jsonb(ARRAY[:'pd1'::uuid])
  AND (SELECT count(*) FROM public.client_sat_certificates WHERE client_id = :'cld' AND cert_type = 'csd_sello') = 0
  AND NOT EXISTS (SELECT 1 FROM public.portal_memberships WHERE client_id = :'cld')
  AND EXISTS (SELECT 1 FROM public.portal_memberships WHERE client_id = :'clb' AND user_id = :'pd2')
  AND (SELECT status FROM public.portal_accounts WHERE user_id = :'pd1') = 'suspendida',
  '5: CSD destruido; nadie conserva acceso al cliente; quien tiene otra empresa conserva su cuenta; la otra cuenta queda por borrar');
SELECT portal_test.ok(
  (SELECT count(*) FROM public.portal_retention_holds WHERE client_id = :'cld' AND years = 10
     AND retain_until::date = (now() + interval '10 years')::date) = 3
  AND EXISTS (SELECT 1 FROM public.portal_retention_elections WHERE client_id = :'cld' AND elected_kind = 'kawiil'
                AND deletion_request_id = (:'offd'::jsonb->>'request_id')::uuid)
  AND (SELECT requested_by FROM public.portal_deletion_requests WHERE id = (:'offd'::jsonb->>'request_id')::uuid) = :'staff'
  AND NOT (SELECT plan::text LIKE '%admin.d@%' FROM public.portal_deletion_requests WHERE id = (:'offd'::jsonb->>'request_id')::uuid)
  AND EXISTS (SELECT 1 FROM public.portal_audit_log WHERE action = 'cliente_baja_solicitud' AND client_id = :'cld' AND actor_user_id = :'staff')
  AND EXISTS (SELECT 1 FROM public.portal_audit_log WHERE action = 'cliente_baja' AND client_id = :'cld' AND actor_user_id = :'staff'),
  '5: resguardo con el plazo del cliente; solicitud y ejecución registradas (sin datos personales en la solicitud)');
-- Auth falla la primera vez: la solicitud queda en error y se puede reintentar.
SELECT portal_test.ok(public.portal_client_offboarding_finish((:'offd'::jsonb->>'request_id')::uuid, 'fallo simulado de Auth') = 'error'
  AND public.portal_client_offboarding_pending((:'offd'::jsonb->>'request_id')::uuid) = ARRAY[:'pd1'::uuid],
  '5: si Auth falla, la baja queda en error con la cuenta pendiente de borrar');
DELETE FROM auth.users WHERE id = :'pd1';
DELETE FROM storage.objects o USING public.portal_storage_purge_queue q
 WHERE q.deletion_request_id = (:'offd'::jsonb->>'request_id')::uuid AND o.bucket_id = q.bucket AND o.name = q.path;
SELECT public.portal_purge_queue_done(ARRAY(SELECT id FROM public.portal_storage_purge_queue WHERE deletion_request_id = (:'offd'::jsonb->>'request_id')::uuid));
SELECT portal_test.ok(public.portal_client_offboarding_finish((:'offd'::jsonb->>'request_id')::uuid) = 'ejecutada',
  '5: al reintentar y borrar la cuenta, la baja queda ejecutada');
SELECT public.portal_offboarding_record_verification((:'offd'::jsonb->>'request_id')::uuid, :'pd1', 'admin.d@prueba.invalid') AS verd \gset
SELECT portal_test.ok((:'verd'::jsonb->>'ok')::boolean
  AND EXISTS (SELECT 1 FROM storage.objects WHERE name = :'orgk' || '/' || :'cld' || '/cfdi/d.xml')
  AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE name LIKE :'orgk' || '/' || :'cld' || '/FISCAL/%')
  AND (SELECT created_by FROM public.portal_cfdi WHERE client_id = :'cld') = public.portal_pseudonym_uuid(:'pd1'),
  '5/6: la verificación de B2 no encuentra certificados, contraseñas, accesos ni adjuntos; el CFDI resguardado no identifica a nadie');
SELECT portal_test.ok((public.portal_client_offboarding_execute(:'cld', :'staff', 'DAR DE BAJA', 'DDD010101DDD')->>'motivo') = 'bloqueada',
  '5: un cliente ya dado de baja no se da de baja dos veces');
-- Nueva elección expresa sobre un resguardo en curso: sí lo modifica.
SET ROLE authenticated;
SELECT portal_test.login(:'staff');
SELECT public.portal_staff_set_client_retention(:'cld', 5, 'El cliente pidió volver a cinco años (sintético)');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT portal_test.ok((SELECT bool_and(years = 5 AND retain_until = created_at + interval '5 years')
                         FROM public.portal_retention_holds WHERE client_id = :'cld' AND purged_at IS NULL),
  '8: solo una nueva elección expresa (G3/G4) cambia el plazo en curso, contado desde el inicio del resguardo');

-- =================================================================
-- B1 (cierre) · El plazo de un cliente solo lo consultan sus personas y G3/G4 de su organización
-- =================================================================
SET ROLE authenticated;
SELECT portal_test.login(:'ua');
SELECT portal_test.ok(public.portal_client_retention_years(:'cla') = 5, 'B1: una persona del portal consulta el plazo de SU cliente');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_client_retention_years(%L)', :'clb')),
  'B1: una persona del portal NO consulta el plazo de otro cliente');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_client_retention_years(%L)', :'cld')),
  'B1: ni el de un cliente dado de baja al que no pertenece');
SELECT portal_test.login(:'staff');
SELECT portal_test.ok(public.portal_client_retention_years(:'cld') = 5 AND public.portal_client_retention_years(:'clb') = 5,
  'B1: G3/G4 de la organización consulta el plazo de sus clientes');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_client_retention_years(%L)', :'clc')),
  'B1: G3/G4 no consulta el de un cliente de otra organización');
SELECT portal_test.login(:'staff2');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_client_retention_years(%L)', :'cla')), 'B1: G1 no consulta plazos');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal__client_retention_years(%L)', :'cla')),
  'B1: la versión interna no la ejecuta ningún usuario');
RESET ROLE;
SET ROLE anon;
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_client_retention_years(%L)', :'cla')), 'B1: sin sesión, no');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- =================================================================
-- 7 · La purga respeta el plazo de cada resguardo (cinco y diez)
-- =================================================================
SELECT public.portal_purge_expired_retention(now() + interval '5 years 2 days') AS p5 \gset
SELECT portal_test.ok(
  NOT EXISTS (SELECT 1 FROM public.portal_cfdi WHERE client_id = :'cl5')
  AND NOT EXISTS (SELECT 1 FROM public.fis_receipts WHERE client_id = :'cl5')
  AND NOT EXISTS (SELECT 1 FROM public.portal_legal_acceptances WHERE user_id = public.portal_pseudonym_uuid(:'u5'))
  AND EXISTS (SELECT 1 FROM public.portal_cfdi WHERE client_id = :'cl10')
  AND EXISTS (SELECT 1 FROM public.fis_receipts WHERE client_id = :'cl10' AND status = 'invoiced')
  AND EXISTS (SELECT 1 FROM public.portal_legal_acceptances WHERE user_id = public.portal_pseudonym_uuid(:'u10')),
  '7: a los cinco años se purga lo resguardado a cinco; lo de diez sigue');
SELECT public.portal_purge_expired_retention(now() + interval '10 years 2 days') AS p10 \gset
SELECT portal_test.ok(
  NOT EXISTS (SELECT 1 FROM public.portal_cfdi WHERE client_id = :'cl10')
  AND NOT EXISTS (SELECT 1 FROM public.fis_receipts WHERE client_id = :'cl10')
  AND NOT EXISTS (SELECT 1 FROM public.portal_legal_acceptances WHERE user_id = public.portal_pseudonym_uuid(:'u10'))
  AND EXISTS (SELECT 1 FROM public.portal_audit_log WHERE action = 'retencion_purga' AND client_id = :'cl10' AND details->>'anios' = '10'),
  '7: a los diez años se purga lo resguardado a diez');

-- =================================================================
-- B5 · Nadie lee las columnas cifradas con roles del navegador
-- =================================================================
SELECT count(*) AS n_cert FROM public.client_sat_certificates \gset
SELECT count(*) AS n_pass FROM public.portal_csd_secrets \gset
SELECT portal_test.ok(:n_cert > 0 AND :n_pass > 0, 'B5: hay certificados y contraseñas cifradas en la base de prueba');
SET ROLE authenticated;
SELECT portal_test.login(:'staff');
SELECT portal_test.ok(COALESCE(portal_test.count_rows('SELECT cert_ciphertext, key_ciphertext FROM public.client_sat_certificates'), 0) = 0
  AND COALESCE(portal_test.count_rows('SELECT password_ciphertext FROM public.portal_csd_secrets'), 0) = 0
  AND COALESCE(portal_test.count_rows('SELECT * FROM public.moffin_client_fiel'), 0) = 0,
  'B5: el equipo (G4) no lee certificados, llaves ni contraseñas cifradas por SQL con su rol');
SELECT portal_test.login(:'ua');
SELECT portal_test.ok(COALESCE(portal_test.count_rows('SELECT cert_ciphertext, key_ciphertext FROM public.client_sat_certificates'), 0) = 0
  AND COALESCE(portal_test.count_rows('SELECT password_ciphertext FROM public.portal_csd_secrets'), 0) = 0
  AND COALESCE(portal_test.count_rows('SELECT * FROM public.moffin_client_fiel'), 0) = 0,
  'B5: el portal no lee certificados, llaves ni contraseñas cifradas');
RESET ROLE;
SET ROLE anon;
SELECT portal_test.ok(COALESCE(portal_test.count_rows('SELECT cert_ciphertext FROM public.client_sat_certificates'), 0) = 0
  AND COALESCE(portal_test.count_rows('SELECT password_ciphertext FROM public.portal_csd_secrets'), 0) = 0,
  'B5: sin sesión tampoco');
RESET ROLE;
SELECT portal_test.ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                                    AND tablename IN ('client_sat_certificates', 'portal_csd_secrets') AND permissive = 'PERMISSIVE')
  AND NOT has_table_privilege('authenticated', 'public.portal_csd_secrets', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.client_sat_certificates', 'SELECT'),
  'B5: ninguna política abre esas tablas a roles del navegador');
SELECT portal_test.ok(NOT EXISTS (SELECT 1 FROM pg_db_role_setting WHERE array_to_string(setconfig, ',') ~* '(csd|fiel).*secret')
  AND (SELECT bool_and(key_secret_ref = 'PORTAL_CSD_KEY_SECRET') FROM public.portal_csd_registry),
  'B5: la base guarda solo el NOMBRE del secreto; ningún valor de secreto está en su configuración');

RESET ROLE;
DROP SCHEMA portal_test CASCADE;
\echo 'TODAS LAS PRUEBAS DE BASE DEL PORTAL PASARON'
