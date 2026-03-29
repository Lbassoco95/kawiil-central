CREATE OR REPLACE FUNCTION public.trigger_document_extraction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_temp', 'public'
AS $$
BEGIN
  IF NEW.mime_type IS NOT NULL AND NEW.mime_type IN (
    'application/pdf',
    'application/xml',
    'text/xml',
    'image/png',
    'image/jpeg',
    'image/jpg'
  ) THEN
    PERFORM net.http_post(
      url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/process-document',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwcGZhbXBhcGJ4ZGdlZG5rb2ZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNzEzODEsImV4cCI6MjA3MDk0NzM4MX0.KGiTXxE0kwhGyScgK4LvQdU1Gktux2AWHG27_d5bztQ'
      ),
      body := jsonb_build_object('document_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;