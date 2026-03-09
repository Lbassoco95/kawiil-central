
-- Table to store user cultural preferences from questionnaire
CREATE TABLE public.user_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  answers JSONB NOT NULL DEFAULT '{}',
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Table to cache personalized phrases (max 2x/day)
CREATE TABLE public.personalized_phrases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  phrase TEXT NOT NULL,
  phrase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  time_of_day TEXT NOT NULL DEFAULT 'morning',
  mood_score INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, phrase_date, time_of_day)
);

-- RLS
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personalized_phrases ENABLE ROW LEVEL SECURITY;

-- user_preferences: users manage their own
CREATE POLICY "Users manage own preferences" ON public.user_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Admin can read all preferences
CREATE POLICY "Admin read all preferences" ON public.user_preferences
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- personalized_phrases: users see own
CREATE POLICY "Users see own phrases" ON public.personalized_phrases
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own phrases" ON public.personalized_phrases
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own phrases" ON public.personalized_phrases
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
