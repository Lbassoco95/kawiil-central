-- Reversa de 20261105120100_marketing_analista_registro.sql.
-- 1) Vuelve a dejar solo los 3 agentes originales en las dos funciones (ver supabase/migrations/20261104165545_marketing_registrar_corrida.sql).
-- 2) Borra las tareas del Analista y su fila en el registro; 3) elimina mk_consulta (se pierde el historial de preguntas: respaldar antes si importa).
DELETE FROM public.agent_tasks WHERE agent_id IN (SELECT id FROM public.agent_registry WHERE name = 'marketing_analista' AND kind = 'system');
DELETE FROM public.agent_registry WHERE name = 'marketing_analista' AND kind = 'system';
DROP TABLE IF EXISTS public.mk_consulta;
-- Después, volver a ejecutar supabase/migrations/20261104165545_marketing_registrar_corrida.sql (CREATE OR REPLACE de las dos funciones).
