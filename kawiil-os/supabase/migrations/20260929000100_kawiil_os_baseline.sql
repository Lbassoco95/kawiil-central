BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE public.portal_role AS ENUM ('administrador', 'rh', 'operativo', 'consulta', 'empleado');
CREATE TYPE public.portal_tier AS ENUM ('premier', 'basico');

CREATE TABLE public.portal_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT gen_random_uuid(),
  external_ref text UNIQUE NOT NULL,
  name text NOT NULL,
  rfc text,
  tier public.portal_tier NOT NULL DEFAULT 'premier',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  fiscal_enabled boolean NOT NULL DEFAULT true,
  tickets_enabled boolean NOT NULL DEFAULT true,
  rh_enabled boolean NOT NULL DEFAULT false,
  rh_processing_terms_version text,
  rh_processing_terms_accepted_at timestamptz,
  auto_publish_sat_documents boolean NOT NULL DEFAULT true,
  retention_years smallint NOT NULL DEFAULT 5 CHECK (retention_years BETWEEN 1 AND 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.portal_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text,
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','activa','suspendida','eliminada')),
  is_kawiil_operator boolean NOT NULL DEFAULT false,
  operator_level smallint CHECK (operator_level BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.portal_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.portal_accounts(user_id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  role public.portal_role NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);

CREATE TABLE public.portal_staff_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.portal_accounts(user_id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('administration','hr_file','survey_aggregates')),
  granted_by uuid NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  revoked_at timestamptz,
  UNIQUE (user_id, client_id, scope, starts_at)
);

CREATE TABLE public.portal_client_settings (
  client_id uuid PRIMARY KEY REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  emission_enabled boolean NOT NULL DEFAULT false,
  pac_sync_enabled boolean NOT NULL DEFAULT false,
  pac_sync_schedule text,
  iva_basis text NOT NULL DEFAULT 'cash_flow' CHECK (iva_basis IN ('cash_flow','issuance')),
  climate_min_group_size smallint NOT NULL DEFAULT 5 CHECK (climate_min_group_size >= 3),
  demo_mode boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.portal_tax_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  rfc text NOT NULL,
  legal_name text NOT NULL,
  fiscal_regime text,
  fiscal_postal_code text,
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  UNIQUE (client_id, rfc)
);

CREATE TABLE public.portal_legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  version text NOT NULL,
  title text NOT NULL,
  body_md text NOT NULL,
  is_placeholder boolean NOT NULL DEFAULT true,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, version)
);

CREATE TABLE public.portal_legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.portal_accounts(user_id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.portal_legal_documents(id),
  kind text NOT NULL,
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  user_agent text
);

CREATE TABLE public.portal_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id uuid REFERENCES public.portal_companies(id) ON DELETE SET NULL,
  actor_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.portal_cfdi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  uuid text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('emitida','recibida')),
  source text NOT NULL,
  detail_status text NOT NULL DEFAULT 'metadata' CHECK (detail_status IN ('metadata','complete')),
  version text,
  issued_at timestamptz,
  issuer_rfc text,
  issuer_name text,
  receiver_rfc text,
  receiver_name text,
  voucher_type text,
  payment_form text,
  payment_method text,
  currency text NOT NULL DEFAULT 'MXN',
  exchange_rate numeric,
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  vat_transferred numeric NOT NULL DEFAULT 0,
  vat_withheld numeric NOT NULL DEFAULT 0,
  income_tax_withheld numeric NOT NULL DEFAULT 0,
  ieps numeric NOT NULL DEFAULT 0,
  other_taxes numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  sat_status text NOT NULL DEFAULT 'unknown',
  xml_path text,
  pdf_path text,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, uuid)
);

CREATE TABLE public.portal_cfdi_tax_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cfdi_id uuid NOT NULL REFERENCES public.portal_cfdi(id) ON DELETE CASCADE,
  tax text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('transfer','withholding')),
  rate numeric,
  factor text,
  base numeric NOT NULL,
  amount numeric NOT NULL
);

CREATE TABLE public.portal_cfdi_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cfdi_id uuid NOT NULL REFERENCES public.portal_cfdi(id) ON DELETE CASCADE,
  product_service_key text,
  description text NOT NULL,
  quantity numeric NOT NULL,
  unit_value numeric NOT NULL,
  amount numeric NOT NULL,
  discount numeric NOT NULL DEFAULT 0
);

CREATE TABLE public.portal_payment_links (
  payment_cfdi_id uuid NOT NULL REFERENCES public.portal_cfdi(id) ON DELETE CASCADE,
  related_cfdi_id uuid NOT NULL REFERENCES public.portal_cfdi(id) ON DELETE CASCADE,
  paid_at timestamptz NOT NULL,
  paid_amount numeric NOT NULL,
  PRIMARY KEY (payment_cfdi_id, related_cfdi_id, paid_at)
);

CREATE TABLE public.portal_merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  window_type text NOT NULL DEFAULT 'days',
  window_days integer,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.portal_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  submitted_by uuid REFERENCES public.portal_accounts(user_id) ON DELETE SET NULL,
  merchant_id uuid REFERENCES public.portal_merchants(id),
  merchant_name text,
  receipt_date date,
  folio text,
  total numeric,
  file_path text NOT NULL,
  file_hash text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  team_note text,
  cfdi_id uuid REFERENCES public.portal_cfdi(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, file_hash)
);

CREATE TABLE public.portal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  external_ref text,
  title text NOT NULL,
  doc_type text NOT NULL,
  obtained_at timestamptz,
  period_year integer,
  period_month integer,
  opinion_result text,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  status text NOT NULL DEFAULT 'published',
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, external_ref)
);

CREATE TABLE public.portal_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  kind text NOT NULL DEFAULT 'support',
  last_message_at timestamptz
);

CREATE TABLE public.portal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.portal_threads(id) ON DELETE CASCADE,
  external_ref text,
  author_kind text NOT NULL CHECK (author_kind IN ('client','kawiil')),
  author_name text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, external_ref)
);

CREATE TABLE public.portal_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.portal_messages(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint
);

CREATE TABLE public.portal_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  account_user_id uuid REFERENCES public.portal_accounts(user_id) ON DELETE SET NULL,
  employee_number text,
  display_name text NOT NULL,
  work_email text,
  status text NOT NULL DEFAULT 'active',
  sensitive_ciphertext text,
  sensitive_key_version smallint,
  hired_at date,
  terminated_at date,
  UNIQUE (client_id, employee_number),
  UNIQUE (client_id, account_user_id)
);

CREATE TABLE public.portal_hr_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.portal_employees(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  check_in_at timestamptz,
  check_out_at timestamptz,
  mode text,
  location_ciphertext text,
  auto_closed boolean NOT NULL DEFAULT false,
  UNIQUE (employee_id, work_date)
);

CREATE TABLE public.portal_hr_attendance_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid NOT NULL REFERENCES public.portal_hr_attendance(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  old_ciphertext text NOT NULL,
  new_ciphertext text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.portal_hr_absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.portal_employees(id) ON DELETE CASCADE,
  type text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  half_day boolean NOT NULL DEFAULT false,
  reason_ciphertext text,
  status text NOT NULL DEFAULT 'pending',
  decided_by uuid,
  decision_note text
);

CREATE TABLE public.portal_hr_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.portal_employees(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  storage_path text NOT NULL,
  status text NOT NULL DEFAULT 'uploaded',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.portal_payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','sent')),
  closed_by uuid,
  closed_at timestamptz,
  sent_at timestamptz,
  UNIQUE (client_id, starts_on, ends_on)
);

CREATE TABLE public.portal_survey_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('nom035','climate')),
  template_version text NOT NULL,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  anonymous boolean NOT NULL DEFAULT true,
  min_group_size smallint NOT NULL CHECK (min_group_size >= 3),
  retention_until date
);

CREATE TABLE public.portal_survey_participation (
  campaign_id uuid NOT NULL REFERENCES public.portal_survey_campaigns(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.portal_employees(id) ON DELETE CASCADE,
  completed_at timestamptz,
  PRIMARY KEY (campaign_id, employee_id)
);

CREATE TABLE public.portal_survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.portal_survey_campaigns(id) ON DELETE CASCADE,
  anonymous_token_hash text NOT NULL,
  answers_ciphertext text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, anonymous_token_hash)
);

CREATE TABLE public.portal_system_nonces (
  direction text NOT NULL CHECK (direction IN ('central_to_os','os_to_central')),
  nonce text NOT NULL,
  request_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (direction, nonce)
);

CREATE TABLE public.portal_system_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL,
  client_id uuid REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  idempotency_key text UNIQUE NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX portal_memberships_client_idx ON public.portal_memberships(client_id, user_id) WHERE active;
CREATE INDEX portal_cfdi_period_idx ON public.portal_cfdi(client_id, issued_at, direction);
CREATE INDEX portal_tickets_client_idx ON public.portal_tickets(client_id, created_at DESC);
CREATE INDEX portal_hr_attendance_period_idx ON public.portal_hr_attendance(client_id, work_date);
CREATE INDEX portal_hr_absences_period_idx ON public.portal_hr_absences(client_id, starts_on, ends_on);

CREATE FUNCTION public.portal_has_company_role(_client_id uuid, _roles public.portal_role[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portal_memberships
    WHERE user_id = auth.uid() AND client_id = _client_id AND active AND role = ANY(_roles)
  )
$$;

CREATE FUNCTION public.portal_staff_has_company_access(_client_id uuid, _scope text DEFAULT 'administration') RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portal_staff_grants g
    JOIN public.portal_accounts a ON a.user_id = g.user_id
    WHERE g.user_id = auth.uid() AND g.client_id = _client_id AND g.scope = _scope
      AND a.is_kawiil_operator AND a.status = 'activa'
      AND g.starts_at <= now() AND g.ends_at > now() AND g.revoked_at IS NULL
  )
$$;

CREATE FUNCTION public.portal_is_employee(_client_id uuid, _employee_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portal_employees
    WHERE id = _employee_id AND client_id = _client_id AND account_user_id = auth.uid() AND status = 'active'
  )
$$;

CREATE FUNCTION public.portal_audit(_action text, _client_id uuid, _entity_type text, _entity_id text, _details jsonb, _actor uuid DEFAULT auth.uid()) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.portal_audit_log(client_id, actor_id, action, entity_type, entity_id, details)
  VALUES (_client_id, _actor, _action, _entity_type, _entity_id, COALESCE(_details, '{}'));
END
$$;

ALTER TABLE public.portal_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_cfdi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_hr_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_hr_absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_hr_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_survey_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_survey_participation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_survey_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_members_read ON public.portal_companies FOR SELECT TO authenticated USING (public.portal_has_company_role(id, ARRAY['administrador','rh','operativo','consulta','empleado']::public.portal_role[]));
CREATE POLICY own_account_read ON public.portal_accounts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY own_memberships_read ON public.portal_memberships FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY cfdi_authorized ON public.portal_cfdi FOR SELECT TO authenticated USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo','consulta']::public.portal_role[]));
CREATE POLICY tickets_authorized ON public.portal_tickets FOR SELECT TO authenticated USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo','consulta']::public.portal_role[]));
CREATE POLICY documents_authorized ON public.portal_documents FOR SELECT TO authenticated USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo','consulta']::public.portal_role[]));
CREATE POLICY threads_authorized ON public.portal_threads FOR SELECT TO authenticated USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo','consulta']::public.portal_role[]));
CREATE POLICY attachments_authorized ON public.portal_message_attachments FOR SELECT TO authenticated USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo','consulta']::public.portal_role[]));
CREATE POLICY employees_hr_or_self ON public.portal_employees FOR SELECT TO authenticated USING (public.portal_has_company_role(client_id, ARRAY['administrador','rh']::public.portal_role[]) OR account_user_id = auth.uid());
CREATE POLICY attendance_hr_or_self ON public.portal_hr_attendance FOR SELECT TO authenticated USING (public.portal_has_company_role(client_id, ARRAY['administrador','rh']::public.portal_role[]) OR public.portal_is_employee(client_id, employee_id));
CREATE POLICY absences_hr_or_self ON public.portal_hr_absences FOR SELECT TO authenticated USING (public.portal_has_company_role(client_id, ARRAY['administrador','rh']::public.portal_role[]) OR public.portal_is_employee(client_id, employee_id));
CREATE POLICY hr_documents_hr_or_self ON public.portal_hr_documents FOR SELECT TO authenticated USING (public.portal_has_company_role(client_id, ARRAY['administrador','rh']::public.portal_role[]) OR public.portal_is_employee(client_id, employee_id));
CREATE POLICY payroll_hr ON public.portal_payroll_periods FOR SELECT TO authenticated USING (public.portal_has_company_role(client_id, ARRAY['administrador','rh']::public.portal_role[]));
CREATE POLICY campaigns_company ON public.portal_survey_campaigns FOR SELECT TO authenticated USING (public.portal_has_company_role(client_id, ARRAY['administrador','rh','empleado']::public.portal_role[]));
CREATE POLICY participation_self ON public.portal_survey_participation FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.portal_employees e WHERE e.id = employee_id AND e.account_user_id = auth.uid()));

REVOKE ALL ON public.portal_survey_responses FROM anon, authenticated;
REVOKE ALL ON public.portal_system_nonces FROM anon, authenticated;
REVOKE ALL ON public.portal_system_outbox FROM anon, authenticated;
REVOKE ALL ON public.portal_audit_log FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_audit(text, uuid, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_has_company_role(uuid, public.portal_role[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_staff_has_company_access(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_is_employee(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_audit(text, uuid, text, text, jsonb, uuid) TO service_role;

INSERT INTO storage.buckets(id, name, public) VALUES ('portal', 'portal', false), ('portal-rh', 'portal-rh', false), ('portal-tickets', 'portal-tickets', false) ON CONFLICT (id) DO NOTHING;

COMMIT;
