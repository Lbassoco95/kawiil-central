-- Cuentas vinculadas multi-proveedor (Microsoft 365, Google, IMAP/SMTP).
-- Base para que un usuario dé de alta varias cuentas de correo/calendario.
-- Los tokens y credenciales solo son accesibles por service_role (edge functions);
-- el cliente puede leer/gestionar los metadatos de sus cuentas, nunca los secretos.
--
-- Deploy:
--   supabase db push
--   supabase functions deploy google-auth google-callback google-api --no-verify-jwt
-- Secrets requeridos (Supabase → Project Settings → Edge Functions):
--   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
--   Redirect URI en Google Cloud: <SUPABASE_URL>/functions/v1/google-callback

CREATE TABLE IF NOT EXISTS public.linked_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('microsoft', 'google', 'imap')),
  email text,
  display_name text,
  provider_account_id text,

  -- OAuth (microsoft / google)
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scope text,

  -- IMAP / SMTP (solo provider = 'imap')
  imap_host text,
  imap_port integer,
  imap_username text,
  imap_password text,          -- pendiente: cifrar con pgsodium / Vault antes de producción
  smtp_host text,
  smtp_port integer,
  smtp_use_tls boolean NOT NULL DEFAULT true,

  -- Estado y capacidades
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'disconnected')),
  calendar_enabled boolean NOT NULL DEFAULT true,
  mail_enabled boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, provider, email)
);

CREATE INDEX IF NOT EXISTS idx_linked_accounts_user
  ON public.linked_accounts (user_id, provider);

ALTER TABLE public.linked_accounts ENABLE ROW LEVEL SECURITY;

-- El usuario puede ver/gestionar sus propias cuentas (los tokens se protegen con
-- GRANTs a nivel de columna más abajo, no se exponen aunque haya SELECT).
DROP POLICY IF EXISTS "linked_accounts_select_own" ON public.linked_accounts;
CREATE POLICY "linked_accounts_select_own"
  ON public.linked_accounts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "linked_accounts_update_own" ON public.linked_accounts;
CREATE POLICY "linked_accounts_update_own"
  ON public.linked_accounts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "linked_accounts_delete_own" ON public.linked_accounts;
CREATE POLICY "linked_accounts_delete_own"
  ON public.linked_accounts FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- El cliente NO inserta directamente: las cuentas OAuth las crea el callback
-- (service_role) y las IMAP se crearán vía una edge function dedicada.

-- Column-level grants: authenticated solo puede leer/escribir metadatos,
-- nunca los tokens ni las contraseñas IMAP.
GRANT SELECT (
  id, user_id, provider, email, display_name, provider_account_id,
  status, calendar_enabled, mail_enabled, last_sync_at, last_error,
  imap_host, imap_port, imap_username, smtp_host, smtp_port, smtp_use_tls,
  created_at, updated_at
) ON public.linked_accounts TO authenticated;

GRANT UPDATE (
  display_name, calendar_enabled, mail_enabled
) ON public.linked_accounts TO authenticated;

GRANT DELETE ON public.linked_accounts TO authenticated;
GRANT ALL ON public.linked_accounts TO service_role;

-- updated_at automático
CREATE OR REPLACE FUNCTION public.set_linked_accounts_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_linked_accounts_updated_at ON public.linked_accounts;
CREATE TRIGGER trg_linked_accounts_updated_at
  BEFORE UPDATE ON public.linked_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_linked_accounts_updated_at();
