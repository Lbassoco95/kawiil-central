-- Agregados para pestaña Estadísticas (Conocimiento): feedback negativo por categoría y memorias por tipo (por organización).
CREATE OR REPLACE FUNCTION public.get_ai_learning_stats_for_org()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  oid uuid;
  fb jsonb;
  mm jsonb;
BEGIN
  SELECT organization_id INTO oid FROM public.profiles WHERE user_id = auth.uid();
  IF oid IS NULL THEN RETURN '{}'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('category', s.category, 'n', s.n)), '[]'::jsonb)
  INTO fb
  FROM (
    SELECT COALESCE(f.feedback_category, 'sin_categoria') AS category, count(*)::int AS n
    FROM public.ai_feedback f
    WHERE f.organization_id = oid AND f.rating = 'down'
    GROUP BY 1
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('memory_type', s.memory_type, 'n', s.n)), '[]'::jsonb)
  INTO mm
  FROM (
    SELECT m.memory_type, count(*)::int AS n
    FROM public.ai_user_memories m
    WHERE m.organization_id = oid AND m.enabled = true
    GROUP BY 1
  ) s;

  RETURN jsonb_build_object(
    'feedback_down_by_category', fb,
    'user_memories_by_type', mm
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_ai_learning_stats_for_org() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ai_learning_stats_for_org() TO authenticated;
