-- Migration A — Bloque B1.6: schema para agentes multi-tenancy por cliente
-- Propósito:
--   1. Extender agent_registry con columna kind ('system' | 'consultable').
--   2. Extender CHECK de agent_registry.status para incluir 'archived'.
--   3. Crear tabla client_agents (instancias de templates por cliente).
--   4. RLS + índices en client_agents.
--   5. Trigger auto-instantiate cuando se crea cliente nuevo.
--
-- Contrato:
--   - agent_registry = catálogo de plantillas (ej. Coyolli, Amatl, Balam).
--   - client_agents = instancias por cliente (ej. Coyolli-Empathy, Amatl-Moffin).
--   - agent_tasks.agent_id apunta al template (compatibilidad histórica);
--     client_id da el contexto del cliente.
--
-- Parte del Bloque B1.6 del plan v6.

-- ============================================================================
-- 1. Extender agent_registry con columna kind
-- ============================================================================

ALTER TABLE public.agent_registry
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'consultable';

-- CHECK de kind
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_registry_kind_check'
      AND conrelid = 'public.agent_registry'::regclass
  ) THEN
    ALTER TABLE public.agent_registry
      ADD CONSTRAINT agent_registry_kind_check
      CHECK (kind IN ('system', 'consultable'));
  END IF;
END $$;

COMMENT ON COLUMN public.agent_registry.kind IS
  'Categoría del agente: consultable (invocado por usuarios desde el chat) o system (orquestador interno como Nahui/Tlacuilo/Amoxtli/Huehuetl). Default: consultable.';

-- ============================================================================
-- 2. Expandir agent_registry.status para incluir 'archived'
-- ============================================================================

-- Drop el CHECK antiguo y crear uno nuevo con 'archived' agregado.
ALTER TABLE public.agent_registry 
  DROP CONSTRAINT IF EXISTS agent_registry_status_check;

ALTER TABLE public.agent_registry
  ADD CONSTRAINT agent_registry_status_check
  CHECK (status IN ('idle', 'working', 'resting', 'error', 'offline', 'archived'));

COMMENT ON COLUMN public.agent_registry.status IS
  'Estado operativo del agente. idle = listo. working = ejecutando tarea. resting = pausado temporalmente. error = en error. offline = desconectado. archived = deprecado, no utilizable para nuevas tareas.';

-- ============================================================================
-- 3. Crear tabla client_agents
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.agent_registry(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  memory jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_used_at timestamptz,
  tasks_completed integer NOT NULL DEFAULT 0,
  tasks_failed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, client_id)
);

-- CHECK de status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_agents_status_check'
      AND conrelid = 'public.client_agents'::regclass
  ) THEN
    ALTER TABLE public.client_agents
      ADD CONSTRAINT client_agents_status_check
      CHECK (status IN ('active', 'paused', 'archived'));
  END IF;
END $$;

-- Índices
CREATE INDEX IF NOT EXISTS idx_client_agents_client_id
  ON public.client_agents(client_id);

CREATE INDEX IF NOT EXISTS idx_client_agents_template_id
  ON public.client_agents(template_id);

CREATE INDEX IF NOT EXISTS idx_client_agents_organization_id
  ON public.client_agents(organization_id);

CREATE INDEX IF NOT EXISTS idx_client_agents_status_active
  ON public.client_agents(client_id, template_id)
  WHERE status = 'active';

-- Comentarios
COMMENT ON TABLE public.client_agents IS
  'Instancias de agentes consultables por cliente. Cada cliente tiene N instancias (una por cada template consultable activo). Cada instancia mantiene memoria específica del cliente + métricas de uso. Parte del modelo multi-tenancy de agentes (Bloque B1.6).';

COMMENT ON COLUMN public.client_agents.template_id IS
  'FK al template en agent_registry (ej. Coyolli, Amatl). Solo templates con kind=consultable deberían instanciarse.';

COMMENT ON COLUMN public.client_agents.memory IS
  'Memoria específica del agente para ESTE cliente. Aislada entre clientes (contrario al conocimiento general que vive en knowledge_insights y se comparte según contractual-transparency).';

COMMENT ON COLUMN public.client_agents.metadata IS
  'Configuración custom o datos operativos de la instancia (ej. preferencias del cliente, overrides del system prompt, etc.).';

-- ============================================================================
-- 4. RLS en client_agents
-- ============================================================================

ALTER TABLE public.client_agents ENABLE ROW LEVEL SECURITY;

-- Política SELECT: usuarios ven instancias de su org (a través de profiles)
DROP POLICY IF EXISTS "Users can view client_agents of their org" ON public.client_agents;
CREATE POLICY "Users can view client_agents of their org"
  ON public.client_agents
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.profiles
      WHERE user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: bloqueados para authenticated (solo service_role 
-- y el trigger de auto-creación operan aquí).

-- ============================================================================
-- 5. Trigger para auto-instanciar agentes cuando se crea cliente nuevo
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_instantiate_client_agents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Al crear un cliente nuevo, instanciar automáticamente todos los 
  -- templates consultables activos para este cliente.
  -- ON CONFLICT DO NOTHING protege de duplicados si alguien re-ejecuta.
  INSERT INTO public.client_agents (template_id, client_id, organization_id)
  SELECT ar.id, NEW.id, NEW.organization_id
  FROM public.agent_registry ar
  WHERE ar.kind = 'consultable'
    AND ar.status = 'idle'  -- solo templates operativos
  ON CONFLICT (template_id, client_id) DO NOTHING;
  
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_instantiate_client_agents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_instantiate_client_agents() TO postgres, service_role;

COMMENT ON FUNCTION public.auto_instantiate_client_agents() IS
  'Dispara al INSERT en public.clients: crea automáticamente una fila en client_agents por cada template consultable activo. ON CONFLICT DO NOTHING para idempotencia.';

DROP TRIGGER IF EXISTS on_client_created_instantiate_agents ON public.clients;

CREATE TRIGGER on_client_created_instantiate_agents
  AFTER INSERT ON public.clients
  FOR EACH ROW 
  EXECUTE FUNCTION public.auto_instantiate_client_agents();

COMMENT ON TRIGGER on_client_created_instantiate_agents ON public.clients IS
  'Auto-instanciación de agentes al crear cliente (Bloque B1.6). Crea 1 fila en client_agents por cada template consultable activo.';

-- ============================================================================
-- 6. Trigger de updated_at en client_agents (si existe función genérica)
-- ============================================================================

-- Si el proyecto tiene update_updated_at_column() como función genérica,
-- la usamos. Si no, esta sección se omite en silencio.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS update_client_agents_updated_at ON public.client_agents';
    EXECUTE 'CREATE TRIGGER update_client_agents_updated_at
             BEFORE UPDATE ON public.client_agents
             FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
END $$;
