-- Grant EXECUTE on knowledge RPCs to authenticated users
-- These were created as SECURITY DEFINER but lacked explicit GRANT EXECUTE

GRANT EXECUTE ON FUNCTION public.embedding_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_knowledge_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_knowledge_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.celula_knowledge_stats(uuid) TO authenticated;

-- Also ensure the knowledge tables have proper service-role INSERT policies
-- (knowledge_feed was missing INSERT policy for service role)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'knowledge_feed' AND policyname = 'Service insert feed'
  ) THEN
    CREATE POLICY "Service insert feed" ON public.knowledge_feed FOR INSERT WITH CHECK (true);
  END IF;
END
$$;
