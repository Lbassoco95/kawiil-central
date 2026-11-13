-- YA PROGRAMADO en producción el 5 nov 2026 (19:10 CDMX, jobid 39, confirmado por Dirección); este archivo es solo el registro. Trabajo diario de los seguimientos del Analista a las 7:45 de Ciudad de México (13:45 UTC), después del Vigía de las 7:30.
-- Invoca marketing-seguimientos (desplegada en la v1). El secreto se lee de Vault por nombre exacto en cada ejecución:
-- el texto guardado en cron.job contiene solo la subconsulta, nunca el valor.
select cron.schedule(
  'marketing-analista-seguimientos-0745-cdmx', '45 13 * * *',
  $$ select net.http_post(
       url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/marketing-seguimientos',
       headers := jsonb_build_object('Content-Type','application/json',
         'x-marketing-secret',(select decrypted_secret from vault.decrypted_secrets where name='MARKETING_CONNECTOR_SECRET')),
       body := '{}'::jsonb, timeout_milliseconds := 120000) $$);

-- Revertir:  select cron.unschedule('marketing-analista-seguimientos-0745-cdmx');
