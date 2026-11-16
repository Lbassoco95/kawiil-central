-- Trabajo programado del Investigador web a las 8:00 de Ciudad de México (14:00 UTC). NO PROGRAMADO: requiere confirmación explícita de Dirección,
-- y solo después de aplicar 20261115220000_marketing_investigador.sql, desplegar marketing-investigador y cargar al menos una fuente en mk_fuente_web.
-- Fuera de la franja de 6:30 a 7:00 (no hay despliegues). El secreto se lee del vault por nombre: este archivo no contiene ningún valor.
-- Llama con escribir=true; la vista previa se hace a mano antes (cuerpo vacío) y no escribe nada.
select cron.schedule('marketing-investigador-0800-cdmx', '0 14 * * *', $$
  select net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/marketing-investigador',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-marketing-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'MARKETING_CONNECTOR_SECRET' limit 1)),
    body := jsonb_build_object('escribir', true),
    timeout_milliseconds := 120000)
$$);

-- Revertir:  select cron.unschedule('marketing-investigador-0800-cdmx');
