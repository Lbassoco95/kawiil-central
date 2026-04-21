-- Migration B — Bloque B1.6: rename Sofia → Coyolli + archivar placeholders
-- Propósito:
--   1. Verificación defensiva: abortar si hay agent_tasks activos en placeholders.
--   2. Renombrar el agente Sofia (id dc26319a-a390-41ce-88a6-84fe2895e51a)
--      a Coyolli, alineado con el perfil del documento v0.1.
--   3. Archivar los 5 agentes placeholder creados en testing inicial.
--
-- Los UUIDs se preservan: agent_tasks históricos siguen siendo válidos.
--
-- Parte del Bloque B1.6 del plan v6.

-- ============================================================================
-- 1. Verificación defensiva: no archivar si hay tareas activas
-- ============================================================================

DO $$
DECLARE
  active_tasks_count integer;
BEGIN
  SELECT COUNT(*) INTO active_tasks_count
  FROM public.agent_tasks at
  JOIN public.agent_registry ar ON ar.id = at.agent_id
  WHERE ar.name IN (
    'content_creator', 'researcher', 'task_coordinator',
    'email_agent', 'code_reviewer'
  )
  AND at.status NOT IN ('completed', 'failed', 'cancelled');

  IF active_tasks_count > 0 THEN
    RAISE EXCEPTION
      'ABORTANDO migración B: % tarea(s) activa(s) apuntan a placeholders que se iban a archivar. Completar/cancelar las tareas antes de aplicar esta migración.',
      active_tasks_count;
  END IF;

  RAISE NOTICE 'Verificación OK: 0 tareas activas en placeholders, procedemos.';
END $$;

-- ============================================================================
-- 2. Rename Sofia → Coyolli
-- ============================================================================

-- Sofia (doc_reviewer) es el único placeholder con historial real.
-- Actualizamos name, role, display_name y description.
-- El UUID se preserva → agent_tasks históricos siguen siendo válidos.

UPDATE public.agent_registry
SET
  name = 'coyolli',
  role = 'coyolli',
  display_name = 'Coyolli',
  description = 'Especialista en documentos estructurados (contratos, actas, escrituras, políticas). Revisa, organiza y extrae información clave de documentos legales y contables. Responde con precisión técnica y tono profesional.',
  updated_at = now()
WHERE id = 'dc26319a-a390-41ce-88a6-84fe2895e51a'
  AND name = 'doc_reviewer';  -- doble guard contra re-ejecución accidental

-- Reportar cuántas filas se actualizaron (idealmente 1)
DO $$
DECLARE
  updated_count integer;
BEGIN
  SELECT COUNT(*) INTO updated_count
  FROM public.agent_registry
  WHERE id = 'dc26319a-a390-41ce-88a6-84fe2895e51a'
    AND name = 'coyolli';

  IF updated_count = 1 THEN
    RAISE NOTICE 'Sofia renombrada exitosamente a Coyolli (o ya estaba renombrada — idempotente).';
  ELSE
    RAISE WARNING 'Post-rename: no se encontró Coyolli en el id esperado (filas=%).', updated_count;
  END IF;
END $$;

-- ============================================================================
-- 3. Archivar los 5 placeholders (Sofia queda fuera porque ya es 'coyolli')
-- ============================================================================

UPDATE public.agent_registry
SET
  status = 'archived',
  updated_at = now()
WHERE name IN (
  'content_creator',   -- Carlos
  'researcher',        -- Diego
  'task_coordinator',  -- Luna
  'email_agent',       -- Alex
  'code_reviewer'      -- Maya
)
AND status != 'archived';  -- idempotencia

DO $$
DECLARE
  still_active_placeholders integer;
BEGIN
  SELECT COUNT(*) INTO still_active_placeholders
  FROM public.agent_registry
  WHERE name IN (
    'content_creator', 'researcher', 'task_coordinator',
    'email_agent', 'code_reviewer'
  )
  AND status != 'archived';

  IF still_active_placeholders = 0 THEN
    RAISE NOTICE 'Los 5 placeholders quedaron archivados correctamente.';
  ELSE
    RAISE WARNING 'Post-archivo: % placeholder(s) aún no archivado(s).', still_active_placeholders;
  END IF;
END $$;

-- ============================================================================
-- 4. Verificación final (como NOTICEs para feedback)
-- ============================================================================

DO $$
DECLARE
  total_consultable_active integer;
  total_archived integer;
  coyolli_exists boolean;
BEGIN
  SELECT COUNT(*) INTO total_consultable_active
  FROM public.agent_registry
  WHERE kind = 'consultable' AND status = 'idle';

  SELECT COUNT(*) INTO total_archived
  FROM public.agent_registry
  WHERE status = 'archived';

  SELECT EXISTS(SELECT 1 FROM public.agent_registry WHERE name = 'coyolli')
  INTO coyolli_exists;

  RAISE NOTICE '=== Post-migración B ===';
  RAISE NOTICE 'Templates consultables activos: % (esperado: 1 = solo Coyolli)', total_consultable_active;
  RAISE NOTICE 'Templates archivados: % (esperado: 5)', total_archived;
  RAISE NOTICE 'Coyolli existe: %', coyolli_exists;
END $$;
