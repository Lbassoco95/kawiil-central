-- Identidad del renglón del banco que confirmó cada registro: volver a cargar el mismo estado de cuenta es idempotente
-- (no vuelve a confirmar registros duplicados con el mismo renglón del banco).
ALTER TABLE public.finance_movements ADD COLUMN IF NOT EXISTS bank_row_hash text;
CREATE INDEX IF NOT EXISTS finance_movements_bank_row_hash_idx
  ON public.finance_movements (account_id, bank_row_hash) WHERE bank_row_hash IS NOT NULL;

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
      bank_description = i->>'desc',
      bank_row_hash = NULLIF(i->>'hash', '')
    FROM jsonb_array_elements(p_items) AS i
    WHERE m.id = (i->>'id')::uuid
    RETURNING 1
  )
  SELECT count(*)::int FROM upd;
$$;
