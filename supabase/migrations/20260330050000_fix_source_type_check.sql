-- Expand document_chunks.source_type CHECK to include 'task' and 'project'
-- Required by index-platform-data Edge Function

ALTER TABLE public.document_chunks
  DROP CONSTRAINT IF EXISTS document_chunks_source_type_check;

ALTER TABLE public.document_chunks
  ADD CONSTRAINT document_chunks_source_type_check
  CHECK (source_type IN (
    'document','extracted_data','chat_message','procedure',
    'comunicado','memory','artifact','task','project'
  ));
