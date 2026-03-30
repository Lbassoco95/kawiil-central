-- RPC: learning_progress_stats — precise counts for the knowledge module dashboard
CREATE OR REPLACE FUNCTION public.learning_progress_stats(p_org_id uuid)
RETURNS TABLE (
  total_docs bigint,
  total_chunks bigint,
  total_insights bigint,
  total_feed_items bigint,
  clients_with_chunks bigint,
  total_active_clients bigint,
  projects_with_chunks bigint,
  total_active_projects bigint,
  task_chunks bigint,
  project_chunks bigint,
  document_chunks_count bigint,
  last_sync_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    (SELECT COUNT(*) FROM public.documents WHERE organization_id = p_org_id) AS total_docs,
    (SELECT COUNT(*) FROM public.document_chunks WHERE organization_id = p_org_id) AS total_chunks,
    (SELECT COUNT(*) FROM public.knowledge_insights WHERE organization_id = p_org_id) AS total_insights,
    (SELECT COUNT(*) FROM public.knowledge_feed WHERE organization_id = p_org_id) AS total_feed_items,
    (SELECT COUNT(DISTINCT client_id) FROM public.document_chunks WHERE organization_id = p_org_id AND client_id IS NOT NULL) AS clients_with_chunks,
    (SELECT COUNT(*) FROM public.clients WHERE organization_id = p_org_id AND status = 'activo') AS total_active_clients,
    (SELECT COUNT(DISTINCT project_id) FROM public.document_chunks WHERE organization_id = p_org_id AND project_id IS NOT NULL) AS projects_with_chunks,
    (SELECT COUNT(*) FROM public.projects WHERE organization_id = p_org_id AND status IN ('activo','pausado')) AS total_active_projects,
    (SELECT COUNT(*) FROM public.document_chunks WHERE organization_id = p_org_id AND source_type = 'task') AS task_chunks,
    (SELECT COUNT(*) FROM public.document_chunks WHERE organization_id = p_org_id AND source_type = 'project') AS project_chunks,
    (SELECT COUNT(*) FROM public.document_chunks WHERE organization_id = p_org_id AND source_type = 'document') AS document_chunks_count,
    (SELECT MAX(completed_at) FROM public.knowledge_sync_logs WHERE organization_id = p_org_id AND status = 'completed') AS last_sync_at;
$$;

GRANT EXECUTE ON FUNCTION public.learning_progress_stats(uuid) TO authenticated;

-- Update client_knowledge_stats to also include task/project source_type chunks
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
    COALESCE(c.primary_area::text, 'general') AS area,
    (SELECT COUNT(*) FROM public.documents d WHERE d.client_id = c.id) AS doc_count,
    (SELECT COUNT(*) FROM public.document_chunks dc WHERE dc.client_id = c.id) AS chunk_count,
    (SELECT MAX(dc.created_at) FROM public.document_chunks dc WHERE dc.client_id = c.id) AS last_chunk_at
  FROM public.clients c
  WHERE c.organization_id = p_org_id AND c.status = 'activo'
  ORDER BY c.name;
$$;

-- Update project_knowledge_stats to include task/project source chunks
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
    (SELECT COUNT(*) FROM public.documents d WHERE d.project_id = p.id) AS doc_count,
    (SELECT COUNT(*) FROM public.document_chunks dc WHERE dc.project_id = p.id) AS chunk_count,
    (SELECT MAX(dc.created_at) FROM public.document_chunks dc WHERE dc.project_id = p.id) AS last_chunk_at
  FROM public.projects p
  LEFT JOIN public.clients c ON c.id = p.client_id
  WHERE p.organization_id = p_org_id
    AND p.status IN ('activo','pausado')
  ORDER BY c.name NULLS LAST, p.name;
$$;
