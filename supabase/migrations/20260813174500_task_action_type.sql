-- Tipo de acción de una tarea (qué hacer con ella), útil sobre todo para tareas creadas desde correo:
--   propia      → la ejecuta Kawiil (comportamiento actual, default)
--   seguimiento → un tercero la hará; nosotros solo monitoreamos y actualizamos (usa follow_up_date)
--   derivar     → la acción es reenviar/derivar el correo a alguien (usa derived_to)
--   registro    → solo registrar/anotar en una lista interna
alter table public.tasks
  add column if not exists action_type text not null default 'propia',
  add column if not exists follow_up_date date,
  add column if not exists derived_to text;

-- Índice para filtrar rápido las tareas de seguimiento (vista/filtro "Seguimiento").
create index if not exists idx_tasks_action_type on public.tasks (action_type);
