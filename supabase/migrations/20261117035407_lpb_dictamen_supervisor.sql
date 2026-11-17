-- Dictamen del agente supervisor sobre cada persona de la lista maestra de la LPB. Es solo una opinión para Dirección: NUNCA marca la persona como revisada (eso es solo de una persona).
ALTER TABLE public.lpb_personas
  ADD COLUMN IF NOT EXISTS revision_agente text CHECK (revision_agente IS NULL OR revision_agente IN ('coincide', 'no_coincide', 'no_verificable')),
  ADD COLUMN IF NOT EXISTS revision_agente_nota text CHECK (revision_agente_nota IS NULL OR char_length(revision_agente_nota) <= 600),
  ADD COLUMN IF NOT EXISTS revision_agente_en timestamptz;
CREATE INDEX IF NOT EXISTS idx_lpb_personas_dictamen ON public.lpb_personas (organization_id, revision_agente);
