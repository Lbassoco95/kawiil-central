-- Verificación canónica tras seed/reset del demo espejo (Corte 4).
-- Prod Bassoco: cero CFDI is_test (inventados). Didácticos solo via seed-didactic.sql.

DO $$
DECLARE
  v_company uuid := 'd0000000-0000-4000-8000-000000000001';
  n int;
BEGIN
  SELECT count(*) INTO n FROM public.portal_companies WHERE id = v_company AND external_ref = 'demo-espejo-fiscal';
  IF n <> 1 THEN RAISE EXCEPTION 'verify: empresa demo ausente'; END IF;

  SELECT count(*) INTO n FROM public.portal_client_settings WHERE client_id = v_company AND demo_mode IS TRUE AND emission_enabled IS FALSE;
  IF n <> 1 THEN RAISE EXCEPTION 'verify: demo_mode/emission incorrectos'; END IF;

  SELECT count(*) INTO n FROM public.portal_cfdi WHERE client_id = v_company AND is_test IS TRUE;
  IF n <> 0 THEN RAISE EXCEPTION 'verify: se esperaban 0 CFDI is_test (inventados), hay %', n; END IF;

  SELECT count(*) INTO n FROM public.portal_documents WHERE client_id = v_company AND doc_type IN ('constancia','opinion_cumplimiento','declaracion');
  IF n <> 3 THEN RAISE EXCEPTION 'verify: se esperaban 3 documentos SAT/declaración'; END IF;

  SELECT count(*) INTO n FROM public.portal_fiscal_alerts WHERE client_id = v_company AND alert_type IN ('efos','cancelacion');
  IF n <> 2 THEN RAISE EXCEPTION 'verify: se esperaban alertas EFOS y cancelación'; END IF;

  SELECT count(*) INTO n FROM public.portal_sat_notifications WHERE client_id = v_company;
  IF n <> 1 THEN RAISE EXCEPTION 'verify: falta notificación SAT demo'; END IF;

  SELECT count(*) INTO n FROM public.portal_companies WHERE id = v_company AND rh_enabled IS TRUE;
  IF n <> 0 THEN RAISE EXCEPTION 'verify: RH no debe estar activo en el demo espejo'; END IF;

  RAISE NOTICE 'verify OK: demo espejo sin CFDI inventados (Bassoco = solo SatGo publicados)';
END $$;
