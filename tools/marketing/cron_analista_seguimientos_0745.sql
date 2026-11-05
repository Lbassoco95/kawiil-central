-- PREPARADO, NO PROGRAMADO. Trabajo diario de los seguimientos del Analista a las 7:45 de Ciudad de México (13:45 UTC), después del Vigía de las 7:30.
-- Invoca marketing-seguimientos (función aún por escribir y desplegar). El secreto se lee de Vault por nombre exacto en cada ejecución:
-- el texto guardado en cron.job contiene solo la subconsulta, nunca el valor.
select cron.schedule(
  'marketing-analista-seguimientos-0745-cdmx', '45 13 * * *',
  $$ select net.http_post(
       url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/marketing-seguimientos',
       headers := jsonb_build_object('Content-Type','application/json',
         'x-marketing-secret',(select decrypted_secret from vault.decrypted_secrets where name='MARKETING_CONNECTOR_SECRET')),
       body := '{}'::jsonb, timeout_milliseconds := 120000) $$);

-- Revertir:  select cron.unschedule('marketing-analista-seguimientos-0745-cdmx');
