-- Búsqueda mensual de fuentes del Investigador web: el día 1 de cada mes a las 8:30 de Ciudad de México (14:30 UTC). NO PROGRAMADO: requiere confirmación explícita de Dirección,
-- y solo después de aplicar 20261116164704_marketing_investigador.sql y de desplegar marketing-investigador (v2, con modo «descubrir»).
-- Usa el modelo con búsqueda web (gasta tokens); lo que encuentra queda como PROPUESTA inactiva hasta que una persona la apruebe. El secreto se lee del vault por nombre.
-- Antes de programarlo se hace una corrida a mano en vista previa (cuerpo {"modo":"descubrir"}), que no guarda nada.
select cron.schedule('marketing-investigador-descubrir-mensual-0830-cdmx', '30 14 1 * *', $$
  select net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/marketing-investigador',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-marketing-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'MARKETING_CONNECTOR_SECRET' limit 1)),
    body := jsonb_build_object('modo', 'descubrir', 'escribir', true),
    timeout_milliseconds := 150000)
$$);

-- Revertir:  select cron.unschedule('marketing-investigador-descubrir-mensual-0830-cdmx');
