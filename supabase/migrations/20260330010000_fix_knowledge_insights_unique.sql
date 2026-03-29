-- Partial unique indexes for knowledge_insights upserts
-- client_profile: one per (org, client)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ki_client_profile
  ON public.knowledge_insights (organization_id, client_id, insight_type)
  WHERE client_id IS NOT NULL AND insight_type = 'client_profile';

-- project_profile: one per (org, project)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ki_project_profile
  ON public.knowledge_insights (organization_id, project_id, insight_type)
  WHERE project_id IS NOT NULL AND insight_type = 'project_profile';
