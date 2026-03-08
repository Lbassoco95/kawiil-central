
CREATE TABLE public.mood_checkins (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  celula text,
  check_date date NOT NULL DEFAULT CURRENT_DATE,
  time_of_day text NOT NULL DEFAULT 'morning',
  mood integer NOT NULL,
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.mood_checkins ENABLE ROW LEVEL SECURITY;

-- Users can insert their own check-ins
CREATE POLICY "Users insert own mood" ON public.mood_checkins
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can see their own check-ins (for personal chart)
CREATE POLICY "Users see own mood" ON public.mood_checkins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Admin/managers can see aggregated by celula (anonymous - only celula, mood, date)
-- We'll handle anonymization in the query layer

-- Create a security definer function for anonymous celula mood stats
CREATE OR REPLACE FUNCTION public.get_celula_mood_stats(
  _org_id uuid,
  _start_date date,
  _end_date date
)
RETURNS TABLE(celula text, check_date date, time_of_day text, avg_mood numeric, total_responses bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'pg_temp', 'public'
AS $$
  SELECT 
    mc.celula,
    mc.check_date,
    mc.time_of_day,
    ROUND(AVG(mc.mood)::numeric, 1) as avg_mood,
    COUNT(*) as total_responses
  FROM public.mood_checkins mc
  WHERE mc.organization_id = _org_id
    AND mc.check_date BETWEEN _start_date AND _end_date
    AND mc.celula IS NOT NULL
  GROUP BY mc.celula, mc.check_date, mc.time_of_day
  ORDER BY mc.check_date DESC
$$;
