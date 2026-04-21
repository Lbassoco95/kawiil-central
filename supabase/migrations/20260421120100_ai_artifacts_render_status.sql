-- =============================================================
-- AI Artifacts: render_status para pipeline multi-formato.
--
-- Cuando el auto-upgrade de `create_artifact` a Kawiil (PDF+DOCX) falla,
-- el artefacto se guarda como markdown plano para no perder el contenido
-- del chat. El cliente (y un reconciliador async) necesitan distinguir
-- ese estado "a reintentar" del estado final:
--
--   - 'ready'    → artefacto completo (puede tener outputs o ser solo MD).
--   - 'pending'  → render inicial falló y hay un reintento en curso.
--   - 'failed'   → reintentos agotados; el usuario puede disparar uno manual.
-- =============================================================

ALTER TABLE public.ai_artifacts
  ADD COLUMN IF NOT EXISTS render_status text NOT NULL DEFAULT 'ready';

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ai_artifacts_render_status_check'
      AND table_schema = 'public'
      AND table_name = 'ai_artifacts'
  ) THEN
    ALTER TABLE public.ai_artifacts DROP CONSTRAINT ai_artifacts_render_status_check;
  END IF;
END $$;

ALTER TABLE public.ai_artifacts
  ADD CONSTRAINT ai_artifacts_render_status_check
  CHECK (render_status IN ('ready', 'pending', 'failed'));

-- `render_error` permite mostrar el detalle en el visor cuando `failed`.
ALTER TABLE public.ai_artifacts
  ADD COLUMN IF NOT EXISTS render_error text;

-- Índice parcial para que el reconciliador encuentre rápido los pendientes.
CREATE INDEX IF NOT EXISTS idx_ai_artifacts_pending_render
  ON public.ai_artifacts (created_at DESC)
  WHERE render_status = 'pending';
