-- =================================================================
-- Checks del Bloque 1 de Múuch' contra Postgres local + schema-stub.
-- Simula roles con `SET ROLE` y el JWT con `request.jwt.claim.sub`.
-- Cada sección aborta con RAISE EXCEPTION si algo no cuadra.
-- =================================================================
\set ON_ERROR_STOP on
\pset footer off

\echo '== seed =='

-- UUIDs fijos para legibilidad.
INSERT INTO auth.users (id) VALUES
  ('11111111-0000-0000-0000-00000000000a'),
  ('11111111-0000-0000-0000-00000000000b') ON CONFLICT DO NOTHING;

INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000aa', 'Org A'),
  ('bbbbbbbb-0000-0000-0000-0000000000bb', 'Org B') ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (user_id, organization_id, full_name, email) VALUES
  ('11111111-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000aa', 'Usuario A', 'a@orga.test'),
  ('11111111-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-0000000000bb', 'Usuario B', 'b@orgb.test') ON CONFLICT DO NOTHING;

INSERT INTO public.clients (id, organization_id, name, responsible_user_id) VALUES
  ('cccccccc-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000aa', 'Cliente A1', '11111111-0000-0000-0000-00000000000a'),
  ('cccccccc-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-0000000000aa', 'Cliente A2', '11111111-0000-0000-0000-00000000000a'),
  ('cccccccc-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000000bb', 'Cliente B1', '11111111-0000-0000-0000-00000000000b') ON CONFLICT DO NOTHING;

INSERT INTO public.client_groups (id, organization_id, name) VALUES
  ('99999999-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000aa', 'Grupo A') ON CONFLICT DO NOTHING;

INSERT INTO public.client_group_members (group_id, client_id) VALUES
  ('99999999-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-0000000000a1'),
  ('99999999-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-0000000000a2') ON CONFLICT DO NOTHING;

INSERT INTO public.projects (id, organization_id, client_id, name) VALUES
  ('dddddddd-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000aa', 'cccccccc-0000-0000-0000-0000000000a1', 'Proyecto A') ON CONFLICT DO NOTHING;

INSERT INTO public.tasks (id, organization_id, client_id, title) VALUES
  ('eeeeeeee-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000aa', 'cccccccc-0000-0000-0000-0000000000a1', 'Tarea A') ON CONFLICT DO NOTHING;

\echo '== a) RLS + generación de instancias =='

SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-0000-0000-0000-00000000000a';

-- Serie de cliente y serie de grupo, en org A.
INSERT INTO public.mtg_series (id, organization_id, anchor_type, anchor_id, client_id, title, cadence, starts_at, owner_user_id, created_by)
VALUES
  ('55555555-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000aa', 'client', 'cccccccc-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-0000000000a1', 'Semanal A1', 'weekly', '2026-09-21 10:00:00-06', '11111111-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-00000000000a'),
  ('55555555-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000aa', 'group', '99999999-0000-0000-0000-0000000000a1', NULL, 'Mensual Grupo A', 'monthly', '2026-10-01 09:00:00-06', '11111111-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-00000000000a');

DO $$
DECLARE
  v int;
BEGIN
  v := public.mtg_generate_series_meetings('55555555-0000-0000-0000-000000000001', 8);
  IF v <> 8 THEN
    RAISE EXCEPTION 'a) primera generación debía insertar 8, insertó %', v;
  END IF;

  v := public.mtg_generate_series_meetings('55555555-0000-0000-0000-000000000001', 8);
  IF v <> 0 THEN
    RAISE EXCEPTION 'a) segunda generación debía insertar 0, insertó %', v;
  END IF;

  v := public.mtg_generate_series_meetings('55555555-0000-0000-0000-000000000002', 8);
  IF v <> 8 THEN
    RAISE EXCEPTION 'a) serie mensual debía insertar 8, insertó %', v;
  END IF;
END $$;

\echo '== a) aislamiento entre orgs (usuario B) =='

RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-0000-0000-0000-00000000000b';

DO $$
BEGIN
  IF (SELECT count(*) FROM public.mtg_series) <> 0 THEN
    RAISE EXCEPTION 'a) usuario B ve series de org A';
  END IF;
  IF (SELECT count(*) FROM public.mtg_meetings) <> 0 THEN
    RAISE EXCEPTION 'a) usuario B ve juntas de org A';
  END IF;
END $$;

-- INSERT con organization_id ajena debe rebotar por RLS.
DO $$
DECLARE
  v_ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.mtg_series (organization_id, anchor_type, anchor_id, client_id, title, cadence)
    VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa', 'client', 'cccccccc-0000-0000-0000-0000000000b1', 'cccccccc-0000-0000-0000-0000000000b1', 'Intrusion', 'adhoc');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  IF v_ok THEN RAISE EXCEPTION 'a) usuario B pudo insertar serie en org A'; END IF;
END $$;

\echo '== b) trigger de ancla =='

RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-0000-0000-0000-00000000000a';

-- anchor_id de un cliente de otra org → excepción del trigger (y RLS).
DO $$
DECLARE
  v_ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.mtg_series (organization_id, anchor_type, anchor_id, client_id, title, cadence)
    VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa', 'client', 'cccccccc-0000-0000-0000-0000000000b1', 'cccccccc-0000-0000-0000-0000000000b1', 'Ancla ajena', 'adhoc');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  IF v_ok THEN RAISE EXCEPTION 'b) serie client con ancla de otra org no falló'; END IF;
END $$;

-- anchor_type='group' con grupo inexistente → excepción.
DO $$
DECLARE
  v_ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.mtg_series (organization_id, anchor_type, anchor_id, title, cadence)
    VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa', 'group', '99999999-9999-9999-9999-999999999999', 'Grupo fantasma', 'adhoc');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  IF v_ok THEN RAISE EXCEPTION 'b) serie group con ancla inexistente no falló'; END IF;
END $$;

\echo '== c) CHECK auto_transcript sin aviso =='

DO $$
DECLARE
  v_ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.mtg_series (organization_id, anchor_type, anchor_id, client_id, title, cadence, auto_transcript)
    VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa', 'client', 'cccccccc-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-0000000000a1', 'Sin aviso', 'adhoc', true);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  IF v_ok THEN RAISE EXCEPTION 'c) auto_transcript sin notice pasó el CHECK'; END IF;
END $$;

\echo '== d) mtg_audit_log append-only =='

-- INSERT como usuario A: ok.
INSERT INTO public.mtg_audit_log (id, organization_id, actor_user_id, entity_type, entity_id, action)
VALUES ('77777777-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000aa', '11111111-0000-0000-0000-00000000000a', 'series', '55555555-0000-0000-0000-000000000001', 'series_created');

-- UPDATE como usuario A → debe fallar.
DO $$
DECLARE
  v_ok boolean := false;
BEGIN
  BEGIN
    UPDATE public.mtg_audit_log SET action = 'x' WHERE id = '77777777-0000-0000-0000-000000000001';
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  IF v_ok THEN RAISE EXCEPTION 'd) UPDATE de audit_log no falló (usuario A)'; END IF;
END $$;

-- DELETE como usuario A → debe fallar.
DO $$
DECLARE
  v_ok boolean := false;
BEGIN
  BEGIN
    DELETE FROM public.mtg_audit_log WHERE id = '77777777-0000-0000-0000-000000000001';
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  IF v_ok THEN RAISE EXCEPTION 'd) DELETE de audit_log no falló (usuario A)'; END IF;
END $$;

-- UPDATE/DELETE como service_role → debe fallar igual (trigger + REVOKE).
RESET ROLE;
SET ROLE service_role;

DO $$
DECLARE
  v_ok boolean := false;
BEGIN
  BEGIN
    UPDATE public.mtg_audit_log SET action = 'x' WHERE id = '77777777-0000-0000-0000-000000000001';
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  IF v_ok THEN RAISE EXCEPTION 'd) UPDATE de audit_log no falló (service_role)'; END IF;
END $$;

DO $$
DECLARE
  v_ok boolean := false;
BEGIN
  BEGIN
    DELETE FROM public.mtg_audit_log WHERE id = '77777777-0000-0000-0000-000000000001';
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  IF v_ok THEN RAISE EXCEPTION 'd) DELETE de audit_log no falló (service_role)'; END IF;
END $$;

\echo '== e) storage: bucket mtg aislado por org =='

RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-0000-0000-0000-00000000000a';

INSERT INTO storage.objects (id, bucket_id, name, owner)
VALUES ('88888888-0000-0000-0000-000000000001', 'mtg',
        'aaaaaaaa-0000-0000-0000-0000000000aa/mtg/client/cccccccc-0000-0000-0000-0000000000a1/2026/09/evidence/test.txt',
        '11111111-0000-0000-0000-00000000000a');

RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-0000-0000-0000-00000000000b';

DO $$
BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE id = '88888888-0000-0000-0000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'e) usuario B ve el objeto de org A en bucket mtg';
  END IF;
END $$;

DO $$
DECLARE
  v_ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('mtg', 'aaaaaaaa-0000-0000-0000-0000000000aa/mtg/client/cccccccc-0000-0000-0000-0000000000a1/2026/09/evidence/intrusion.txt', '11111111-0000-0000-0000-00000000000b');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  IF v_ok THEN RAISE EXCEPTION 'e) usuario B pudo escribir en path de org A'; END IF;
END $$;

-- Limpieza del objeto de prueba.
RESET ROLE;
DELETE FROM storage.objects WHERE id = '88888888-0000-0000-0000-000000000001';

\echo '== f) mtg_agreements CHECK task_id =='

DO $$
DECLARE
  v_meeting uuid;
  v_ok boolean := false;
BEGIN
  SELECT id INTO v_meeting FROM public.mtg_meetings
   WHERE series_id = '55555555-0000-0000-0000-000000000001' LIMIT 1;

  BEGIN
    INSERT INTO public.mtg_agreements (organization_id, meeting_id, client_id, text, origin, status, task_id)
    VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa', v_meeting, 'cccccccc-0000-0000-0000-0000000000a1', 'Acuerdo inválido', 'captured_live', 'proposed', 'eeeeeeee-0000-0000-0000-0000000000a1');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  IF v_ok THEN RAISE EXCEPTION 'f) acuerdo proposed con task_id pasó el CHECK'; END IF;
END $$;

\echo '== todos los checks pasaron =='
