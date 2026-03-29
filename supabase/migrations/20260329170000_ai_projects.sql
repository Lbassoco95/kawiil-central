-- =============================================================
-- AI Projects: Claude-like project workspaces with persistent context
-- =============================================================

CREATE TABLE IF NOT EXISTS public.ai_projects (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    instructions text,
    client_id uuid,
    project_id uuid,
    is_archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ai_projects_pkey PRIMARY KEY (id),
    CONSTRAINT ai_projects_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
    CONSTRAINT ai_projects_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT ai_projects_client_id_fkey
        FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL,
    CONSTRAINT ai_projects_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.ai_projects IS
    'AI Projects are Claude-like workspaces with custom instructions, linked documents, and persistent context. Each project scopes the AI knowledge base to relevant content.';

COMMENT ON COLUMN public.ai_projects.instructions IS
    'Custom system-level instructions for the AI when working within this project context (e.g. "Always reference Mexican tax law", "Focus on PLD compliance").';

-- Link AI projects to specific documents for context
CREATE TABLE IF NOT EXISTS public.ai_project_documents (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    ai_project_id uuid NOT NULL,
    document_id uuid,
    dropbox_path text,
    name text NOT NULL,
    source text NOT NULL DEFAULT 'supabase',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ai_project_documents_pkey PRIMARY KEY (id),
    CONSTRAINT ai_project_documents_ai_project_id_fkey
        FOREIGN KEY (ai_project_id) REFERENCES public.ai_projects(id) ON DELETE CASCADE,
    CONSTRAINT ai_project_documents_document_id_fkey
        FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL,
    CONSTRAINT ai_project_documents_source_check
        CHECK (source IN ('supabase', 'dropbox', 'manual'))
);

-- Link conversations to AI projects
ALTER TABLE public.chat_conversations
    ADD COLUMN IF NOT EXISTS ai_project_id uuid;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'chat_conversations_ai_project_id_fkey'
    ) THEN
        ALTER TABLE public.chat_conversations
            ADD CONSTRAINT chat_conversations_ai_project_id_fkey
            FOREIGN KEY (ai_project_id) REFERENCES public.ai_projects(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_projects_user
    ON public.ai_projects (user_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_ai_projects_client
    ON public.ai_projects (client_id)
    WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_project_documents_project
    ON public.ai_project_documents (ai_project_id);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_ai_project
    ON public.chat_conversations (ai_project_id)
    WHERE ai_project_id IS NOT NULL;

-- RLS
ALTER TABLE public.ai_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_project_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own AI projects"
    ON public.ai_projects FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can view AI projects in their org"
    ON public.ai_projects FOR SELECT
    USING (
        organization_id IN (
            SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage documents in their AI projects"
    ON public.ai_project_documents FOR ALL
    USING (
        ai_project_id IN (
            SELECT ap.id FROM public.ai_projects ap WHERE ap.user_id = auth.uid()
        )
    )
    WITH CHECK (
        ai_project_id IN (
            SELECT ap.id FROM public.ai_projects ap WHERE ap.user_id = auth.uid()
        )
    );

CREATE POLICY "Service role full access ai_projects"
    ON public.ai_projects FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access ai_project_documents"
    ON public.ai_project_documents FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
