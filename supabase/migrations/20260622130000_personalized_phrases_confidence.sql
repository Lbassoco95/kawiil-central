-- Columna para registrar el nivel de confianza de la cita generada por la IA.
-- alta = encontrada en 2+ fuentes; media = 1 fuente; original = reflexión creada por la IA sin atribución real.
ALTER TABLE public.personalized_phrases
  ADD COLUMN IF NOT EXISTS verification_confidence TEXT;
