-- Checks de Múuch' contra la base real, SIN persistir nada.
-- Todo corre dentro de un DO que termina en RAISE EXCEPTION con el resumen:
-- la transacción se revierte siempre, aunque los checks pasen.
-- Uso: supabase db query --linked -f tools/mtg/local-db/checks-remote-readonly.sql
DO $$
DECLARE
  v_org uuid;
  v_user uuid;
  v_client uuid;
  v_ghost uuid := '00000000-0000-0000-0000-00000000dead';
  v_series uuid;
  v_audit uuid;
  n int;
  report text := E'\n== checks remotos mtg (solo lectura) ==\n';
BEGIN
  SELECT p.organization_id, p.user_id INTO v_org, v_user
  FROM public.profiles p WHERE p.email = 'leo.bassoco@kawiil.mx' LIMIT 1;
  SELECT id INTO v_client FROM public.clients WHERE organization_id = v_org ORDER BY created_at LIMIT 1;

  -- 1) Estructura
  SELECT count(*) INTO n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'mtg\_%';
  report := report || format('tablas mtg_*: %s (esperado 11)%s', n, E'\n');
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'mtg\_%';
  report := report || format('policies mtg_*: %s (esperado 39)%s', n, E'\n');
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='storage' AND policyname LIKE 'Mtg %';
  report := report || format('policies bucket mtg: %s (esperado 5)%s', n, E'\n');
  SELECT count(*) INTO n FROM storage.buckets WHERE id='mtg' AND public=false;
  report := report || format('bucket mtg privado: %s (esperado 1)%s', n, E'\n');
  SELECT count(*) INTO n FROM pg_trigger WHERE tgname IN ('trg_mtg_audit_log_immutable','trg_mtg_series_validate_anchor');
  report := report || format('triggers clave: %s (esperado 2)%s', n, E'\n');
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_name='mtg_audit_log' AND privilege_type IN ('UPDATE','DELETE')
     AND grantee IN ('authenticated','anon','service_role');
  report := report || format('grants UPDATE/DELETE en mtg_audit_log a auth/anon/service: %s (esperado 0)%s', n, E'\n');

  -- 2) Fila de prueba (se revierte al final) como usuario real vía RLS
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.mtg_series (organization_id, anchor_type, anchor_id, client_id, title, cadence, starts_at, owner_user_id, created_by)
  VALUES (v_org, 'client', v_client, v_client, '__check_tmp__', 'weekly', now(), v_user, v_user)
  RETURNING id INTO v_series;
  SELECT public.mtg_generate_series_meetings(v_series, 8) INTO n;
  report := report || format('instancias generadas: %s (esperado 8)%s', n, E'\n');
  SELECT public.mtg_generate_series_meetings(v_series, 8) INTO n;
  report := report || format('re-corrida: %s (esperado 0)%s', n, E'\n');
  INSERT INTO public.mtg_audit_log (organization_id, actor_user_id, entity_type, entity_id, action)
  VALUES (v_org, v_user, 'series', v_series, 'CHECK_TMP') RETURNING id INTO v_audit;

  -- 3) Aislamiento: usuario sin perfil (org NULL) no ve nada ni puede insertar
  PERFORM set_config('request.jwt.claim.sub', v_ghost::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ghost, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.mtg_series;
  report := report || format('series visibles para usuario ajeno: %s (esperado 0)%s', n, E'\n');
  SELECT count(*) INTO n FROM public.mtg_meetings;
  report := report || format('juntas visibles para usuario ajeno: %s (esperado 0)%s', n, E'\n');
  BEGIN
    INSERT INTO public.mtg_series (organization_id, anchor_type, anchor_id, client_id, title, cadence)
    VALUES (v_org, 'client', v_client, v_client, '__ajeno__', 'weekly');
    report := report || E'INSERT ajeno en org: PASÓ (MAL)\n';
  EXCEPTION WHEN OTHERS THEN
    report := report || format('INSERT ajeno en org: rechazado (%s)%s', SQLSTATE, E'\n');
  END;

  -- 4) Bitácora append-only (como usuario real y como postgres)
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  BEGIN
    UPDATE public.mtg_audit_log SET action = 'X' WHERE id = v_audit;
    report := report || E'UPDATE audit (authenticated): PASÓ (MAL)\n';
  EXCEPTION WHEN OTHERS THEN
    report := report || format('UPDATE audit (authenticated): rechazado (%s)%s', SQLERRM, E'\n');
  END;
  BEGIN
    DELETE FROM public.mtg_audit_log WHERE id = v_audit;
    report := report || E'DELETE audit (authenticated): PASÓ (MAL)\n';
  EXCEPTION WHEN OTHERS THEN
    report := report || format('DELETE audit (authenticated): rechazado (%s)%s', SQLERRM, E'\n');
  END;
  RESET ROLE;
  BEGIN
    UPDATE public.mtg_audit_log SET action = 'X' WHERE id = v_audit;
    report := report || E'UPDATE audit (postgres): PASÓ (MAL)\n';
  EXCEPTION WHEN OTHERS THEN
    report := report || format('UPDATE audit (postgres): rechazado (%s)%s', SQLERRM, E'\n');
  END;
  BEGIN
    DELETE FROM public.mtg_audit_log WHERE id = v_audit;
    report := report || E'DELETE audit (postgres): PASÓ (MAL)\n';
  EXCEPTION WHEN OTHERS THEN
    report := report || format('DELETE audit (postgres): rechazado (%s)%s', SQLERRM, E'\n');
  END;

  -- 5) Trigger de ancla y CHECK de transcripción
  BEGIN
    INSERT INTO public.mtg_series (organization_id, anchor_type, anchor_id, title, cadence)
    VALUES (v_org, 'group', v_ghost, '__grupo_inexistente__', 'weekly');
    report := report || E'ancla grupo inexistente: PASÓ (MAL)\n';
  EXCEPTION WHEN OTHERS THEN
    report := report || format('ancla grupo inexistente: rechazado (%s)%s', SQLERRM, E'\n');
  END;
  BEGIN
    INSERT INTO public.mtg_series (organization_id, anchor_type, anchor_id, client_id, title, cadence, auto_transcript)
    VALUES (v_org, 'client', v_client, v_client, '__sin_aviso__', 'weekly', true);
    report := report || E'auto_transcript sin aviso: PASÓ (MAL)\n';
  EXCEPTION WHEN OTHERS THEN
    report := report || format('auto_transcript sin aviso: rechazado (%s)%s', SQLSTATE, E'\n');
  END;

  RAISE EXCEPTION USING MESSAGE = report || '== fin (transacción revertida a propósito) ==';
END $$;
