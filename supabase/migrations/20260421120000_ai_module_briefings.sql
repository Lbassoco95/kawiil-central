-- Cache de briefings IA por (usuario, módulo, fecha).
-- Reemplaza el cache en localStorage que hoy tienen DailyBriefing y ProjectsBriefingCard.
-- Invalidación por payload_hash: si cambian las tareas/proyectos subyacentes, se regenera.

CREATE TABLE IF NOT EXISTS public.ai_module_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  module text NOT NULL CHECK (module IN ('dashboard', 'tareas', 'proyectos', 'clientes', 'finanzas')),
  briefing_date date NOT NULL,
  content text NOT NULL,
  payload_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, module, briefing_date)
);

CREATE INDEX IF NOT EXISTS idx_ai_module_briefings_org_module_date
  ON public.ai_module_briefings (organization_id, module, briefing_date DESC);

CREATE INDEX IF NOT EXISTS idx_ai_module_briefings_user_module_date
  ON public.ai_module_briefings (user_id, module, briefing_date DESC);

-- Trigger updated_at (reutiliza función existente en el proyecto)
DROP TRIGGER IF EXISTS trg_ai_module_briefings_updated_at ON public.ai_module_briefings;
CREATE TRIGGER trg_ai_module_briefings_updated_at
  BEFORE UPDATE ON public.ai_module_briefings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.ai_module_briefings ENABLE ROW LEVEL SECURITY;

-- Dueño del briefing: SELECT/INSERT/UPDATE/DELETE sobre sus propias filas
DROP POLICY IF EXISTS "ai_module_briefings_owner_all" ON public.ai_module_briefings;
CREATE POLICY "ai_module_briefings_owner_all"
  ON public.ai_module_briefings
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- service_role full access (edge functions con adminClient)
DROP POLICY IF EXISTS "ai_module_briefings_service_role_all" ON public.ai_module_briefings;
CREATE POLICY "ai_module_briefings_service_role_all"
  ON public.ai_module_briefings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.ai_module_briefings IS
  'Cache de briefings IA generados por módulo (dashboard/tareas/proyectos/clientes/finanzas). Uno por (user_id, module, briefing_date). Invalidación por payload_hash.';
COMMENT ON COLUMN public.ai_module_briefings.payload_hash IS
  'Hash SHA-256 (hex) del payload usado para generar el briefing. Si cambia → regenerar.';
COMMENT ON COLUMN public.ai_module_briefings.metadata IS
  'Datos arbitrarios: modelo, tokens, versión del prompt, etc.';
