-- =================================================================
-- ROLLBACK de supabase/migrations/20260825034528_juun_merchants_seed.sql
-- Proyecto: qppfampapbxdgednkofc  ·  Fecha: 2026-08-24  ·  Módulo: Ju'un
--
-- Quita solo los 15 comercios de la semilla; deja intactos los que se hayan
-- dado de alta después. Idempotente.
--
-- Efectos en cascada:
--   · fis_recipe_versions de esos comercios se borra (ON DELETE CASCADE).
--   · fis_receipts.merchant_id de tickets ya cargados queda en NULL
--     (ON DELETE SET NULL): los tickets NO se pierden, quedan sin comercio.
--
-- Si vas a deshacer el Bloque 1 completo no hace falta correr esto: el
-- rollback del esquema borra la tabla entera.
-- =================================================================

-- Guardado contra la tabla inexistente: si ya corriste el rollback del esquema,
-- este script no debe tronar, solo no tener nada que hacer.
DO $$
BEGIN
  IF to_regclass('public.fis_merchants') IS NULL THEN
    RAISE NOTICE 'juun: fis_merchants no existe, nada que borrar';
    RETURN;
  END IF;

  DELETE FROM public.fis_merchants
  WHERE slug IN (
    'generico_qr', 'oxxo', 'seven_eleven', 'walmart', 'soriana', 'chedraui',
    'home_depot', 'costco', 'pemex', 'shell', 'bp', 'cinepolis', 'cinemex',
    'uber', 'casetas'
  );
END $$;
