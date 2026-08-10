-- Colaboradores de recordatorios: permitir "arrobar" a otros Kawiilers en un
-- recordatorio para que también lo vean, lo abran y reciban aviso del tema.
--
-- Idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS): esta migración se aplicó
-- primero a mano en el dashboard, por lo que `supabase db push --include-all`
-- vuelve a intentarla; sin las guardas fallaba con "relation already exists" y
-- bloqueaba TODAS las migraciones posteriores del pipeline.

CREATE TABLE IF NOT EXISTS public.reminder_collaborators (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reminder_id uuid NOT NULL REFERENCES public.reminders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (reminder_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reminder_collaborators_reminder_id ON public.reminder_collaborators(reminder_id);
CREATE INDEX IF NOT EXISTS idx_reminder_collaborators_user_id ON public.reminder_collaborators(user_id);

ALTER TABLE public.reminder_collaborators ENABLE ROW LEVEL SECURITY;

-- Helpers SECURITY DEFINER para evitar recursión de RLS entre reminders y
-- reminder_collaborators (cada tabla referencia a la otra en sus políticas).
CREATE OR REPLACE FUNCTION public.reminder_owner_id(_reminder_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT user_id FROM public.reminders WHERE id = _reminder_id
$$;

CREATE OR REPLACE FUNCTION public.is_reminder_collaborator(_reminder_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reminder_collaborators
    WHERE reminder_id = _reminder_id AND user_id = _user_id
  )
$$;

REVOKE ALL ON FUNCTION public.reminder_owner_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_reminder_collaborator(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reminder_owner_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_reminder_collaborator(uuid, uuid) TO authenticated;

-- Políticas de reminder_collaborators: el dueño del recordatorio gestiona los
-- colaboradores; cada colaborador puede verse y quitarse a sí mismo.
DROP POLICY IF EXISTS "Owner and collaborators view reminder collaborators" ON public.reminder_collaborators;
CREATE POLICY "Owner and collaborators view reminder collaborators"
  ON public.reminder_collaborators
  FOR SELECT TO authenticated
  USING (
    public.reminder_owner_id(reminder_id) = auth.uid()
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Owner adds reminder collaborators" ON public.reminder_collaborators;
CREATE POLICY "Owner adds reminder collaborators"
  ON public.reminder_collaborators
  FOR INSERT TO authenticated
  WITH CHECK (public.reminder_owner_id(reminder_id) = auth.uid());

DROP POLICY IF EXISTS "Owner or self removes reminder collaborators" ON public.reminder_collaborators;
CREATE POLICY "Owner or self removes reminder collaborators"
  ON public.reminder_collaborators
  FOR DELETE TO authenticated
  USING (
    public.reminder_owner_id(reminder_id) = auth.uid()
    OR user_id = auth.uid()
  );

-- Los colaboradores pueden ver y actualizar (marcar hecho / editar) los
-- recordatorios compartidos, además de la política del dueño ya existente.
DROP POLICY IF EXISTS "Collaborators view shared reminders" ON public.reminders;
CREATE POLICY "Collaborators view shared reminders"
  ON public.reminders
  FOR SELECT TO authenticated
  USING (public.is_reminder_collaborator(id, auth.uid()));

DROP POLICY IF EXISTS "Collaborators update shared reminders" ON public.reminders;
CREATE POLICY "Collaborators update shared reminders"
  ON public.reminders
  FOR UPDATE TO authenticated
  USING (public.is_reminder_collaborator(id, auth.uid()))
  WITH CHECK (public.is_reminder_collaborator(id, auth.uid()));
