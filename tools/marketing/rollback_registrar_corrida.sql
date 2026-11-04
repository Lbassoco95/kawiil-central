-- Reversa de 20261104165545_marketing_registrar_corrida.sql: elimina las dos funciones.
-- Las tareas y contadores ya escritos quedan como historial (si se quisieran borrar: DELETE FROM agent_tasks WHERE input_context->>'origen' = 'marketing').
DROP FUNCTION IF EXISTS public.mk_registrar_corrida(text, text, text, text, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.mk_latido_agente(text);
