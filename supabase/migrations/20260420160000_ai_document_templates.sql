-- =============================================================
-- AI Artifacts: multi-format documents with Kawiil templates
--
-- Agrega soporte nativo para PDF como formato primario + salidas
-- adicionales (docx/xlsx/pptx) por artifact. Introduce un registry
-- de templates Kawiil que Claude elige según intención del usuario.
-- =============================================================

ALTER TABLE public.ai_artifacts
  ADD COLUMN IF NOT EXISTS template_key text,
  ADD COLUMN IF NOT EXISTS template_data jsonb,
  ADD COLUMN IF NOT EXISTS output_formats jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS primary_format text;

-- Ampliar check de content_type para aceptar 'pdf'.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ai_artifacts_content_type_check'
      AND table_schema = 'public'
      AND table_name = 'ai_artifacts'
  ) THEN
    ALTER TABLE public.ai_artifacts DROP CONSTRAINT ai_artifacts_content_type_check;
  END IF;
END $$;

ALTER TABLE public.ai_artifacts
  ADD CONSTRAINT ai_artifacts_content_type_check
  CHECK (content_type IN ('markdown', 'code', 'html', 'csv', 'office', 'pdf'));

-- template_key con lista cerrada (null para artifacts viejos / markdown).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ai_artifacts_template_key_check'
      AND table_schema = 'public'
      AND table_name = 'ai_artifacts'
  ) THEN
    ALTER TABLE public.ai_artifacts DROP CONSTRAINT ai_artifacts_template_key_check;
  END IF;
END $$;

ALTER TABLE public.ai_artifacts
  ADD CONSTRAINT ai_artifacts_template_key_check
  CHECK (
    template_key IS NULL OR template_key IN (
      'informe_ejecutivo',
      'minuta_reunion',
      'propuesta_cotizacion',
      'factura_remision',
      'reporte_financiero',
      'generico'
    )
  );

-- primary_format sirve para deep-links y preview (pdf, docx, xlsx, pptx).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ai_artifacts_primary_format_check'
      AND table_schema = 'public'
      AND table_name = 'ai_artifacts'
  ) THEN
    ALTER TABLE public.ai_artifacts DROP CONSTRAINT ai_artifacts_primary_format_check;
  END IF;
END $$;

ALTER TABLE public.ai_artifacts
  ADD CONSTRAINT ai_artifacts_primary_format_check
  CHECK (primary_format IS NULL OR primary_format IN ('pdf', 'docx', 'xlsx', 'pptx'));

-- Índice para navegación rápida de artifacts por template en el panel de IA.
CREATE INDEX IF NOT EXISTS idx_ai_artifacts_template
  ON public.ai_artifacts (user_id, template_key)
  WHERE template_key IS NOT NULL;
