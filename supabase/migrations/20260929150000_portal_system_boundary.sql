BEGIN;

CREATE TABLE IF NOT EXISTS public.portal_system_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('os_to_central','central_to_os')),
  operation text NOT NULL,
  nonce text NOT NULL,
  request_hash text NOT NULL,
  company_ref text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (direction, nonce),
  UNIQUE (direction, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.portal_system_outbound (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL,
  company_ref text NOT NULL,
  idempotency_key text UNIQUE NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.portal_system_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_system_outbound ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_system_inbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.portal_system_outbound FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.portal_system_inbox TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.portal_system_outbound TO service_role;

COMMIT;
