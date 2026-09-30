-- =================================================================
-- Checks B3–B5: job_queue, documents.client_group_id, slack_channel_id
-- Se corre tras aplicar las 3 migraciones nuevas sobre el stub + B1.
-- =================================================================
\set ON_ERROR_STOP on
\pset footer off

\echo '== B345 seed (reusa orgs del checks B1 si existen) =='

INSERT INTO auth.users (id) VALUES
  ('11111111-0000-0000-0000-00000000000a'),
  ('11111111-0000-0000-0000-00000000000b') ON CONFLICT DO NOTHING;

INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000aa', 'Org A'),
  ('bbbbbbbb-0000-0000-0000-0000000000bb', 'Org B') ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (user_id, organization_id, full_name, email) VALUES
  ('11111111-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000aa', 'Usuario A', 'a@orga.test'),
  ('11111111-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-0000000000bb', 'Usuario B', 'b@orgb.test') ON CONFLICT DO NOTHING;

INSERT INTO public.client_groups (id, organization_id, name) VALUES
  ('99999999-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000aa', 'Grupo A') ON CONFLICT DO NOTHING;

\echo '== g) claim_jobs concurrente sin duplicados =='

RESET ROLE;
INSERT INTO public.job_queue (id, organization_id, kind, payload, status, run_after)
VALUES
  ('d0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000aa', 'mtg.remind', '{"meeting_id":"m1","remind_kind":"t1d"}'::jsonb, 'pending', now() - interval '1 minute'),
  ('d0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000aa', 'mtg.remind', '{"meeting_id":"m1","remind_kind":"t1h"}'::jsonb, 'pending', now() - interval '1 minute');

DO $$
DECLARE
  c1 int;
  c2 int;
  overlap int;
BEGIN
  CREATE TEMP TABLE claim_a AS SELECT * FROM public.claim_jobs(ARRAY['mtg.remind'], 10, 'w-a', 600);
  CREATE TEMP TABLE claim_b AS SELECT * FROM public.claim_jobs(ARRAY['mtg.remind'], 10, 'w-b', 600);
  SELECT count(*) INTO c1 FROM claim_a;
  SELECT count(*) INTO c2 FROM claim_b;
  SELECT count(*) INTO overlap
  FROM claim_a a JOIN claim_b b ON a.id = b.id;
  IF overlap <> 0 THEN
    RAISE EXCEPTION 'g) claim concurrente duplicó jobs (%)', overlap;
  END IF;
  IF c1 + c2 <> 2 THEN
    RAISE EXCEPTION 'g) se esperaban 2 claims totales, got % + %', c1, c2;
  END IF;
END $$;

\echo '== h) lease expira y libera =='

UPDATE public.job_queue
SET status = 'leased', lease_until = now() - interval '1 minute', leased_by = 'stale', attempts = 1
WHERE id = 'd0000000-0000-0000-0000-000000000001';

DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM public.claim_jobs(ARRAY['mtg.remind'], 5, 'w-recover', 600)
    WHERE id = 'd0000000-0000-0000-0000-000000000001';
  IF n <> 1 THEN
    RAISE EXCEPTION 'h) lease expirado no se reclamó de nuevo';
  END IF;
END $$;

\echo '== i) backoff a dead =='

UPDATE public.job_queue
SET attempts = 3, max_attempts = 3, status = 'leased', lease_until = now() + interval '10 minutes'
WHERE id = 'd0000000-0000-0000-0000-000000000002';

SELECT public.fail_job('d0000000-0000-0000-0000-000000000002', 'boom');

DO $$
BEGIN
  IF (SELECT status FROM public.job_queue WHERE id = 'd0000000-0000-0000-0000-000000000002') <> 'dead' THEN
    RAISE EXCEPTION 'i) fail_job no marcó dead al agotar intentos';
  END IF;
END $$;

\echo '== j) documents.client_group_id FK =='

INSERT INTO public.documents (
  id, organization_id, name, source, file_path, mime_type, document_type, client_group_id
) VALUES (
  'e0000000-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-0000000000aa',
  'Minuta grupo',
  'supabase',
  'path/minuta.pdf',
  'application/pdf',
  'minuta',
  '99999999-0000-0000-0000-0000000000a1'
) ON CONFLICT (id) DO UPDATE SET client_group_id = EXCLUDED.client_group_id;

DO $$
DECLARE
  v_ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.documents (
      organization_id, name, source, file_path, mime_type, document_type, client_group_id
    ) VALUES (
      'aaaaaaaa-0000-0000-0000-0000000000aa',
      'Bad FK',
      'supabase',
      'x',
      'text/plain',
      'minuta',
      '00000000-0000-0000-0000-00000000dead'
    );
    v_ok := true;
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  IF v_ok THEN RAISE EXCEPTION 'j) FK client_group_id no rechazó uuid inexistente'; END IF;
END $$;

\echo '== k) mtg_series.slack_channel_id editable =='

INSERT INTO public.clients (id, organization_id, name, responsible_user_id) VALUES
  ('cccccccc-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000aa', 'Cliente A1', '11111111-0000-0000-0000-00000000000a')
ON CONFLICT DO NOTHING;

INSERT INTO public.mtg_series (
  id, organization_id, anchor_type, anchor_id, client_id, title, cadence, slack_channel_id, created_by
) VALUES (
  '55555555-0000-0000-0000-00000000b345',
  'aaaaaaaa-0000-0000-0000-0000000000aa',
  'client',
  'cccccccc-0000-0000-0000-0000000000a1',
  'cccccccc-0000-0000-0000-0000000000a1',
  'Serie slack',
  'adhoc',
  'C0TESTCHANNEL',
  '11111111-0000-0000-0000-00000000000a'
) ON CONFLICT (id) DO UPDATE SET slack_channel_id = EXCLUDED.slack_channel_id;

DO $$
BEGIN
  IF (SELECT slack_channel_id FROM public.mtg_series WHERE id = '55555555-0000-0000-0000-00000000b345')
     IS DISTINCT FROM 'C0TESTCHANNEL' THEN
    RAISE EXCEPTION 'k) slack_channel_id no persistió';
  END IF;
END $$;

\echo '== checks B345 OK =='
