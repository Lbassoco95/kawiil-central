-- Backfill: tareas creadas desde acuerdos de junta (mtg_meeting_id) quedaban
-- con assigned_to NULL cuando el responsable era un tercero (no usuario Kawiil)
-- o no se capturó responsable. Esas tareas no aparecían en ningún dashboard
-- personal ("sin responsable" del equipo solamente).
--
-- Regla: se reasignan al responsable del proyecto (projects.responsible_user_id).
-- Las tareas sin proyecto responsable se dejan intactas (no hay a quién asignar).

UPDATE public.tasks t
SET assigned_to = p.responsible_user_id,
    updated_at = now()
FROM public.projects p
WHERE t.mtg_meeting_id IS NOT NULL
  AND t.assigned_to IS NULL
  AND t.project_id = p.id
  AND p.responsible_user_id IS NOT NULL;
