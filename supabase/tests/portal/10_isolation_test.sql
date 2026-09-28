-- =================================================================
-- Pruebas de base del portal del cliente (aislamiento, publicación,
-- expediente, CSD, tickets, mensajería, eliminación de cuenta, bitácora).
--
-- Corre en un Postgres local con el stub de Supabase y TODAS las
-- migraciones aplicadas (ver run_portal_db_tests.sh). Datos 100 % sintéticos.
-- Cada verificación imprime «OK …» o aborta con «FALLA …».
-- =================================================================
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

-- ── Utilidades de prueba ────────────────────────────────────────────
DROP SCHEMA IF EXISTS portal_test CASCADE;
CREATE SCHEMA portal_test;
GRANT USAGE ON SCHEMA portal_test TO authenticated, anon;

CREATE FUNCTION portal_test.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALLA: %', _msg; END IF;
  RAISE NOTICE 'OK  %', _msg;
END $$;

-- true si la sentencia lanza error (cualquier error). No atrapa FALLA de ok().
CREATE FUNCTION portal_test.raises(_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END $$;

-- Filas que ve el invocador; NULL si no tiene privilegio (cuenta como «no ve»).
CREATE FUNCTION portal_test.count_rows(_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || _sql || ') q' INTO n;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN NULL;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA portal_test TO authenticated, anon;

CREATE FUNCTION portal_test.login(_uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, false);
$$;
GRANT EXECUTE ON FUNCTION portal_test.login(uuid) TO authenticated, anon;

-- ── Datos sintéticos ────────────────────────────────────────────────
\set orgk   'a0000000-0000-0000-0000-000000000001'
\set org2   'b0000000-0000-0000-0000-000000000002'
\set staff  '11111111-0000-0000-0000-000000000001'
\set staff2 '11111111-0000-0000-0000-000000000002'
\set cla    'aaaaaaaa-0000-0000-0000-00000000000a'
\set clb    'bbbbbbbb-0000-0000-0000-00000000000b'
\set clc    'cccccccc-0000-0000-0000-00000000000c'
\set ua     '22222222-0000-0000-0000-00000000000a'
\set ua2    '22222222-0000-0000-0000-0000000000a2'
\set uac    '22222222-0000-0000-0000-0000000000ac'
\set ub     '22222222-0000-0000-0000-00000000000b'
\set up     '22222222-0000-0000-0000-00000000000f'

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
-- Simula lo que hace PostgREST en cada petición: corre portal_pre_request() (V1).
-- Sin esta marca la base bloquea la vinculación (lo prueba 20_corrections_test.sql).
SELECT set_config('portal.pre_request_ran', 'on', false);

INSERT INTO public.organizations (id, name, slug) VALUES
  (:'orgk', 'Kawiil (prueba)', 'kawiil-prueba'), (:'org2', 'Otra org (prueba)', 'otra-prueba')
ON CONFLICT (id) DO NOTHING;
UPDATE public.portal_config SET basic_organization_id = :'orgk' WHERE id;

-- Staff: alta normal (sin marca) → handle_new_user le crea perfil y rol como siempre.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'staff', 'staff.g4@prueba.invalid', '{"full_name":"Staff G4"}'),
  (:'staff2', 'staff.g1@prueba.invalid', '{"full_name":"Staff G1"}');
UPDATE public.user_roles SET role = 'transformador' WHERE user_id = :'staff';

SELECT portal_test.ok((SELECT count(*) FROM public.profiles WHERE user_id IN (:'staff', :'staff2')) = 2,
  'alta de staff sin marca sigue creando perfil (comportamiento previo intacto)');

INSERT INTO public.clients (id, organization_id, name, rfc) VALUES
  (:'cla', :'orgk', 'Cliente Sintético A', 'AAA010101AAA'),
  (:'clb', :'orgk', 'Cliente Sintético B', 'BBB010101BBB'),
  (:'clc', :'org2', 'Cliente Sintético C', 'CCC010101CCC');

-- Cuentas del portal: alta con la marca kawiil_portal (como hace portal-signup).
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'ua',  'admin.a@prueba.invalid', '{"kawiil_portal":true,"full_name":"Admin A"}'),
  (:'ua2', 'oper.a@prueba.invalid',  '{"kawiil_portal":true,"full_name":"Operativo A"}'),
  (:'uac', 'consulta.a@prueba.invalid', '{"kawiil_portal":true,"full_name":"Consulta A"}'),
  (:'ub',  'admin.b@prueba.invalid', '{"kawiil_portal":true,"full_name":"Admin B"}'),
  (:'up',  'pendiente@prueba.invalid', '{"kawiil_portal":true,"full_name":"Pendiente"}');

SELECT portal_test.ok(
  (SELECT count(*) FROM public.portal_accounts WHERE user_id IN (:'ua', :'ua2', :'uac', :'ub', :'up') AND status = 'pendiente') = 5
  AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id IN (:'ua', :'ua2', :'uac', :'ub', :'up'))
  AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id IN (:'ua', :'ua2', :'uac', :'ub', :'up')),
  'alta del portal: nace pendiente, SIN perfil de staff ni rol');

-- El staff G4 vincula (RPC real, con su sesión).
SET ROLE authenticated;
SELECT portal_test.login(:'staff');
SELECT public.portal_staff_link_account(:'ua', :'cla', 'administrador', 'premier');
SELECT public.portal_staff_link_account(:'ua2', :'cla', 'operativo', 'premier');
SELECT public.portal_staff_link_account(:'uac', :'cla', 'consulta', 'premier');
SELECT public.portal_staff_link_account(:'ub', :'clb', 'administrador', 'premier');
SELECT portal_test.ok(portal_test.raises(format(
  'SELECT public.portal_staff_link_account(%L, %L, ''administrador'', ''premier'')', :'ua', :'clc')),
  'staff no puede vincular a un cliente de otra organización');
RESET ROLE;

-- Staff G1 no puede vincular.
SET ROLE authenticated;
SELECT portal_test.login(:'staff2');
SELECT portal_test.ok(portal_test.raises(format(
  'SELECT public.portal_staff_link_account(%L, %L, ''administrador'', ''premier'')', :'up', :'cla')),
  'solo G3/G4 vinculan cuentas');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- Datos de negocio de A y de B (como postgres).
INSERT INTO public.portal_cfdi (organization_id, client_id, uuid, direction, source, fecha, rfc_emisor, nombre_emisor,
  rfc_receptor, tipo_comprobante, forma_pago, total, iva_trasladado, sat_status) VALUES
  (:'orgk', :'cla', 'AAAAAAAA-0000-4000-8000-000000000001', 'recibida', 'carga_xml', now(), 'PEM010101AAA', 'Gasolinera', 'AAA010101AAA', 'I', '01', 1500, 206.9, 'vigente'),
  (:'orgk', :'cla', 'AAAAAAAA-0000-4000-8000-000000000002', 'emitida', 'carga_xml', now(), 'AAA010101AAA', 'Cliente A', 'XAXX010101000', 'I', '03', 11600, 1600, 'vigente'),
  (:'orgk', :'clb', 'BBBBBBBB-0000-4000-8000-000000000001', 'recibida', 'carga_xml', now(), 'RES010101AAA', 'Restaurante', 'BBB010101BBB', 'I', '01', 5000, 689.66, 'vigente'),
  (:'orgk', :'clb', 'BBBBBBBB-0000-4000-8000-000000000002', 'emitida', 'carga_xml', now(), 'BBB010101BBB', 'Cliente B', 'XAXX010101000', 'I', '03', 2320, 320, 'vigente');

INSERT INTO public.portal_documents (organization_id, client_id, source, area, file_name, storage_path, status) VALUES
  (:'orgk', :'cla', 'subida', 'FISCAL', 'declaracion_a.pdf', :'orgk' || '/' || :'cla' || '/FISCAL/declaracion_a.pdf', 'publicado'),
  (:'orgk', :'clb', 'subida', 'FISCAL', 'declaracion_b.pdf', :'orgk' || '/' || :'clb' || '/FISCAL/declaracion_b.pdf', 'pendiente');

SELECT portal_test.ok((SELECT bool_and(status = 'pendiente') FROM public.portal_documents),
  'todo documento nace pendiente aunque el INSERT diga «publicado»');

SET ROLE authenticated;
SELECT portal_test.login(:'staff');
SELECT public.portal_staff_publish_document(id, 'Declaración B', 'declaracion', 2026, 8)
  FROM public.portal_documents WHERE client_id = :'clb';
RESET ROLE;

-- Hilo de B (lo abre el admin de B).
SET ROLE authenticated;
SELECT portal_test.login(:'ub');
SELECT public.portal_thread_create(:'clb', 'Duda de B', 'Mensaje confidencial de B') AS thread_b \gset
RESET ROLE;

-- Ticket de B.
INSERT INTO storage.objects (bucket_id, name) VALUES ('juun', :'orgk' || '/juun/clients/' || :'clb' || '/2026/09/receipts/t1.jpg');
SET ROLE authenticated;
SELECT portal_test.login(:'ub');
SELECT (public.portal_ticket_register(:'clb', :'orgk' || '/juun/clients/' || :'clb' || '/2026/09/receipts/t1.jpg',
        repeat('b', 64), (SELECT id FROM public.fis_merchants WHERE slug = 'oxxo'), NULL, current_date, 'F-1', 100))->>'receipt_id' AS receipt_b \gset
SELECT public.portal_cancel_request((SELECT id FROM public.portal_cfdi WHERE uuid = 'BBBBBBBB-0000-4000-8000-000000000002'), '02', NULL, 'error') AS cancel_b \gset
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- CSD sintético de B (el cifrado es basura: nadie debe poder leerlo).
INSERT INTO public.client_sat_certificates (id, organization_id, client_id, cert_type, cert_ciphertext, key_ciphertext,
  cert_serial, cert_not_before, cert_not_after)
VALUES ('dddddddd-0000-0000-0000-00000000000b', :'orgk', :'clb', 'csd_sello', 'CIFRADO-CER-B', 'CIFRADO-KEY-B',
  '00001000000500000001', now() - interval '1 day', now() + interval '2 years');
INSERT INTO public.portal_csd_registry (organization_id, client_id, certificate_id, cert_serial, cert_not_before, cert_not_after, registered_via)
VALUES (:'orgk', :'clb', 'dddddddd-0000-0000-0000-00000000000b', '00001000000500000001', now() - interval '1 day', now() + interval '2 years', 'portal');
INSERT INTO public.portal_csd_secrets (certificate_id, password_ciphertext) VALUES ('dddddddd-0000-0000-0000-00000000000b', 'CIFRADO-PASS-B');

-- Cebos de fuga en tablas del back-office.
INSERT INTO public.slack_user_profiles (slack_user_id) VALUES ('U-SECRETO');
DO $$
DECLARE v_stage uuid; v_lead uuid;
BEGIN
  BEGIN
    SELECT id INTO v_stage FROM public.pipeline_stages LIMIT 1;
    IF v_stage IS NULL THEN
      INSERT INTO public.pipeline_stages (organization_id, name, position)
      VALUES ('a0000000-0000-0000-0000-000000000001', 'Etapa prueba', 99) RETURNING id INTO v_stage;
    END IF;
    INSERT INTO public.leads (organization_id, full_name, stage_id)
    VALUES ('a0000000-0000-0000-0000-000000000001', 'Lead secreto', v_stage) RETURNING id INTO v_lead;
    INSERT INTO public.lead_tasks (lead_id, title, due_date) VALUES (v_lead, 'Tarea secreta', now());
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'aviso: no se pudo sembrar lead_tasks (%): se omite ese cebo', SQLERRM;
  END;
END $$;
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', 'org/contrato-secreto.pdf');
INSERT INTO storage.objects (bucket_id, name) VALUES ('portal', :'orgk' || '/' || :'clb' || '/FISCAL/declaracion_b.pdf');

SELECT portal_test.ok((SELECT count(*) FROM public.lead_tasks) >= 1 AND (SELECT count(*) FROM public.slack_user_profiles) >= 1
  AND (SELECT count(*) FROM storage.objects WHERE bucket_id = 'documents') >= 1,
  'cebos sembrados: lead_tasks, slack_user_profiles y bucket documents tienen filas');

-- =================================================================
-- CRITERIO 1 · Aislamiento: el usuario A no obtiene NADA del cliente B
-- =================================================================
SET ROLE authenticated;
SELECT portal_test.login(:'ua');

-- 1a. Barrido genérico: toda tabla y vista de public con client_id.
DO $$
DECLARE r record; n bigint; v_b uuid := 'bbbbbbbb-0000-0000-0000-00000000000b'; checked int := 0;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
       AND a.attname = 'client_id' AND NOT a.attisdropped
  LOOP
    n := portal_test.count_rows(format('SELECT 1 FROM public.%I WHERE client_id = %L', r.relname, v_b));
    IF COALESCE(n, 0) <> 0 THEN
      RAISE EXCEPTION 'FALLA: el usuario A ve % filas del cliente B en %', n, r.relname;
    END IF;
    checked := checked + 1;
  END LOOP;
  PERFORM portal_test.ok(checked > 20, format('barrido: %s tablas/vistas con client_id sin filas de B para A', checked));
END $$;

-- 1b. Barrido genérico: fuera del portal y la lista blanca, A no ve NINGUNA fila.
DO $$
DECLARE r record; n bigint; checked int := 0;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
       AND c.relname !~ '^portal_' AND c.relname <> ALL (ARRAY['fis_receipts', 'fis_cfdi', 'fis_merchants'])
  LOOP
    n := portal_test.count_rows(format('SELECT 1 FROM public.%I', r.relname));
    IF COALESCE(n, 0) <> 0 THEN
      RAISE EXCEPTION 'FALLA: una cuenta del portal ve % filas del back-office en %', n, r.relname;
    END IF;
    checked := checked + 1;
  END LOOP;
  PERFORM portal_test.ok(checked > 100, format('barrido: %s tablas/vistas del back-office invisibles para el portal', checked));
END $$;

-- 1c. Cambiar identificadores en cada RPC del portal.
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_dashboard(%L, 2026, 9)', :'clb')), 'RPC tablero con id de B → error');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_thread_create(%L, ''x'', ''y'')', :'clb')), 'abrir hilo en B → error');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_message_send(%L, ''intruso'')', :'thread_b')), 'escribir en hilo de B → error');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_thread_mark_read(%L)', :'thread_b')), 'marcar leído hilo de B → error');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_thread_read_state(%L)', :'thread_b')), 'estado de lectura de B → error');
SELECT portal_test.ok(portal_test.raises(format(
  'SELECT public.portal_ticket_register(%L, %L, %L)', :'clb', :'orgk' || '/juun/clients/' || :'clb' || '/2026/09/receipts/x.jpg', repeat('c', 64))),
  'registrar ticket en B → error');
SELECT portal_test.ok(portal_test.raises(format(
  'SELECT public.portal_ticket_register(%L, %L, %L)', :'cla', :'orgk' || '/juun/clients/' || :'clb' || '/2026/09/receipts/x.jpg', repeat('c', 64))),
  'registrar ticket en A con ruta de B → error');
SELECT portal_test.ok(portal_test.raises(format(
  'SELECT public.portal_cancel_request(%L, ''02'')', (SELECT id FROM public.portal_cfdi WHERE uuid = 'BBBBBBBB-0000-4000-8000-000000000002'))),
  'solicitar cancelación de factura de B → error');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_document_mark_read(%L)',
  (SELECT id FROM public.portal_documents WHERE client_id = :'clb'))), 'marcar leído documento de B → error');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_emission_dossier(%L)', :'clb')), 'expediente de B → error');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_accept_legal(''aviso_privacidad'', %L)', :'clb')), 'aceptar aviso a nombre de B → error');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_csd_status(:'clb')) = 0, 'estado CSD de B → vacío');
SELECT portal_test.ok(public.portal_basic_usage(:'clb') IS NULL, 'uso básico de B → nulo');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_staff_confirm_category(ARRAY[%L]::uuid[], %L)',
  (SELECT id FROM public.portal_cfdi WHERE client_id = :'cla' LIMIT 1), gen_random_uuid())), 'el portal no confirma categorías');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_staff_link_account(%L, %L, ''administrador'', ''premier'')', :'ua', :'clb')),
  'el portal no se vincula solo a B');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_staff_import_moffin_cfdi(%L, ''[]''::jsonb)', :'clb')), 'el portal no importa a B');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_staff_set_emission(%L, true)', :'cla')), 'el portal no prende su propia emisión');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_staff_accounts()) = 0, 'el portal no lista cuentas');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_staff_inbox('servicio')) = 0, 'el portal no ve la bandeja del equipo');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_staff_ticket_queue(true)) = 0, 'el portal no ve la cola de tickets');
SELECT portal_test.ok((SELECT jsonb_array_length(public.portal_me()->'clients')) = 1
  AND (SELECT public.portal_me()->'clients'->0->>'client_id') = :'cla', 'portal_me de A solo lista a A');

-- 1d. Storage.
SELECT portal_test.ok(COALESCE(portal_test.count_rows('SELECT 1 FROM storage.objects'), 0) = 0, 'A no lista ningún objeto de storage');
SELECT portal_test.ok(portal_test.raises(format('INSERT INTO storage.objects (bucket_id, name) VALUES (''portal'', %L)',
  :'orgk' || '/' || :'clb' || '/mensajes/' || :'thread_b' || '/x.pdf')), 'A no sube adjuntos al hilo de B');
SELECT portal_test.ok(portal_test.raises(format('INSERT INTO storage.objects (bucket_id, name) VALUES (''juun'', %L)',
  :'orgk' || '/juun/clients/' || :'clb' || '/2026/09/receipts/x.jpg')), 'A no sube tickets a B');
SELECT portal_test.ok(portal_test.raises('INSERT INTO storage.objects (bucket_id, name) VALUES (''documents'', ''org/x.pdf'')'),
  'A no escribe en el bucket documents');

-- 1e. Escalamiento a staff.
SELECT portal_test.ok(portal_test.raises(format(
  'INSERT INTO public.profiles (user_id, organization_id, email, full_name) VALUES (%L, %L, ''x@x'', ''x'')', :'ua', :'orgk')),
  'A no puede crearse perfil de staff (policy «Users insert own profile» neutralizada)');
SELECT portal_test.ok(portal_test.raises(format(
  'INSERT INTO public.user_roles (user_id, role) VALUES (%L, ''transformador'')', :'ua')), 'A no puede darse rol');
SELECT portal_test.ok(portal_test.raises('UPDATE public.lead_tasks SET title = ''pwned''')
  OR (SELECT count(*) FROM public.lead_tasks) = 0, 'A no edita lead_tasks (antes USING true)');
SELECT portal_test.ok(portal_test.raises(format(
  'INSERT INTO public.fis_receipts (organization_id, client_id, file_path, file_hash) VALUES (%L, %L, ''x'', %L)',
  :'orgk', :'cla', repeat('d', 64))), 'A no inserta tickets directo en fis_receipts');
SELECT portal_test.ok(portal_test.raises(format(
  'SELECT public.portal_audit(''acceso'', %L)', :'clb')), 'A no escribe bitácora arbitraria');

-- 1f. Capa 2 (pre-request de PostgREST).
SELECT portal_test.ok(portal_test.raises($q$SELECT set_config('request.path', '/lead_tasks', true), public.portal_pre_request()$q$),
  'pre-request: /lead_tasks bloqueado para el portal');
SELECT portal_test.ok(portal_test.raises($q$SELECT set_config('request.path', '/rpc/detect_duplicates', true), public.portal_pre_request()$q$),
  'pre-request: /rpc/detect_duplicates bloqueado');
SELECT portal_test.ok(portal_test.raises($q$SELECT set_config('request.path', '/rest/v1/clients', true), public.portal_pre_request()$q$),
  'pre-request: /rest/v1/clients bloqueado');
SELECT portal_test.ok(NOT portal_test.raises($q$SELECT set_config('request.path', '/portal_cfdi_v', true), public.portal_pre_request()$q$),
  'pre-request: /portal_cfdi_v permitido');
SELECT portal_test.ok(NOT portal_test.raises($q$SELECT set_config('request.path', '/rpc/portal_me', true), public.portal_pre_request()$q$),
  'pre-request: /rpc/portal_me permitido');
RESET ROLE;

-- El staff NO es afectado por el pre-request.
SET ROLE authenticated;
SELECT portal_test.login(:'staff');
SELECT portal_test.ok(NOT portal_test.raises($q$SELECT set_config('request.path', '/lead_tasks', true), public.portal_pre_request()$q$),
  'pre-request: staff sin cambios');
SELECT portal_test.ok((SELECT count(*) FROM public.clients) >= 2, 'staff sigue viendo sus clientes (sin regresión)');
RESET ROLE;

-- =================================================================
-- CRITERIO 2 · Cuenta nueva sin vincular no ve datos
-- =================================================================
SET ROLE authenticated;
SELECT portal_test.login(:'up');
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v')
              AND c.relname NOT IN ('portal_accounts', 'portal_legal_documents', 'fis_merchants')
  LOOP
    n := portal_test.count_rows(format('SELECT 1 FROM public.%I', r.relname));
    IF COALESCE(n, 0) <> 0 THEN RAISE EXCEPTION 'FALLA: cuenta pendiente ve % filas en %', n, r.relname; END IF;
  END LOOP;
  PERFORM portal_test.ok(true, 'cuenta pendiente: 0 filas en todas las tablas y vistas (salvo su cuenta y catálogos públicos)');
END $$;
SELECT portal_test.ok((SELECT count(*) FROM public.portal_accounts) = 1, 'cuenta pendiente solo ve su propia cuenta');
SELECT portal_test.ok(public.portal_me()->>'status' = 'pendiente' AND jsonb_array_length(public.portal_me()->'clients') = 0,
  'portal_me pendiente: sin clientes');
RESET ROLE;

-- =================================================================
-- CRITERIO 4 · Publicar / despublicar
-- =================================================================
SET ROLE authenticated;
SELECT portal_test.login(:'ua');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_documents) = 0, 'documento pendiente de A: invisible para A');
SELECT portal_test.login(:'ub');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_documents) = 1, 'documento publicado de B: visible para B');
SELECT portal_test.login(:'staff');
SELECT portal_test.ok(portal_test.raises(format(
  'UPDATE public.portal_documents SET status = ''publicado'', title = ''x'', doc_type = ''otro'', period_year = 2026 WHERE client_id = %L', :'cla')),
  'no se publica por UPDATE directo');
SELECT public.portal_staff_publish_document(id, 'Declaración A', 'declaracion', 2026, 8) FROM public.portal_documents WHERE client_id = :'cla';
SELECT portal_test.login(:'ua');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_documents) = 1, 'tras publicar: A ve su documento');
SELECT public.portal_document_mark_read(id) FROM public.portal_documents;
SELECT portal_test.login(:'staff');
SELECT public.portal_staff_unpublish_document(id) FROM public.portal_documents WHERE client_id = :'cla';
SELECT portal_test.login(:'ua');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_documents) = 0, 'tras despublicar: desaparece');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT portal_test.ok(EXISTS (SELECT 1 FROM public.portal_audit_log WHERE action = 'publicacion' AND client_id = :'cla')
  AND EXISTS (SELECT 1 FROM public.portal_audit_log WHERE action = 'despublicacion' AND client_id = :'cla')
  AND EXISTS (SELECT 1 FROM public.portal_audit_log WHERE action = 'documento_consulta' AND client_id = :'cla'),
  'bitácora: publicación, despublicación y consulta con autor');
SELECT portal_test.ok(portal_test.raises(format(
  'INSERT INTO public.portal_documents (organization_id, client_id, source, area, file_name, storage_path) VALUES (%L, %L, ''subida'', ''FISCAL'', ''FIEL_cliente.key'', ''x'')',
  :'orgk', :'cla')), 'la base rechaza un .key aunque lo inserte service_role/postgres');
SELECT portal_test.ok(portal_test.raises(format(
  'INSERT INTO public.portal_documents (organization_id, client_id, source, area, file_name, storage_path) VALUES (%L, %L, ''subida'', ''ADMINISTRATIVO'', ''a.pdf'', ''x'')',
  :'orgk', :'cla')), 'la base rechaza el área ADMINISTRATIVO');

-- =================================================================
-- CRITERIO 5 · Emisión con expediente incompleto no se prende
-- =================================================================
SET ROLE authenticated;
SELECT portal_test.login(:'staff');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_staff_set_emission(%L, true)', :'cla')),
  'expediente incompleto: la base rechaza prender la emisión');
RESET ROLE;
SELECT portal_test.ok(portal_test.raises(format('UPDATE public.portal_client_settings SET emission_enabled = true WHERE client_id = %L', :'cla')),
  'ni siquiera postgres/service_role la prende por UPDATE directo');
-- Completar expediente de A.
INSERT INTO public.fis_tax_profiles (organization_id, client_id, rfc, razon_social, cp_fiscal, regimen_fiscal, is_default, csf_verified_at)
VALUES (:'orgk', :'cla', 'AAA010101AAA', 'CLIENTE SINTETICO A', '01000', '601', true, now());
INSERT INTO public.client_sat_certificates (id, organization_id, client_id, cert_type, cert_ciphertext, key_ciphertext,
  cert_serial, cert_not_before, cert_not_after)
VALUES ('dddddddd-0000-0000-0000-00000000000a', :'orgk', :'cla', 'csd_sello', 'CIFRADO-CER-A', 'CIFRADO-KEY-A',
  '00001000000500000002', now() - interval '1 day', now() + interval '2 years');
INSERT INTO public.portal_csd_registry (organization_id, client_id, certificate_id, cert_serial, cert_not_before, cert_not_after, registered_via)
VALUES (:'orgk', :'cla', 'dddddddd-0000-0000-0000-00000000000a', '00001000000500000002', now() - interval '1 day', now() + interval '2 years', 'central');
INSERT INTO public.portal_csd_secrets (certificate_id, password_ciphertext) VALUES ('dddddddd-0000-0000-0000-00000000000a', 'CIFRADO-PASS-A');
SET ROLE authenticated;
SELECT portal_test.login(:'staff');
SELECT public.portal_staff_register_instruction_letter(:'cla', '1.0', current_date);
SELECT portal_test.ok(NOT (public.portal_emission_dossier(:'cla')->>'complete')::boolean,
  'falta aviso de privacidad aceptado por un administrador → sigue incompleto');
SELECT portal_test.login(:'ua');
SELECT public.portal_accept_legal('aviso_privacidad');
SELECT portal_test.login(:'staff');
SELECT portal_test.ok((public.portal_staff_set_emission(:'cla', true)->>'complete')::boolean, 'expediente completo: se prende la emisión');
RESET ROLE;

-- =================================================================
-- CRITERIO 6 · El CSD no se lee de nuevo por ninguna ruta
-- =================================================================
SET ROLE authenticated;
SELECT portal_test.login(:'ua');
SELECT portal_test.ok(COALESCE(portal_test.count_rows('SELECT cert_ciphertext, key_ciphertext FROM public.client_sat_certificates'), 0) = 0,
  'portal: client_sat_certificates → 0 filas');
SELECT portal_test.ok(portal_test.count_rows('SELECT * FROM public.portal_csd_secrets') IS NULL, 'portal: portal_csd_secrets → sin privilegio');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_csd_status(:'cla')) = 1, 'portal: portal_csd_status devuelve el metadato');
SELECT portal_test.login(:'staff');
SELECT portal_test.ok(COALESCE(portal_test.count_rows('SELECT cert_ciphertext FROM public.client_sat_certificates'), 0) = 0,
  'staff tampoco lee cifrados por PostgREST');
SELECT portal_test.ok(portal_test.count_rows('SELECT * FROM public.portal_csd_secrets') IS NULL, 'staff: portal_csd_secrets → sin privilegio');
RESET ROLE;
-- Ninguna función o vista del portal expone columnas de cifrado.
SELECT portal_test.ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname ~ '^portal_'
     AND pg_get_function_result(p.oid) ~* '(ciphertext|private|key_)'),
  'ninguna función portal_* devuelve columnas de cifrado');
SELECT portal_test.ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name ~ '^portal_' AND table_name <> 'portal_csd_secrets'
     AND column_name ~* 'ciphertext'),
  'ninguna tabla/vista portal_* legible tiene columnas de cifrado');

-- =================================================================
-- CRITERIO 7 · Ticket vencido al subirse avisa en ese momento
-- =================================================================
SET ROLE authenticated;
SELECT portal_test.login(:'ua');
SELECT public.portal_ticket_register(:'cla', :'orgk' || '/juun/clients/' || :'cla' || '/2026/08/receipts/viejo.jpg',
  repeat('a', 64), (SELECT id FROM public.fis_merchants WHERE slug = 'oxxo'), NULL, current_date - 30, 'F-9', 250) AS t_vencido \gset
SELECT portal_test.ok((:'t_vencido'::jsonb->>'expired')::boolean AND :'t_vencido'::jsonb->>'visible_status' = 'vencido'
  AND :'t_vencido'::jsonb->>'message' ~ 'venció', 'ticket OXXO de hace 30 días: aviso de vencido en la respuesta');
SELECT public.portal_ticket_register(:'cla', :'orgk' || '/juun/clients/' || :'cla' || '/2026/09/receipts/nuevo.jpg',
  repeat('e', 64), (SELECT id FROM public.fis_merchants WHERE slug = 'walmart'), NULL, current_date, 'W-1', 500) AS t_ok \gset
SELECT portal_test.ok(NOT (:'t_ok'::jsonb->>'expired')::boolean AND :'t_ok'::jsonb->>'visible_status' = 'recibido', 'ticket Walmart de hoy: recibido');
SELECT portal_test.ok(((public.portal_ticket_register(:'cla', :'orgk' || '/juun/clients/' || :'cla' || '/2026/09/receipts/nuevo.jpg',
  repeat('e', 64)))->>'duplicate')::boolean, 'mismo hash → duplicado');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_ticket_register(%L, %L, %L, %L)', :'cla',
  :'orgk' || '/juun/clients/' || :'cla' || '/2026/09/receipts/caseta.jpg', repeat('f', 64), (SELECT id FROM public.fis_merchants WHERE slug = 'casetas'))),
  'casetas: no se factura por ticket');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_tickets_v) = 2, 'A ve sus 2 tickets (y ninguno de B)');
SELECT portal_test.login(:'uac');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_ticket_register(%L, %L, %L)', :'cla',
  :'orgk' || '/juun/clients/' || :'cla' || '/2026/09/receipts/c.jpg', repeat('9', 64))), 'rol consulta no sube tickets');
SELECT portal_test.login(:'staff');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_staff_ticket_queue(false) WHERE client_id = :'cla') = 2,
  'la bandeja «Facturación de gastos» ve los tickets de A');
SELECT portal_test.ok((SELECT expires_at FROM public.portal_staff_ticket_queue(false) ORDER BY expires_at LIMIT 1)
  <= (SELECT max(expires_at) FROM public.portal_staff_ticket_queue(false)), 'ordenada por fecha límite');
RESET ROLE;

-- =================================================================
-- CRITERIO 8 · Mensaje portal → bandeja «Clientes» → respuesta en el portal
-- =================================================================
SET ROLE authenticated;
SELECT portal_test.login(:'ua');
SELECT public.portal_thread_create(:'cla', 'Pregunta de A', '¿Ya está mi declaración?') AS thread_a \gset
SELECT portal_test.login(:'staff');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_staff_inbox('servicio') WHERE thread_id = :'thread_a' AND unread_count = 1) = 1,
  'el mensaje aparece en la bandeja «Clientes» con 1 sin leer');
SELECT public.portal_message_send(:'thread_a', 'Sí, ya quedó. Se la publicamos hoy.');
SELECT public.portal_staff_thread_update(:'thread_a', :'staff', 'resuelto');
SELECT portal_test.login(:'staff2');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_staff_inbox('servicio')) = 0, 'staff no asignado no ve hilos de clientes');
SELECT portal_test.login(:'ua');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_messages WHERE thread_id = :'thread_a' AND author_kind = 'equipo') = 1,
  'la respuesta del equipo aparece en el portal');
SELECT portal_test.ok((public.portal_thread_read_state(:'thread_a')->>'team_last_read_at') IS NOT NULL, 'estado de lectura visible para el cliente');
SELECT portal_test.login(:'uac');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_message_send(%L, ''hola'')', :'thread_a')), 'rol consulta no escribe');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT portal_test.ok((SELECT count(*) FROM public.portal_outbox WHERE channel = 'slack' AND event = 'mensaje_nuevo' AND client_id = :'cla') = 1
  AND (SELECT count(*) FROM public.portal_outbox WHERE channel = 'correo' AND event = 'respuesta_equipo' AND client_id = :'cla') = 1,
  'aviso a Slack (sin cuerpo del mensaje) y correo al cliente encolados');
SELECT portal_test.ok(NOT EXISTS (SELECT 1 FROM public.portal_outbox WHERE payload::text ILIKE '%declaración?%'),
  'Slack recibe aviso, no la conversación');

-- =================================================================
-- Nivel básico, roles y tablero
-- =================================================================
SET ROLE authenticated;
SELECT portal_test.login(:'up');
SELECT (public.portal_activate_basic('Emprendedor Sintético', 'EMPR800101AB1')->>'client_id') AS cl_basic \gset
SELECT portal_test.ok(public.portal_me()->>'tier' = 'basico', 'nivel básico activado');
SELECT public.portal_thread_create(:'cl_basic', 'Quiero contratar', 'Me interesa la contabilidad') AS thread_basic \gset
SELECT portal_test.ok((SELECT kind FROM public.portal_threads WHERE id = :'thread_basic') = 'contratacion', 'básico solo abre hilos de contratación');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_ticket_register(%L, %L, %L)', :'cl_basic',
  :'orgk' || '/juun/clients/' || :'cl_basic' || '/2026/09/receipts/b.jpg', repeat('7', 64))), 'básico: tickets apagados');
SELECT portal_test.login(:'staff2');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_staff_inbox('contratacion') WHERE thread_id = :'thread_basic') = 1,
  'el hilo de contratación cae en «Prospectos»');
SELECT portal_test.login(:'staff');
SELECT public.portal_staff_register_upload(:'cl_basic', 'FISCAL', :'orgk' || '/' || :'cl_basic' || '/FISCAL/x.pdf', 'x.pdf', 'application/pdf', 10) AS doc_basic \gset
SELECT public.portal_staff_publish_document(:'doc_basic', 'Doc', 'otro', 2026, NULL);
SELECT portal_test.login(:'up');
SELECT portal_test.ok((SELECT count(*) FROM public.portal_documents) = 0, 'básico no ve documentos aunque estén publicados');
SELECT portal_test.login(:'ua2');
SELECT portal_test.ok(portal_test.raises(format('SELECT public.portal_dashboard(%L, 2026, 9)', :'cla')), 'rol operativo: sin tablero completo');
SELECT portal_test.login(:'ua');
SELECT public.portal_dashboard(:'cla', EXTRACT(year FROM now())::int, EXTRACT(month FROM now())::int) AS dash \gset
SELECT portal_test.ok((:'dash'::jsonb->>'leyenda') = 'Información de gestión, no sustituye la declaración.', 'tablero trae la leyenda');
SELECT portal_test.ok((:'dash'::jsonb->>'gasto_total')::numeric = 1500 AND (:'dash'::jsonb->>'ingreso_total')::numeric = 11600,
  'tablero: gasto e ingreso del mes solo de A');
SELECT portal_test.ok((:'dash'::jsonb->'iva'->>'acreditable')::numeric = 206.9 AND (:'dash'::jsonb->>'iva_estimado')::numeric = 1600 - 206.9,
  'tablero: IVA estimado (trasladado − acreditable)');
RESET ROLE;
-- Marcas de no deducibilidad.
SELECT portal_test.ok(public.portal_cfdi_flags('recibida', '01', 2500, 'general') @> '[{"code":"efectivo_mayor_2000"}]', 'marca efectivo > $2,000');
SELECT portal_test.ok(public.portal_cfdi_flags('recibida', '01', 500, 'combustible') @> '[{"code":"combustible_efectivo"}]', 'marca combustible en efectivo');
SELECT portal_test.ok(public.portal_cfdi_flags('recibida', '04', 500, 'restaurante') @> '[{"code":"restaurante_8_5"}]', 'marca restaurante 8.5 %');
SELECT portal_test.ok(jsonb_array_length(public.portal_cfdi_flags('recibida', '03', 5000, 'general')) = 0, 'sin marcas en transferencia');
SELECT portal_test.ok(jsonb_array_length(public.portal_cfdi_flags('emitida', '01', 5000, 'restaurante')) = 0, 'emitidas no llevan marcas');

-- Categorización: regla → confirmación humana.
INSERT INTO public.portal_category_rules (organization_id, category_id, match_rfc_emisor)
SELECT :'orgk', id, 'GAS010101AAA' FROM public.portal_expense_categories WHERE organization_id = :'orgk' AND kind = 'combustible' LIMIT 1;
INSERT INTO public.portal_cfdi (organization_id, client_id, uuid, direction, source, rfc_emisor, rfc_receptor, total, category_status)
VALUES (:'orgk', :'cla', 'AAAAAAAA-0000-4000-8000-000000000003', 'recibida', 'carga_xml', 'GAS010101AAA', 'AAA010101AAA', 100, 'confirmada');
SELECT portal_test.ok((SELECT category_status FROM public.portal_cfdi WHERE uuid = 'AAAAAAAA-0000-4000-8000-000000000003') = 'regla',
  'la regla categoriza, pero no confirma (ni aunque el INSERT diga «confirmada»)');

-- =================================================================
-- CRITERIO 9 · Eliminación de cuenta deja bitácora
-- =================================================================
-- Lo mismo que hace portal-api (cuenta.eliminar) con service_role.
SELECT public.portal_audit('cuenta_eliminada', NULL, 'portal_accounts', :'ua2', '{"motivo":"solicitud del titular"}', :'ua2');
DELETE FROM auth.users WHERE id = :'ua2';
SELECT portal_test.ok(NOT EXISTS (SELECT 1 FROM public.portal_accounts WHERE user_id = :'ua2')
  AND NOT EXISTS (SELECT 1 FROM public.portal_memberships WHERE user_id = :'ua2'), 'cuenta y membresías eliminadas');
SELECT portal_test.ok(EXISTS (SELECT 1 FROM public.portal_audit_log WHERE action = 'cuenta_eliminada' AND actor_user_id = :'ua2'
  AND actor_email = 'oper.a@prueba.invalid'), 'la bitácora conserva quién y cuándo');

-- Bitácora inmutable (incluso para postgres).
SELECT portal_test.ok(portal_test.raises('UPDATE public.portal_audit_log SET action = ''acceso'''), 'bitácora: UPDATE rechazado');
SELECT portal_test.ok(portal_test.raises('DELETE FROM public.portal_audit_log'), 'bitácora: DELETE rechazado');
SELECT portal_test.ok(portal_test.raises('TRUNCATE public.portal_audit_log'), 'bitácora: TRUNCATE rechazado');

-- Cerco completo: toda tabla del back-office tiene la policy restrictiva.
SELECT portal_test.ok(NOT EXISTS (
  SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND c.relname !~ '^portal_' AND c.relname <> ALL (public.portal_table_allowlist())
     AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname
                      AND p.policyname = 'portal_deny_portal_accounts')),
  'toda tabla del back-office tiene portal_deny_portal_accounts (una tabla nueva sin ella hace fallar esta prueba)');

RESET ROLE;
-- Continúa en 20_corrections_test.sql (mismos datos y utilidades).
