-- Cola de visto bueno de la lista maestra de la LPB: quién y cuándo verificó cada persona contra el PDF, y las que se devuelven para corregir.
ALTER TABLE public.lpb_personas
  ADD COLUMN IF NOT EXISTS revisado_en timestamptz,
  ADD COLUMN IF NOT EXISTS revisado_por uuid,
  ADD COLUMN IF NOT EXISTS por_corregir boolean NOT NULL DEFAULT false,                    -- Dirección la devolvió: el dato no coincide con el PDF
  ADD COLUMN IF NOT EXISTS revision_nota text CHECK (revision_nota IS NULL OR char_length(revision_nota) <= 500);
CREATE INDEX IF NOT EXISTS idx_lpb_personas_revision ON public.lpb_personas (organization_id, revisado, por_corregir);
