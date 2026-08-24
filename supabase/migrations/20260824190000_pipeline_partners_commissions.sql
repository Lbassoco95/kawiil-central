-- =================================================================
-- Pipeline: partners / convenios y sus comisiones
--
-- Un "partner" NO es un lead: es un tercero (despacho aliado, convenio,
-- referidor) que nos manda prospectos. Vive en su propia tabla y cada lead
-- puede venir "por parte de" un partner, para responder dos preguntas:
--   1) ¿qué clientes llegaron por cada partner?
--   2) ¿cuánto le corresponde de comisión según el arreglo pactado?
--
-- El arreglo se guarda en el partner (tipo, valor, base de cálculo, plazos) y
-- se CONGELA en cada comisión al momento de devengarla, para que renegociar el
-- convenio no altere el histórico.
-- =================================================================

-- ── 1. Partners / convenios ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pipeline_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'partner'
    CHECK (kind IN ('partner', 'convenio', 'alianza', 'referidor', 'otro')),
  status text NOT NULL DEFAULT 'activo'
    CHECK (status IN ('activo', 'pausado', 'terminado')),

  -- Contacto
  contact_name text,
  email text,
  phone text,
  whatsapp text,
  website text,
  country text,

  -- Arreglo comercial
  commission_type text NOT NULL DEFAULT 'sin_comision'
    CHECK (commission_type IN ('porcentaje', 'monto_fijo', 'sin_comision', 'intercambio', 'otro')),
  commission_value numeric,
  commission_base text NOT NULL DEFAULT 'primer_pago'
    CHECK (commission_base IN ('primer_pago', 'contrato_total', 'mensual_recurrente', 'por_lead')),
  commission_currency text NOT NULL DEFAULT 'MXN'
    CHECK (commission_currency IN ('MXN', 'USD')),
  payment_terms text,
  agreement_start date,
  agreement_end date,
  agreement_notes text,

  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pipeline_partners IS
  'Terceros que nos refieren prospectos (partners, convenios, alianzas) y el arreglo de comisión pactado.';
COMMENT ON COLUMN public.pipeline_partners.commission_base IS
  'Sobre qué se calcula: primer pago, contrato total, mensualidad recurrente o monto fijo por lead entregado.';

CREATE INDEX IF NOT EXISTS idx_pipeline_partners_org
  ON public.pipeline_partners (organization_id, status);

DROP TRIGGER IF EXISTS update_pipeline_partners_updated_at ON public.pipeline_partners;
CREATE TRIGGER update_pipeline_partners_updated_at
  BEFORE UPDATE ON public.pipeline_partners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 2. Atribución del lead al partner ───────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.pipeline_partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_notes text;

COMMENT ON COLUMN public.leads.partner_id IS
  'Partner / convenio que refirió al prospecto. NULL = llegó por canal propio.';

CREATE INDEX IF NOT EXISTS idx_leads_partner
  ON public.leads (partner_id)
  WHERE partner_id IS NOT NULL;

-- ── 3. Comisiones devengadas ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.pipeline_partners(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,

  -- Snapshot del arreglo al momento de devengar (no se recalcula después).
  commission_type text NOT NULL,
  commission_value numeric,
  commission_base text NOT NULL,
  base_amount numeric,
  amount numeric,
  currency text NOT NULL DEFAULT 'MXN',

  status text NOT NULL DEFAULT 'devengada'
    CHECK (status IN ('devengada', 'facturada', 'pagada', 'cancelada')),
  accrued_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Una comisión por lead: el cliente se refiere (y se paga) una sola vez.
  UNIQUE (lead_id)
);

COMMENT ON TABLE public.partner_commissions IS
  'Comisión devengada por cada lead referido que se convirtió. El arreglo queda congelado en la fila.';

CREATE INDEX IF NOT EXISTS idx_partner_commissions_partner
  ON public.partner_commissions (partner_id, status);
CREATE INDEX IF NOT EXISTS idx_partner_commissions_org
  ON public.partner_commissions (organization_id);

DROP TRIGGER IF EXISTS update_partner_commissions_updated_at ON public.partner_commissions;
CREATE TRIGGER update_partner_commissions_updated_at
  BEFORE UPDATE ON public.partner_commissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 4. Devengo automático al convertir el lead ──────────────────────
-- Cuando un lead referido llega a la etapa terminal de conversión, se crea su
-- comisión con el arreglo vigente. Si el arreglo es 'otro' el monto queda en
-- NULL para capturarlo a mano; 'sin_comision'/'intercambio' devengan 0 (sirve
-- para medir el aporte del partner aunque no haya pago).
CREATE OR REPLACE FUNCTION public.accrue_partner_commission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_slug text;
  v_partner public.pipeline_partners;
  v_base numeric;
  v_amount numeric;
  v_currency text;
BEGIN
  IF NEW.partner_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT slug INTO v_stage_slug
  FROM public.pipeline_stages
  WHERE id = NEW.stage_id;

  IF v_stage_slug IS DISTINCT FROM 'convertido' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_partner FROM public.pipeline_partners WHERE id = NEW.partner_id;
  IF v_partner.id IS NULL THEN
    RETURN NEW;
  END IF;

  v_base := NEW.estimated_value;

  IF v_partner.commission_type = 'porcentaje' THEN
    -- El valor estimado del lead está en MXN, así que el porcentaje también.
    v_amount := CASE
      WHEN v_base IS NULL OR v_partner.commission_value IS NULL THEN NULL
      ELSE ROUND(v_base * v_partner.commission_value / 100.0, 2)
    END;
    v_currency := 'MXN';
  ELSIF v_partner.commission_type = 'monto_fijo' THEN
    v_amount := v_partner.commission_value;
    v_currency := v_partner.commission_currency;
  ELSIF v_partner.commission_type IN ('sin_comision', 'intercambio') THEN
    v_amount := 0;
    v_currency := v_partner.commission_currency;
  ELSE
    v_amount := NULL;  -- 'otro': se captura a mano
    v_currency := v_partner.commission_currency;
  END IF;

  INSERT INTO public.partner_commissions (
    organization_id, partner_id, lead_id,
    commission_type, commission_value, commission_base,
    base_amount, amount, currency
  ) VALUES (
    NEW.organization_id, NEW.partner_id, NEW.id,
    v_partner.commission_type, v_partner.commission_value, v_partner.commission_base,
    v_base, v_amount, v_currency
  )
  ON CONFLICT (lead_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_accrue_partner_commission ON public.leads;
CREATE TRIGGER trg_leads_accrue_partner_commission
  AFTER INSERT OR UPDATE OF stage_id, partner_id, estimated_value ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.accrue_partner_commission();

-- ── 5. RLS (mismo patrón que el resto del pipeline) ─────────────────
ALTER TABLE public.pipeline_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_partners_select" ON public.pipeline_partners;
CREATE POLICY "pipeline_partners_select"
  ON public.pipeline_partners FOR SELECT TO authenticated
  USING (organization_id = public.user_pipeline_org_id());

DROP POLICY IF EXISTS "pipeline_partners_insert" ON public.pipeline_partners;
CREATE POLICY "pipeline_partners_insert"
  ON public.pipeline_partners FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_pipeline_org_id());

DROP POLICY IF EXISTS "pipeline_partners_update" ON public.pipeline_partners;
CREATE POLICY "pipeline_partners_update"
  ON public.pipeline_partners FOR UPDATE TO authenticated
  USING (organization_id = public.user_pipeline_org_id());

DROP POLICY IF EXISTS "pipeline_partners_delete" ON public.pipeline_partners;
CREATE POLICY "pipeline_partners_delete"
  ON public.pipeline_partners FOR DELETE TO authenticated
  USING (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );

ALTER TABLE public.partner_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partner_commissions_select" ON public.partner_commissions;
CREATE POLICY "partner_commissions_select"
  ON public.partner_commissions FOR SELECT TO authenticated
  USING (organization_id = public.user_pipeline_org_id());

DROP POLICY IF EXISTS "partner_commissions_insert" ON public.partner_commissions;
CREATE POLICY "partner_commissions_insert"
  ON public.partner_commissions FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_pipeline_org_id());

DROP POLICY IF EXISTS "partner_commissions_update" ON public.partner_commissions;
CREATE POLICY "partner_commissions_update"
  ON public.partner_commissions FOR UPDATE TO authenticated
  USING (organization_id = public.user_pipeline_org_id());

DROP POLICY IF EXISTS "partner_commissions_delete" ON public.partner_commissions;
CREATE POLICY "partner_commissions_delete"
  ON public.partner_commissions FOR DELETE TO authenticated
  USING (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );
