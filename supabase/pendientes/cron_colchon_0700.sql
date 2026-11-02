-- Trabajo programado de las 7:00 de Ciudad de México (13:00 UTC; México no tiene horario de verano). NO SE EJECUTA sin confirmación.
-- Invoca marketing-colchon con cuerpo vacío (fecha real). El secreto se lee de Vault en cada ejecución, por nombre exacto;
-- el texto guardado en cron.job contiene solo la subconsulta, nunca el valor.
select cron.schedule(
  'marketing-colchon-diario-0700-cdmx', '0 13 * * *',
  $$ select net.http_post(
       url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/marketing-colchon',
       headers := jsonb_build_object('Content-Type','application/json',
         'x-marketing-secret',(select decrypted_secret from vault.decrypted_secrets where name='MARKETING_CONNECTOR_SECRET')),
       body := '{}'::jsonb, timeout_milliseconds := 60000) $$);

-- Revertir:  select cron.unschedule('marketing-colchon-diario-0700-cdmx');
