-- =================================================================
-- Ju'un — semilla del catálogo de comercios (15)
--
-- IDEMPOTENTE y re-ejecutable: vamos a agregar comercios seguido.
--
-- Reparto de propiedad de las columnas, para que re-correr el seed nunca pise
-- trabajo posterior:
--   · El seed manda sobre lo DESCRIPTIVO: name, aliases, rfc_emisor,
--     portal_url, required_fields, window_type, window_days.
--   · El seed NO toca lo OPERATIVO tras el primer INSERT: recipe,
--     recipe_version, method, self_heal_enabled, active. Eso lo mueven el
--     humano y el worker, y una re-corrida no puede devolver un comercio ya
--     funcionando a method='manual'.
--
-- Todos nacen con recipe = NULL, recipe_version = 0 y method = 'manual':
-- el reconocimiento de los portales reales es trabajo humano (Bloque 3.6).
-- No hay un solo selector ni una sola URL adivinada aquí: portal_url y
-- rfc_emisor quedan NULL hasta que alguien entre al portal y los documente.
--
-- Los `aliases` son las variantes del nombre tal como se imprimen en los
-- tickets. De esto depende el match automático del comercio en el Bloque 2;
-- se afinan con tickets reales.
--
-- Reglas de formato que el brief fija y que valida el Bloque 2, anotadas aquí
-- para no perderlas: Walmart exige `tc` de 20 dígitos y `tr` de 5 dígitos.
--
-- Rollback: migrations/2026-08-24_juun_merchants_seed.rollback.sql
-- =================================================================

INSERT INTO public.fis_merchants
  (slug, name, aliases, required_fields, window_type, window_days, method)
VALUES
  ('generico_qr', 'Comercio con QR de facturación',
   '{}'::text[],
   '{"url_qr":"url"}'::jsonb,
   'days', 30, 'manual'),

  ('oxxo', 'OXXO',
   ARRAY['OXXO', 'CADENA COMERCIAL OXXO', 'OXXO GAS'],
   '{"fecha":"date","folio_venta":"num","id_venta":"num","total":"money"}'::jsonb,
   'days', 7, 'manual'),

  ('seven_eleven', '7-Eleven',
   ARRAY['7-ELEVEN', '7 ELEVEN', 'SEVEN ELEVEN', '7ELEVEN'],
   '{"fecha":"date","folio":"num","total":"money"}'::jsonb,
   'days', 7, 'manual'),

  ('walmart', 'Walmart / Bodega Aurrerá / Sam''s',
   ARRAY['WALMART', 'WAL-MART', 'WAL MART', 'WALMART EXPRESS', 'WALMART SUPERCENTER',
         'BODEGA AURRERA', 'BODEGA AURRERÁ', 'MI BODEGA AURRERA', 'BODEGA EXPRESS',
         'SAMS CLUB', 'SAM''S CLUB'],
   '{"tc":"num","tr":"num"}'::jsonb,
   'end_of_month', NULL, 'manual'),

  ('soriana', 'Soriana',
   ARRAY['SORIANA', 'SORIANA HIPER', 'SORIANA SUPER', 'SORIANA MERCADO', 'CITY CLUB'],
   '{"tienda":"text","folio":"num","fecha":"date","total":"money"}'::jsonb,
   'end_of_month', NULL, 'manual'),

  ('chedraui', 'Chedraui',
   ARRAY['CHEDRAUI', 'SUPER CHEDRAUI', 'SELECTO CHEDRAUI'],
   '{"folio":"num","fecha":"date","total":"money"}'::jsonb,
   'end_of_month', NULL, 'manual'),

  ('home_depot', 'Home Depot',
   ARRAY['HOME DEPOT', 'THE HOME DEPOT', 'HOMEDEPOT'],
   '{"folio":"num","fecha":"date","total":"money"}'::jsonb,
   'end_of_month', NULL, 'manual'),

  ('costco', 'Costco',
   ARRAY['COSTCO', 'COSTCO WHOLESALE', 'COSTCO DE MEXICO'],
   '{"folio":"num","membresia":"num"}'::jsonb,
   'end_of_month', NULL, 'manual'),

  ('pemex', 'Pemex y franquicias',
   ARRAY['PEMEX', 'PETROLEOS MEXICANOS', 'ESTACION DE SERVICIO'],
   '{"estacion":"text","folio":"num","fecha":"date"}'::jsonb,
   'days', 7, 'manual'),

  ('shell', 'Shell',
   ARRAY['SHELL', 'SHELL MEXICO'],
   '{"estacion":"text","folio":"num","fecha":"date"}'::jsonb,
   'days', 5, 'manual'),

  ('bp', 'BP',
   ARRAY['BP', 'BP MEXICO'],
   '{"estacion":"text","folio":"num","fecha":"date"}'::jsonb,
   'days', 5, 'manual'),

  ('cinepolis', 'Cinépolis',
   ARRAY['CINEPOLIS', 'CINÉPOLIS', 'CINEPOLIS VIP'],
   '{"folio":"num","total":"money"}'::jsonb,
   'days', 2, 'manual'),

  ('cinemex', 'Cinemex',
   ARRAY['CINEMEX', 'CINEMEX PLATINO'],
   '{"folio":"num","total":"money"}'::jsonb,
   'days', 1, 'manual'),

  -- Uber factura desde la cuenta del usuario, no desde un folio impreso.
  ('uber', 'Uber',
   ARRAY['UBER', 'UBER BV', 'UBER EATS'],
   '{}'::jsonb,
   'days', 60, 'manual'),

  -- El ticket de caseta no es comprobante fiscal: la factura sale del estado
  -- de cuenta del TAG. Por eso nace 'unsupported', no 'manual'.
  ('casetas', 'Casetas / IAVE',
   ARRAY['IAVE', 'CAPUFE', 'TELEVIA', 'PASE', 'CASETA'],
   '{}'::jsonb,
   'not_applicable', NULL, 'unsupported')

ON CONFLICT (slug) DO UPDATE SET
  name            = EXCLUDED.name,
  aliases         = EXCLUDED.aliases,
  required_fields = EXCLUDED.required_fields,
  window_type     = EXCLUDED.window_type,
  window_days     = EXCLUDED.window_days,
  updated_at      = now();
