-- AI project collaboration, shared team memories, chat message attachments, chat-uploads bucket

-- ─── Members ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_project_members (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    ai_project_id uuid NOT NULL REFERENCES public.ai_projects(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
    invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (ai_project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_project_members_user ON public.ai_project_members (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_project_members_project ON public.ai_project_members (ai_project_id);

INSERT INTO public.ai_project_members (ai_project_id, user_id, role, invited_by)
SELECT ap.id, ap.user_id, 'owner', ap.user_id
FROM public.ai_projects ap
ON CONFLICT (ai_project_id, user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ai_project_add_owner_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.ai_project_members (ai_project_id, user_id, role, invited_by)
    VALUES (NEW.id, NEW.user_id, 'owner', NEW.user_id)
    ON CONFLICT (ai_project_id, user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_ai_projects_add_owner_member ON public.ai_projects;
CREATE TRIGGER tr_ai_projects_add_owner_member
    AFTER INSERT ON public.ai_projects
    FOR EACH ROW EXECUTE FUNCTION public.ai_project_add_owner_member();

ALTER TABLE public.ai_project_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view project membership"
    ON public.ai_project_members FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.ai_projects ap
            WHERE ap.id = ai_project_members.ai_project_id
              AND (ap.user_id = auth.uid() OR EXISTS (
                  SELECT 1 FROM public.ai_project_members m2
                  WHERE m2.ai_project_id = ap.id AND m2.user_id = auth.uid()
              ))
        )
    );

CREATE POLICY "Owners add project members"
    ON public.ai_project_members FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.ai_projects ap
            WHERE ap.id = ai_project_members.ai_project_id AND ap.user_id = auth.uid()
        )
    );

CREATE POLICY "Owners remove project members"
    ON public.ai_project_members FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.ai_projects ap
            WHERE ap.id = ai_project_members.ai_project_id AND ap.user_id = auth.uid()
        )
        OR ai_project_members.user_id = auth.uid()
    );

CREATE POLICY "Service role full access ai_project_members"
    ON public.ai_project_members FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ─── Shared team memories ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_project_shared_memories (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    ai_project_id uuid NOT NULL REFERENCES public.ai_projects(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    path text NOT NULL,
    content text NOT NULL,
    updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (ai_project_id, path)
);

CREATE INDEX IF NOT EXISTS idx_ai_project_shared_memories_project
    ON public.ai_project_shared_memories (ai_project_id);

ALTER TABLE public.ai_project_shared_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members read shared memories"
    ON public.ai_project_shared_memories FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.ai_projects ap
            WHERE ap.id = ai_project_shared_memories.ai_project_id
              AND (
                  ap.user_id = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM public.ai_project_members m
                      WHERE m.ai_project_id = ap.id AND m.user_id = auth.uid()
                  )
              )
        )
    );

CREATE POLICY "Editors manage shared memories"
    ON public.ai_project_shared_memories FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.ai_projects ap
            WHERE ap.id = ai_project_shared_memories.ai_project_id
              AND (
                  ap.user_id = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM public.ai_project_members m
                      WHERE m.ai_project_id = ap.id AND m.user_id = auth.uid()
                      AND m.role IN ('owner', 'editor')
                  )
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.ai_projects ap
            WHERE ap.id = ai_project_shared_memories.ai_project_id
              AND (
                  ap.user_id = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM public.ai_project_members m
                      WHERE m.ai_project_id = ap.id AND m.user_id = auth.uid()
                      AND m.role IN ('owner', 'editor')
                  )
              )
        )
    );

CREATE POLICY "Service role full access ai_project_shared_memories"
    ON public.ai_project_shared_memories FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ─── Tighten ai_projects: drop org-wide SELECT ──────────────
DROP POLICY IF EXISTS "Users can view AI projects in their org" ON public.ai_projects;

CREATE POLICY "Members can view shared AI projects"
    ON public.ai_projects FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.ai_project_members m
            WHERE m.ai_project_id = ai_projects.id AND m.user_id = auth.uid()
        )
    );

-- Owner policy "Users can manage their own AI projects" remains (FOR ALL)

-- ─── ai_project_documents: members read, owner/editor write ─
DROP POLICY IF EXISTS "Users can manage documents in their AI projects" ON public.ai_project_documents;

CREATE POLICY "Members read ai project documents"
    ON public.ai_project_documents FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.ai_projects ap
            WHERE ap.id = ai_project_documents.ai_project_id
              AND (
                  ap.user_id = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM public.ai_project_members m
                      WHERE m.ai_project_id = ap.id AND m.user_id = auth.uid()
                  )
              )
        )
    );

CREATE POLICY "Editors manage ai project documents"
    ON public.ai_project_documents FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.ai_projects ap
            WHERE ap.id = ai_project_documents.ai_project_id
              AND (
                  ap.user_id = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM public.ai_project_members m
                      WHERE m.ai_project_id = ap.id AND m.user_id = auth.uid()
                      AND m.role IN ('owner', 'editor')
                  )
              )
        )
    );

CREATE POLICY "Editors update delete ai project documents"
    ON public.ai_project_documents FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.ai_projects ap
            WHERE ap.id = ai_project_documents.ai_project_id
              AND (
                  ap.user_id = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM public.ai_project_members m
                      WHERE m.ai_project_id = ap.id AND m.user_id = auth.uid()
                      AND m.role IN ('owner', 'editor')
                  )
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.ai_projects ap
            WHERE ap.id = ai_project_documents.ai_project_id
              AND (
                  ap.user_id = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM public.ai_project_members m
                      WHERE m.ai_project_id = ap.id AND m.user_id = auth.uid()
                      AND m.role IN ('owner', 'editor')
                  )
              )
        )
    );

CREATE POLICY "Editors delete ai project documents"
    ON public.ai_project_documents FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.ai_projects ap
            WHERE ap.id = ai_project_documents.ai_project_id
              AND (
                  ap.user_id = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM public.ai_project_members m
                      WHERE m.ai_project_id = ap.id AND m.user_id = auth.uid()
                      AND m.role IN ('owner', 'editor')
                  )
              )
        )
    );

-- Allow project owners to update project (already covered by own policy) — members who are viewers should not update ai_projects row
-- Add policy so editors can update non-owner fields? Plan: only owner updates project metadata via existing FOR ALL owner policy.
-- Viewers need SELECT on ai_projects: covered by "Members can view shared AI projects" + owner policy includes SELECT for own rows.

-- ─── RPC: list accessible projects ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_ai_projects()
RETURNS SETOF public.ai_projects
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT ap.*
    FROM public.ai_projects ap
    LEFT JOIN public.ai_project_members m ON m.ai_project_id = ap.id AND m.user_id = auth.uid()
    WHERE ap.is_archived = false
      AND (ap.user_id = auth.uid() OR m.user_id IS NOT NULL)
    ORDER BY ap.updated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_ai_projects() TO authenticated;

-- ─── Chat message attachments ───────────────────────────────
ALTER TABLE public.chat_messages
    ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.chat_messages.attachments IS
    'JSON array of {bucket, path, name, mime_type, document_id?} for files attached to this message';

-- ─── document_chunks: shared_memory ─────────────────────────
ALTER TABLE public.document_chunks
    DROP CONSTRAINT IF EXISTS document_chunks_source_type_check;

ALTER TABLE public.document_chunks
    ADD CONSTRAINT document_chunks_source_type_check
    CHECK (source_type IN (
        'document','extracted_data','chat_message','procedure',
        'comunicado','memory','artifact','task','project','shared_memory'
    ));

-- ─── Storage: chat-uploads ───────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-uploads', 'chat-uploads', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users upload chat files to org folder"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'chat-uploads'
        AND (storage.foldername(name))[1] = (
            SELECT organization_id::text FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
        )
    );

CREATE POLICY "Users read chat files in org folder"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'chat-uploads'
        AND (storage.foldername(name))[1] = (
            SELECT organization_id::text FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
        )
    );

CREATE POLICY "Users delete own chat files"
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'chat-uploads'
        AND (storage.foldername(name))[1] = (
            SELECT organization_id::text FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
        )
        AND (storage.foldername(name))[2] = auth.uid()::text
    );
