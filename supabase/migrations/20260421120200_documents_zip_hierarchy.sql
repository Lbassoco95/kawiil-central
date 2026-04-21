-- Jerarquía ZIP: documento padre (archivo .zip) e hijos extraídos con ruta dentro del archivo.
-- Indexación en segundo plano vía Edge `process-zip-documents`.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS parent_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS archive_path text;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.documents.parent_document_id IS
  'Documento contenedor (p. ej. .zip subido). Los archivos extraídos apuntan al padre.';
COMMENT ON COLUMN public.documents.archive_path IS
  'Ruta relativa dentro del ZIP del documento padre; NULL si no aplica.';
COMMENT ON COLUMN public.documents.metadata IS
  'Metadatos flexibles: estado de extracción ZIP, conteos, etc.';

CREATE INDEX IF NOT EXISTS idx_documents_parent_document_id
  ON public.documents(parent_document_id)
  WHERE parent_document_id IS NOT NULL;
