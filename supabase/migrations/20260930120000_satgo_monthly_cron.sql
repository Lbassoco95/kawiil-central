-- Point monthly CSF/32D cron at satgo-monthly (SATgo) instead of moffin-monthly-sat.
-- Keeps the same schedule (days 1-5) and CRON_SECRET header pattern.

DO $$
DECLARE
  cron_secret text;
  supabase_url text;
  anon_key text;
BEGIN
  -- Prefer existing vault/cron secret if present; otherwise leave job update to ops.
  BEGIN
    SELECT decrypted_secret INTO cron_secret
    FROM vault.decrypted_secrets
    WHERE name = 'cron_secret'
    LIMIT 1;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    cron_secret := NULL;
  END;

  BEGIN
    SELECT decrypted_secret INTO supabase_url
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_url'
    LIMIT 1;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    supabase_url := NULL;
  END;

  BEGIN
    SELECT decrypted_secret INTO anon_key
    FROM vault.decrypted_secrets
    WHERE name = 'anon_key'
    LIMIT 1;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    anon_key := NULL;
  END;

  IF cron_secret IS NULL OR supabase_url IS NULL OR anon_key IS NULL THEN
    RAISE NOTICE 'satgo_monthly_cron: vault secrets incompletos; no se actualizó el job. Despliega satgo-monthly y actualiza el cron manualmente.';
    RETURN;
  END IF;

  -- Unschedule old job name if exists (from moffin_monthly_sat_cron migration).
  BEGIN
    PERFORM cron.unschedule('moffin-monthly-sat');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    PERFORM cron.unschedule('moffin_monthly_sat');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'satgo-monthly-sat',
    '0 14 1-5 * *',
    format(
      $cmd$
      SELECT net.http_post(
        url := %L || '/functions/v1/satgo-monthly',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || %L,
          'x-cron-secret', %L
        ),
        body := '{}'::jsonb
      );
      $cmd$,
      rtrim(supabase_url, '/'),
      anon_key,
      cron_secret
    )
  );
END $$;
