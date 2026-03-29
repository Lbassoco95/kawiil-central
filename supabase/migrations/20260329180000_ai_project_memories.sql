-- =============================================================
-- AI Project Memories: persistent memory files managed by Claude
-- =============================================================

CREATE TABLE IF NOT EXISTS public.ai_project_memories (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    ai_project_id uuid,
    user_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    path text NOT NULL,
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ai_project_memories_pkey PRIMARY KEY (id),
    CONSTRAINT ai_project_memories_ai_project_id_fkey
        FOREIGN KEY (ai_project_id) REFERENCES public.ai_projects(id) ON DELETE CASCADE,
    CONSTRAINT ai_project_memories_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT ai_project_memories_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
    CONSTRAINT ai_project_memories_unique_path
        UNIQUE (ai_project_id, user_id, path)
);

COMMENT ON TABLE public.ai_project_memories IS
    'Virtual memory files managed autonomously by Claude via the Memory Tool. Each row is a "file" with a path like /memories/analysis.md';

CREATE INDEX IF NOT EXISTS idx_ai_project_memories_user
    ON public.ai_project_memories (user_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_ai_project_memories_project
    ON public.ai_project_memories (ai_project_id)
    WHERE ai_project_id IS NOT NULL;

-- Allow 'memory' as a source_type in document_chunks CHECK constraint if one exists
-- (the existing CHECK only validates a list; we add 'memory' to it)
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'document_chunks_source_type_check'
    ) THEN
        ALTER TABLE public.document_chunks DROP CONSTRAINT document_chunks_source_type_check;
    END IF;
END $$;

ALTER TABLE public.document_chunks
    ADD CONSTRAINT document_chunks_source_type_check
    CHECK (source_type IN ('document', 'extracted_data', 'chat_message', 'procedure', 'comunicado', 'memory'));

-- RLS
ALTER TABLE public.ai_project_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own memories"
    ON public.ai_project_memories FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Service role full access memories"
    ON public.ai_project_memories FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
