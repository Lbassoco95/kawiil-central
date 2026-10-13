-- Memoria de personas que participan en las juntas (por empresa/cliente),
-- para reconocerlas en resúmenes futuros y acumular contexto de lo que se trabaja.

CREATE TABLE IF NOT EXISTS public.mtg_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  role text,
  email text,
  side text NOT NULL DEFAULT 'client' CHECK (side IN ('client', 'kawiil', 'other')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mtg_people_unique_name
  ON public.mtg_people (organization_id, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE INDEX IF NOT EXISTS mtg_people_client_idx ON public.mtg_people (client_id);

CREATE TABLE IF NOT EXISTS public.mtg_meeting_people (
  meeting_id uuid NOT NULL REFERENCES public.mtg_meetings(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.mtg_people(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  note text,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, person_id)
);

ALTER TABLE public.mtg_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mtg_meeting_people ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mtg_people', 'mtg_meeting_people'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (organization_id = public.get_user_org_id(auth.uid()))', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (organization_id = public.get_user_org_id(auth.uid()))', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (organization_id = public.get_user_org_id(auth.uid())) WITH CHECK (organization_id = public.get_user_org_id(auth.uid()))', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (organization_id = public.get_user_org_id(auth.uid()))', t || '_delete', t);
  END LOOP;
END $$;
