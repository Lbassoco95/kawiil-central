-- PENDIENTE de confirmación explícita de Dirección. NO aplicada.
-- Registra la decisión del 1 nov 2026 como nota de la regla v1. No cambia parámetros, versión ni colores.
UPDATE public.mk_regla
SET descripcion = btrim(coalesce(descripcion, '') || ' ' ||
  'Umbral inicial, calculado con 26 piezas del 8 de septiembre al 29 de octubre de 2026 (media 35.7, mediana 15). Se recalcula el 30 de noviembre con las 44 publicaciones de Instagram que traiga la API; el cambio lo aprueba Dirección. ' ||
  'Observación para esa fecha: la línea roja de Instagram (15) coincide con la mediana, mientras en Facebook y LinkedIn queda por debajo.')
WHERE codigo = 'semaforo_instagram' AND version = 1;
