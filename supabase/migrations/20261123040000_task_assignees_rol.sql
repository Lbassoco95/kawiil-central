-- Actividades: distingue a los RESPONSABLES de un pendiente (quienes tienen acceso al
-- módulo, G4) del EQUIPO (el resto de los Kawiilers que apoyan).
-- El responsable principal sigue en tasks.assigned_to; aquí se guardan los demás.
-- Filas existentes y de otros módulos quedan como 'equipo' (colaboradores).
ALTER TABLE public.task_assignees
  ADD COLUMN IF NOT EXISTS assignment_role text NOT NULL DEFAULT 'equipo';

ALTER TABLE public.task_assignees
  DROP CONSTRAINT IF EXISTS task_assignees_assignment_role_check;
ALTER TABLE public.task_assignees
  ADD CONSTRAINT task_assignees_assignment_role_check
  CHECK (assignment_role IN ('responsable', 'equipo'));
