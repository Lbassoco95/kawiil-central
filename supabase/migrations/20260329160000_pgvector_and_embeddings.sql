-- =============================================================
-- pgvector + embeddings schema for Kawiil RAG system
-- =============================================================

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- 2. Main table: stores text chunks with their vector embeddings
CREATE TABLE IF NOT EXISTS public.document_chunks (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    document_id uuid,
    client_id uuid,
    project_id uuid,
    source_type text NOT NULL,
    source_id uuid,
    content text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    embedding extensions.vector(1536),
    token_count integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT document_chunks_pkey PRIMARY KEY (id),
    CONSTRAINT document_chunks_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
    CONSTRAINT document_chunks_document_id_fkey
        FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL,
    CONSTRAINT document_chunks_client_id_fkey
        FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL,
    CONSTRAINT document_chunks_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL,
    CONSTRAINT document_chunks_source_type_check
        CHECK (source_type IN ('document', 'extracted_data', 'chat_message', 'procedure', 'comunicado'))
);

COMMENT ON TABLE public.document_chunks IS
    'Stores text fragments with vector embeddings for semantic search (RAG). Each row is a chunk of content from a document, chat message, extraction, or procedure.';

-- 3. Indexes for filtering
CREATE INDEX IF NOT EXISTS idx_document_chunks_org
    ON public.document_chunks (organization_id);

CREATE INDEX IF NOT EXISTS idx_document_chunks_client
    ON public.document_chunks (client_id)
    WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_chunks_project
    ON public.document_chunks (project_id)
    WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_chunks_source
    ON public.document_chunks (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_document_chunks_document
    ON public.document_chunks (document_id)
    WHERE document_id IS NOT NULL;

-- 4. HNSW index for fast approximate nearest-neighbor search
--    Using cosine distance operator class; 1536 dims = OpenAI text-embedding-3-small
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
    ON public.document_chunks
    USING hnsw (embedding extensions.vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- 5. Semantic search function used by the ai-chat Edge Function
CREATE OR REPLACE FUNCTION public.match_document_chunks(
    query_embedding extensions.vector(1536),
    match_count integer DEFAULT 10,
    filter_org_id uuid DEFAULT NULL,
    filter_client_id uuid DEFAULT NULL,
    filter_project_id uuid DEFAULT NULL,
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
    similarity float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
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
        1 - (dc.embedding <=> query_embedding) AS similarity
    FROM public.document_chunks dc
    WHERE
        (filter_org_id IS NULL OR dc.organization_id = filter_org_id)
        AND (filter_client_id IS NULL OR dc.client_id = filter_client_id)
        AND (filter_project_id IS NULL OR dc.project_id = filter_project_id)
        AND (filter_source_types IS NULL OR dc.source_type = ANY(filter_source_types))
        AND dc.embedding IS NOT NULL
        AND 1 - (dc.embedding <=> query_embedding) > similarity_threshold
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION public.match_document_chunks IS
    'Semantic search: returns the most similar document chunks to the query embedding, filtered by org/client/project/source_type.';

-- 6. RLS policies
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view chunks from their organization"
    ON public.document_chunks FOR SELECT
    USING (
        organization_id IN (
            SELECT p.organization_id FROM public.profiles p
            WHERE p.user_id = auth.uid()
        )
    );

CREATE POLICY "Service role can manage all chunks"
    ON public.document_chunks FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- 7. Helper: count chunks per source to track embedding progress
CREATE OR REPLACE FUNCTION public.embedding_stats(org_id uuid)
RETURNS TABLE (
    source_type text,
    chunk_count bigint,
    earliest timestamptz,
    latest timestamptz
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        dc.source_type,
        count(*) AS chunk_count,
        min(dc.created_at) AS earliest,
        max(dc.created_at) AS latest
    FROM public.document_chunks dc
    WHERE dc.organization_id = org_id
    GROUP BY dc.source_type
    ORDER BY dc.source_type;
$$;
