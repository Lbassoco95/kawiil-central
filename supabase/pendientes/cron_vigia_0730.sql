-- Trabajo programado del vigía a las 7:30 de Ciudad de México (13:30 UTC). NO SE EJECUTA sin confirmación.
-- Requiere antes la migración 20261102130000_marketing_vigia_colchon.sql (función mk_vigia_colchon).
-- No usa secretos: es SQL puro dentro de la base.
select cron.schedule('marketing-colchon-vigia-0730-cdmx', '30 13 * * *', $$ select public.mk_vigia_colchon() $$);

-- Revertir:  select cron.unschedule('marketing-colchon-vigia-0730-cdmx');
