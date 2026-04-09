-- Directorio de sugerencias para redactar correo: direcciones vistas en el buzón Microsoft del usuario (sync vía microsoft-api + cliente).
-- Deploy: supabase db push; supabase functions deploy microsoft-api --no-verify-jwt

CREATE TABLE public.user_mail_directory (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, email)
);

CREATE INDEX idx_user_mail_directory_user_last_seen
  ON public.user_mail_directory (user_id, last_seen_at DESC);

ALTER TABLE public.user_mail_directory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_mail_directory_select_own"
  ON public.user_mail_directory FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_mail_directory_insert_own"
  ON public.user_mail_directory FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_mail_directory_update_own"
  ON public.user_mail_directory FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.user_mail_directory TO authenticated;
GRANT ALL ON public.user_mail_directory TO service_role;
