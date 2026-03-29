-- Knowledge Agents: sync logs, insights, feed

-- 1. Sync logs
CREATE TABLE IF NOT EXISTS public.knowledge_sync_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  agent text NOT NULL CHECK (agent IN ('archivista','integrador','nutritor')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  stats jsonb DEFAULT '{}',
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_ksl_org ON public.knowledge_sync_logs(organization_id);
CREATE INDEX idx_ksl_agent ON public.knowledge_sync_logs(agent);
ALTER TABLE public.knowledge_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read org sync logs" ON public.knowledge_sync_logs FOR SELECT
  USING (organization_id IN (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()));

-- 2. Knowledge insights
CREATE TABLE IF NOT EXISTS public.knowledge_insights (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  area text,
  insight_type text NOT NULL CHECK (insight_type IN ('client_profile','project_profile','area_summary','pattern','recommendation')),
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  metadata jsonb DEFAULT '{}',
  source_chunks uuid[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_ki_org ON public.knowledge_insights(organization_id);
CREATE INDEX idx_ki_client ON public.knowledge_insights(client_id);
CREATE INDEX idx_ki_project ON public.knowledge_insights(project_id);
CREATE INDEX idx_ki_type ON public.knowledge_insights(insight_type);
ALTER TABLE public.knowledge_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read org insights" ON public.knowledge_insights FOR SELECT
  USING (organization_id IN (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()));

CREATE POLICY "Service insert insights" ON public.knowledge_insights FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service update insights" ON public.knowledge_insights FOR UPDATE
  USING (true);

-- 3. Knowledge feed
CREATE TABLE IF NOT EXISTS public.knowledge_feed (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  feed_type text NOT NULL CHECK (feed_type IN ('new_document','insight','recommendation','alert')),
  title text NOT NULL,
  summary text,
  detail text,
  related_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  related_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_kf_org ON public.knowledge_feed(organization_id);
CREATE INDEX idx_kf_read ON public.knowledge_feed(is_read);
ALTER TABLE public.knowledge_feed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read org feed" ON public.knowledge_feed FOR SELECT
  USING (organization_id IN (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()));

CREATE POLICY "Users update own feed" ON public.knowledge_feed FOR UPDATE
  USING (organization_id IN (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()));

-- 4. RPC: client knowledge stats (chunks + docs grouped by client & area)
CREATE OR REPLACE FUNCTION public.client_knowledge_stats(p_org_id uuid)
RETURNS TABLE (
  client_id uuid,
  client_name text,
  area text,
  doc_count bigint,
  chunk_count bigint,
  last_chunk_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    c.id AS client_id,
    c.name AS client_name,
    COALESCE(d.document_type, 'general') AS area,
    COUNT(DISTINCT d.id) AS doc_count,
    COUNT(dc.id) AS chunk_count,
    MAX(dc.created_at) AS last_chunk_at
  FROM public.clients c
  LEFT JOIN public.documents d ON d.client_id = c.id
  LEFT JOIN public.document_chunks dc ON dc.document_id = d.id
  WHERE c.organization_id = p_org_id
  GROUP BY c.id, c.name, COALESCE(d.document_type, 'general')
  ORDER BY c.name, area;
$$;

-- 5. RPC: project knowledge stats
CREATE OR REPLACE FUNCTION public.project_knowledge_stats(p_org_id uuid)
RETURNS TABLE (
  project_id uuid,
  project_name text,
  client_name text,
  area text,
  doc_count bigint,
  chunk_count bigint,
  last_chunk_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    p.id AS project_id,
    p.name AS project_name,
    c.name AS client_name,
    COALESCE(p.area::text, 'general') AS area,
    COUNT(DISTINCT d.id) AS doc_count,
    COUNT(dc.id) AS chunk_count,
    MAX(dc.created_at) AS last_chunk_at
  FROM public.projects p
  LEFT JOIN public.clients c ON c.id = p.client_id
  LEFT JOIN public.documents d ON d.project_id = p.id
  LEFT JOIN public.document_chunks dc ON dc.document_id = d.id
  WHERE p.organization_id = p_org_id
    AND p.status IN ('activo','pausado')
  GROUP BY p.id, p.name, c.name, COALESCE(p.area::text, 'general')
  ORDER BY c.name NULLS LAST, p.name;
$$;
