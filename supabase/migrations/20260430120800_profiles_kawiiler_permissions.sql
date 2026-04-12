-- Permisos de tareas por Kawiiler (perfil), en lugar de solo a nivel organización.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS kawiiler_permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.kawiiler_permissions IS
  'JSON: can_delete_tasks, can_edit_task_due_dates (boolean). Referente: true explícito habilita. Transformador: false explícito deshabilita.';

-- Copiar ajustes org → referentes existentes.
UPDATE public.profiles p
SET kawiiler_permissions = jsonb_build_object(
  'can_delete_tasks', COALESCE((o.settings->>'referente_delete_tasks')::boolean, false),
  'can_edit_task_due_dates', COALESCE((o.settings->>'referente_edit_due_dates')::boolean, false)
)
FROM public.organizations o, public.user_roles ur
WHERE p.organization_id = o.id
  AND ur.user_id = p.user_id
  AND ur.role = 'referente';

-- Transformadores: por defecto todo permitido si aún no tienen claves definidas.
UPDATE public.profiles p
SET kawiiler_permissions = jsonb_build_object(
  'can_delete_tasks', true,
  'can_edit_task_due_dates', true
)
FROM public.user_roles ur
WHERE ur.user_id = p.user_id
  AND ur.role = 'transformador'
  AND (p.kawiiler_permissions IS NULL OR p.kawiiler_permissions = '{}'::jsonb);
