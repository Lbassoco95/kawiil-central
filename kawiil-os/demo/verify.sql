-- Verificación canónica tras seed/reset del demo espejo (Corte 4).
-- Falla si los conteos no coinciden con la semilla fija.

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
  IF n <> 4 THEN RAISE EXCEPTION 'verify: se esperaban 4 CFDI demo, hay %', n; END IF;

  SELECT count(*) INTO n FROM public.portal_cfdi WHERE client_id = v_company AND detail_status = 'metadata';
  IF n <> 1 THEN RAISE EXCEPTION 'verify: se esperaba 1 CFDI solo metadatos'; END IF;

  SELECT count(*) INTO n FROM public.portal_fiscal_summaries WHERE client_id = v_company AND period_year = 2026 AND period_month = 9;
  IF n <> 1 THEN RAISE EXCEPTION 'verify: falta resumen IVA sep-2026'; END IF;

  SELECT count(*) INTO n FROM public.portal_documents WHERE client_id = v_company AND doc_type IN ('constancia','opinion_cumplimiento','declaracion');
  IF n <> 3 THEN RAISE EXCEPTION 'verify: se esperaban 3 documentos SAT/declaración'; END IF;

  SELECT count(*) INTO n FROM public.portal_fiscal_alerts WHERE client_id = v_company AND alert_type IN ('efos','cancelacion');
  IF n <> 2 THEN RAISE EXCEPTION 'verify: se esperaban alertas EFOS y cancelación'; END IF;

  SELECT count(*) INTO n FROM public.portal_sat_notifications WHERE client_id = v_company;
  IF n <> 1 THEN RAISE EXCEPTION 'verify: falta notificación SAT demo'; END IF;

  SELECT count(*) INTO n FROM public.portal_companies WHERE id = v_company AND rh_enabled IS TRUE;
  IF n <> 0 THEN RAISE EXCEPTION 'verify: RH no debe estar activo en el demo espejo'; END IF;

  RAISE NOTICE 'verify OK: dataset demo espejo canónico';
END $$;
