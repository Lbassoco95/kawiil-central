-- Búsqueda vectorial acotada a documentos concretos (delegación RAG / kawiil-agents).
-- No sustituye a match_document_chunks: filter_project_id allí es projects (CRM), no ai_projects.
-- Si filter_document_ids es NULL o vacío, no se devuelve fila (evita full scan).

CREATE OR REPLACE FUNCTION public.match_document_chunks_for_agent(
  query_embedding extensions.vector(1536),
  filter_org_id uuid NOT NULL,
  filter_document_ids uuid[] NOT NULL,
  match_count integer DEFAULT 20,
  filter_source_types text[] DEFAULT NULL,
  similarity_threshold float DEFAULT 0.3
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  source_type text,
  source_id uuid,
  document_id uuid,
  client_id uuid,
  project_id uuid,
  similarity double precision
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF filter_document_ids IS NULL OR coalesce(array_length(filter_document_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    dc.id,
    dc.content,
    dc.metadata,
    dc.source_type,
    dc.source_id,
    dc.document_id,
    dc.client_id,
    dc.project_id,
    (1 - (dc.embedding <=> query_embedding))::double precision AS similarity
  FROM public.document_chunks dc
  WHERE
    dc.organization_id = filter_org_id
    AND dc.document_id IS NOT NULL
    AND dc.document_id = ANY (filter_document_ids)
    AND (filter_source_types IS NULL OR dc.source_type = ANY (filter_source_types))
    AND dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) > similarity_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT GREATEST(1, LEAST(match_count, 200));
END;
$$;

COMMENT ON FUNCTION public.match_document_chunks_for_agent IS
  'RAG para agentes: vecinos por embedding restringidos a document_id IN (filter_document_ids) y org. '
  'Vacío o NULL en filter_document_ids => sin filas. Usar con dispatch context_mode=rag_first + knowledge_included_document_ids.';

GRANT EXECUTE ON FUNCTION public.match_document_chunks_for_agent TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_document_chunks_for_agent TO service_role;
