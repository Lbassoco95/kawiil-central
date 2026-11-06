-- Reversa de 20261106003827_marketing_analista_seguimientos.sql. Borra los seguimientos guardados (las respuestas pasadas en mk_consulta se conservan).
DROP FUNCTION IF EXISTS public.mk_seguimiento_reclamar(integer);
DROP FUNCTION IF EXISTS public.mk_seguimiento_cambiar(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.mk_seguimiento_crear(uuid, uuid, text, text, timestamptz);
DROP INDEX IF EXISTS public.mk_consulta_seguimiento;
ALTER TABLE public.mk_consulta DROP COLUMN IF EXISTS seguimiento_id;
DROP TABLE IF EXISTS public.mk_seguimiento;
-- Si ya se programó el trabajo diario:  select cron.unschedule('marketing-analista-seguimientos-0745-cdmx');
