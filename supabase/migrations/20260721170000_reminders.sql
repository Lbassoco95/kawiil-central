-- RF-03: recordatorios de cobranza automáticos.
-- Plantillas editables (reminder_template), bitácora de envíos (reminder_log) y
-- pausa por cliente (savio_customers.reminders_paused). El envío real lo hace la
-- Edge Function reminder-cron a través del servicio notify.
--
-- Seguridad: el envío está APAGADO por defecto; requiere REMINDERS_ENABLED='true'
-- en los secrets. Sin ese flag, la función corre en modo dry-run (registra lo que
-- enviaría con estado 'omitido', sin mandar nada).

-- ── Plantillas editables ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reminder_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  -- antes_venc | al_vencer | atraso
  stage text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminder_template_stage_check CHECK (stage IN ('antes_venc','al_vencer','atraso')),
  CONSTRAINT reminder_template_org_stage_uniq UNIQUE (organization_id, stage)
);

ALTER TABLE public.reminder_template ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance see reminder templates" ON public.reminder_template;
CREATE POLICY "Finance see reminder templates" ON public.reminder_template
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));
DROP POLICY IF EXISTS "Finance manage reminder templates" ON public.reminder_template;
CREATE POLICY "Finance manage reminder templates" ON public.reminder_template
  FOR ALL TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP TRIGGER IF EXISTS set_reminder_template_updated_at ON public.reminder_template;
CREATE TRIGGER set_reminder_template_updated_at BEFORE UPDATE ON public.reminder_template
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Semilla de plantillas por defecto para cada organización existente.
INSERT INTO public.reminder_template (organization_id, stage, subject, body)
SELECT o.id, v.stage, v.subject, v.body
FROM public.organizations o
CROSS JOIN (VALUES
  ('antes_venc',
   'Recordatorio: tu factura {folio} vence pronto',
   'Hola {cliente}, te recordamos que tu factura {folio} por {monto} vence el {vencimiento} (en {dias} días). Agradecemos tu pago puntual.'),
  ('al_vencer',
   'Tu factura {folio} vence hoy',
   'Hola {cliente}, tu factura {folio} por {monto} vence hoy {vencimiento}. Si ya realizaste el pago, ignora este mensaje.'),
  ('atraso',
   'Factura {folio} vencida ({dias} días)',
   'Hola {cliente}, tu factura {folio} por {monto} venció el {vencimiento} y presenta {dias} días de atraso. Te pedimos regularizar el pago; quedamos a tus órdenes.')
) AS v(stage, subject, body)
ON CONFLICT (organization_id, stage) DO NOTHING;

-- ── Pausa de recordatorios por cliente ──────────────────────────────────────────
ALTER TABLE public.savio_customers
  ADD COLUMN IF NOT EXISTS reminders_paused boolean NOT NULL DEFAULT false;

-- Permite a Finanzas actualizar la pausa (las tablas savio_* solo tenían SELECT).
DROP POLICY IF EXISTS "Finance update savio customers" ON public.savio_customers;
CREATE POLICY "Finance update savio customers" ON public.savio_customers
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

-- ── Bitácora de recordatorios ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  savio_invoice_id text NOT NULL,
  invoice_id uuid REFERENCES public.savio_invoices(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  customer_savio_id text,
  stage text NOT NULL,
  canal text NOT NULL DEFAULT 'email',
  destino text,
  -- enviado | error | omitido
  estado text NOT NULL DEFAULT 'enviado',
  error text,
  sent_on date NOT NULL DEFAULT CURRENT_DATE,
  enviado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminder_log_stage_check CHECK (stage IN ('antes_venc','al_vencer','atraso')),
  CONSTRAINT reminder_log_estado_check CHECK (estado IN ('enviado','error','omitido'))
);
CREATE INDEX IF NOT EXISTS idx_reminder_log_org ON public.reminder_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminder_log_invoice ON public.reminder_log (organization_id, savio_invoice_id);
-- Evita duplicar un mismo recordatorio (invoice+stage) el mismo día (solo envíos reales).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_reminder_log_sent
  ON public.reminder_log (organization_id, savio_invoice_id, stage, sent_on)
  WHERE estado = 'enviado';

ALTER TABLE public.reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance see reminder log" ON public.reminder_log;
CREATE POLICY "Finance see reminder log" ON public.reminder_log
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));
