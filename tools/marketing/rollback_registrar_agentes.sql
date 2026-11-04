-- Reversa de 20261104015632_marketing_registrar_agentes.sql: borra solo las 3 filas de Marketing (kind = 'system').
DELETE FROM public.agent_registry
WHERE organization_id = '00000000-0000-0000-0000-000000000001' AND kind = 'system'
  AND name IN ('marketing_vigilante','marketing_informe_diario','marketing_vigia')
  AND NOT EXISTS (SELECT 1 FROM public.agent_tasks t WHERE t.agent_id = agent_registry.id);
