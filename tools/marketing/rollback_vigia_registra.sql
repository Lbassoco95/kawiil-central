-- Reversa de 20261104120100_marketing_vigia_registra.sql: borra el auxiliar y vuelve a aplicar la versión anterior del vigía
-- (contenido de supabase/migrations/20261102033958_marketing_vigia_colchon.sql, que es CREATE OR REPLACE).
DROP FUNCTION IF EXISTS public.mk_vigia_registra_falla(uuid, date, text, integer);
-- Después, ejecutar el archivo supabase/migrations/20261102033958_marketing_vigia_colchon.sql.
