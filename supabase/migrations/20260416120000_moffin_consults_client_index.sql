-- Consultas recientes por cliente (dashboard SAT)
CREATE INDEX IF NOT EXISTS idx_moffin_consults_client_created
  ON public.moffin_consults (client_id, created_at DESC)
  WHERE client_id IS NOT NULL;
