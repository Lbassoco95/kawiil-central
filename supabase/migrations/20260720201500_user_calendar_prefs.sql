-- Preferencias de calendario por usuario (colores por cuenta/calendario, nombre de la
-- cuenta principal, calendarios ocultos, filtros de categoría/etiqueta, etc.).
-- Se guardan como un blob JSON para que la configuración siga al usuario entre
-- dispositivos. El cliente usa localStorage como caché y esta tabla como fuente de verdad.
--
-- Deploy: supabase db push

CREATE TABLE IF NOT EXISTS public.user_calendar_prefs (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE PRIMARY KEY,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_calendar_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_calendar_prefs_select_own" ON public.user_calendar_prefs;
CREATE POLICY "user_calendar_prefs_select_own"
  ON public.user_calendar_prefs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_calendar_prefs_insert_own" ON public.user_calendar_prefs;
CREATE POLICY "user_calendar_prefs_insert_own"
  ON public.user_calendar_prefs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_calendar_prefs_update_own" ON public.user_calendar_prefs;
CREATE POLICY "user_calendar_prefs_update_own"
  ON public.user_calendar_prefs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.user_calendar_prefs TO authenticated;
GRANT ALL ON public.user_calendar_prefs TO service_role;
