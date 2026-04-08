-- Destinatarios adicionales en un mismo envío (máx. 4 en total: principal + extras en app)
ALTER TABLE public.email_log
  ADD COLUMN IF NOT EXISTS additional_to_emails text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.email_log.additional_to_emails IS
  'Correos en copia directa (To) además de to_email; mismo mensaje para todos.';
