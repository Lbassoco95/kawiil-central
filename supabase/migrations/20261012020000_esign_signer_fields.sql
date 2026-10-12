-- Posición de la firma de cada firmante dentro del PDF.
-- fields: [{ "page": 1, "x": 0.1, "y": 0.8, "w": 0.28, "h": 0.07 }]
-- Coordenadas normalizadas 0..1 con origen arriba-izquierda; page es base 1.
-- Ya aplicada en producción (idempotente).
ALTER TABLE public.esign_signers
  ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '[]'::jsonb;
