-- Backfill v2 (amplía 20261021120000): las tareas huérfanas no sólo venían de
-- mtg_agreements — también del diálogo "Importar minuta/resumen" y de otras
-- capturas donde assigned_to quedó NULL. Esas tareas no aparecen en ningún
-- dashboard personal.
--
-- Regla (solo tareas abiertas):
--   1) Con proyecto → responsable del proyecto (projects.responsible_user_id)
--   2) Sin proyecto o proyecto sin responsable → quien la creó (created_by)

UPDATE public.tasks t
SET assigned_to = p.responsible_user_id,
    updated_at = now()
FROM public.projects p
WHERE t.assigned_to IS NULL
  AND t.project_id = p.id
  AND p.responsible_user_id IS NOT NULL
  AND t.status NOT IN ('completada', 'cancelada');

UPDATE public.tasks
SET assigned_to = created_by,
    updated_at = now()
WHERE assigned_to IS NULL
  AND created_by IS NOT NULL
  AND status NOT IN ('completada', 'cancelada');
