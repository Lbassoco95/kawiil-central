-- Finanzas: conciliación contra el estado de cuenta del banco.
-- Cada movimiento recuerda de dónde vino (contable, captura, pegado, manual o banco) y si el banco ya lo confirmó.

ALTER TABLE public.finance_movements
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'contable'
    CHECK (origin IN ('banco', 'contable', 'captura', 'pegado', 'manual')),
  ADD COLUMN IF NOT EXISTS bank_confirmed_at timestamptz,   -- el estado de cuenta del banco lo confirmó
  ADD COLUMN IF NOT EXISTS bank_description text,           -- cómo lo llama el banco
  ADD COLUMN IF NOT EXISTS has_record boolean NOT NULL DEFAULT true; -- false: lo trajo el banco y nadie lo había registrado

ALTER TABLE public.finance_import_batches DROP CONSTRAINT IF EXISTS finance_import_batches_source_check;
ALTER TABLE public.finance_import_batches
  ADD CONSTRAINT finance_import_batches_source_check
  CHECK (source IN ('excel', 'pegado', 'manual', 'banco', 'contable', 'captura'));

CREATE INDEX IF NOT EXISTS finance_movements_acct_date_idx
  ON public.finance_movements (organization_id, account_id, movement_date);

-- Marca en bloque los movimientos registrados que el banco confirma (respeta RLS: SECURITY INVOKER).
CREATE OR REPLACE FUNCTION public.finance_apply_bank_matches(p_items jsonb)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH upd AS (
    UPDATE public.finance_movements m SET
      bank_confirmed_at = now(),
      reported_balance = COALESCE(NULLIF(i->>'balance', '')::numeric, m.reported_balance),
      row_seq = COALESCE(NULLIF(i->>'seq', '')::integer, m.row_seq),
      bank_description = i->>'desc'
    FROM jsonb_array_elements(p_items) AS i
    WHERE m.id = (i->>'id')::uuid
    RETURNING 1
  )
  SELECT count(*)::int FROM upd;
$$;
