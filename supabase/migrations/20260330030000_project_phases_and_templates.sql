-- Project phases and enhanced templates

-- 1. Phases JSONB on projects (array of {key, name, order, color?})
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS phases jsonb DEFAULT '[]';

-- 2. Service tags for dynamic categorization
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS service_tags text[] DEFAULT '{}';

-- 3. Phase key on tasks to link task to a project phase
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS phase_key text;
CREATE INDEX IF NOT EXISTS idx_tasks_phase_key ON public.tasks(phase_key) WHERE phase_key IS NOT NULL;

-- 4. Enrich project_templates
ALTER TABLE public.project_templates ADD COLUMN IF NOT EXISTS client_type text;
ALTER TABLE public.project_templates ADD COLUMN IF NOT EXISTS service_tags text[] DEFAULT '{}';
ALTER TABLE public.project_templates ADD COLUMN IF NOT EXISTS avg_duration_days integer;
ALTER TABLE public.project_templates ADD COLUMN IF NOT EXISTS usage_count integer DEFAULT 0;
