-- Adjuntos de gastos: rutas en bucket storage "documents" [{ "path", "name" }]
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.expenses.attachments IS 'Comprobantes en storage.documents: array JSON [{path, name}]';

UPDATE public.expenses
SET attachments = jsonb_build_array(
  jsonb_build_object(
    'path', receipt_path,
    'name',
    split_part(receipt_path, '/', cardinality(string_to_array(receipt_path, '/')))
  )
)
WHERE receipt_path IS NOT NULL
  AND btrim(receipt_path) <> ''
  AND attachments = '[]'::jsonb;
