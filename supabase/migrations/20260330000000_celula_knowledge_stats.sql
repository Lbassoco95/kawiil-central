-- RPC: knowledge stats grouped by celula (practice area)
CREATE OR REPLACE FUNCTION public.celula_knowledge_stats(p_org_id uuid)
RETURNS TABLE (
  celula_id uuid,
  celula_name text,
  celula_slug text,
  celula_color text,
  doc_count bigint,
  chunk_count bigint,
  project_count bigint,
  client_count bigint,
  last_chunk_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    cel.id AS celula_id,
    cel.name AS celula_name,
    cel.slug AS celula_slug,
    cel.color AS celula_color,
    COUNT(DISTINCT d.id) AS doc_count,
    COUNT(dc.id) AS chunk_count,
    COUNT(DISTINCT p.id) AS project_count,
    COUNT(DISTINCT p.client_id) AS client_count,
    MAX(dc.created_at) AS last_chunk_at
  FROM public.celulas cel
  LEFT JOIN public.projects p ON p.area::text = cel.slug AND p.organization_id = p_org_id
  LEFT JOIN public.documents d ON d.project_id = p.id
  LEFT JOIN public.document_chunks dc ON dc.document_id = d.id
  WHERE cel.organization_id = p_org_id AND cel.is_active = true
  GROUP BY cel.id, cel.name, cel.slug, cel.color
  ORDER BY chunk_count DESC;
$$;
