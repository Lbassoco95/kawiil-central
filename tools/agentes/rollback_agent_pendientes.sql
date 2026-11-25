-- Reversa de supabase/pendientes/agent_pendientes.sql (solo si se llegó a aplicar). Borra los pendientes registrados.
drop table if exists public.agent_pendientes_historial;
drop table if exists public.agent_pendientes;
drop function if exists public.agent_pendientes_registrar();
drop function if exists public.agent_pendientes_proteger();
