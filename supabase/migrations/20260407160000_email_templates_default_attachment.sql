-- Adjunto por defecto embebido en Edge Functions (send-pipeline-email, process-email-queue)
ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS default_attachment_key text NULL;

COMMENT ON COLUMN public.email_templates.default_attachment_key IS
  'Clave de adjunto incluido al enviar esta plantilla (p. ej. softlanding_hub_mexico).';

ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_default_attachment_key_check;
ALTER TABLE public.email_templates
  ADD CONSTRAINT email_templates_default_attachment_key_check
  CHECK (default_attachment_key IS NULL OR default_attachment_key = 'softlanding_hub_mexico');
