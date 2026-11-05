-- Pendientes de una actividad organizados por rubro y proveedor.
--   · Un pendiente (tarea) puede pertenecer a un rubro (casas, alimentos, carpas…)
--     y, opcionalmente, a un proveedor concreto de la pestaña Proveedores.
--   · Los rubros dejan de ser una lista cerrada: se pueden crear nuevos (carpas, etc.).

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS activity_category text,
  ADD COLUMN IF NOT EXISTS activity_provider_id uuid
    REFERENCES public.activity_providers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_activity_provider
  ON public.tasks (activity_provider_id) WHERE activity_provider_id IS NOT NULL;

ALTER TABLE public.activity_providers
  DROP CONSTRAINT IF EXISTS activity_providers_category_check;
