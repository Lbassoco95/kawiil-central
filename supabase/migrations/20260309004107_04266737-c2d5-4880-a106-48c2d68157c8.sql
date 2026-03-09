-- Add unique constraint for upsert on document_id
ALTER TABLE public.extracted_documents ADD CONSTRAINT extracted_documents_document_id_key UNIQUE (document_id);

-- Create a function that calls the process-document edge function via pg_net
CREATE OR REPLACE FUNCTION public.trigger_document_extraction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_temp', 'public'
AS $$
DECLARE
  _supabase_url text;
  _service_key text;
BEGIN
  -- Only process supported file types
  IF NEW.mime_type IS NOT NULL AND NEW.mime_type IN (
    'application/pdf',
    'application/xml',
    'text/xml',
    'image/png',
    'image/jpeg',
    'image/jpg'
  ) THEN
    -- Call the edge function via pg_net
    PERFORM net.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/process-document',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object('document_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Enable pg_net extension for HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create trigger on documents table
CREATE TRIGGER on_document_insert_extract
  AFTER INSERT ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_document_extraction();