-- Tipo de cambio Banxico publicado desde kawiil-central (Edge banxico-fx)
-- hacia Kawiil OS. El portal solo lee; no consulta Banxico desde el navegador.
CREATE TABLE IF NOT EXISTS public.portal_market_fx (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serie text NOT NULL DEFAULT 'SF60653',
  label text NOT NULL DEFAULT 'Para solventar obligaciones',
  valor numeric(18, 6) NOT NULL,
  fecha date NOT NULL,
  fix_valor numeric(18, 6),
  fix_fecha date,
  published_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'banxico-fx',
  UNIQUE (serie, fecha)
);

CREATE INDEX IF NOT EXISTS portal_market_fx_fecha_idx
  ON public.portal_market_fx (fecha DESC);

ALTER TABLE public.portal_market_fx ENABLE ROW LEVEL SECURITY;

-- Lectura autenticada (header del portal); escritura solo service_role / publicación central.
DROP POLICY IF EXISTS portal_market_fx_select_authenticated ON public.portal_market_fx;
CREATE POLICY portal_market_fx_select_authenticated
  ON public.portal_market_fx
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE public.portal_market_fx IS
  'FX Banxico publicado por central (banxico-fx → HMAC/publish). OS no tira de Banxico.';
