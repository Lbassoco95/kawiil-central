-- Migración: actualizar modelo claude-sonnet-4-20250514 (deprecado)
-- a claude-sonnet-4-6 en agent_registry.
-- El modelo anterior fue retirado por Anthropic; la nueva clave de API
-- no tiene acceso a él. Se actualiza a Claude Sonnet 4.6 (actual).

UPDATE public.agent_registry
SET model = 'claude-sonnet-4-6'
WHERE model = 'claude-sonnet-4-20250514';
