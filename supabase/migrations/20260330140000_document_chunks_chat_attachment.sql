-- PDFs del chat indexados para RAG (opción B: búsqueda semántica sin meter todo el PDF en el prompt)

ALTER TABLE public.document_chunks
  DROP CONSTRAINT IF EXISTS document_chunks_source_type_check;

ALTER TABLE public.document_chunks
  ADD CONSTRAINT document_chunks_source_type_check
  CHECK (source_type IN (
    'document','extracted_data','chat_message','procedure',
    'comunicado','memory','artifact','task','project','shared_memory','chat_attachment'
  ));
