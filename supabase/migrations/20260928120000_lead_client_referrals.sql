ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS referred_by_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.leads.referred_by_client_id IS
  'Cliente existente que recomendó al prospecto. NULL cuando llegó por canal propio o partner.';

CREATE INDEX IF NOT EXISTS idx_leads_referred_by_client
  ON public.leads (referred_by_client_id)
  WHERE referred_by_client_id IS NOT NULL;

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_single_referral_source;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_single_referral_source
  CHECK (partner_id IS NULL OR referred_by_client_id IS NULL);
