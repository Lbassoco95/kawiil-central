-- Opt-in: CFDI didácticos inventados (Aldea/Horizonte/Studio Norte/…).
-- NO aplicar en kawiil-os-demo prod (Bassoco reales). Solo ensayo/CI vacío.
-- Uso: PORTAL_DEMO_SEED_DIDACTIC=1 psql … -f kawiil-os/demo/seed-didactic.sql
-- Requiere empresa demo-espejo-fiscal ya creada por seed.sql.

BEGIN;

-- Facturas (todas is_test = true → marca DEMO).
INSERT INTO public.portal_cfdi (
  id, client_id, uuid, external_ref, direction, source, detail_status, version,
  issued_at, issuer_rfc, issuer_name, receiver_rfc, receiver_name,
  voucher_type, payment_form, payment_method, currency,
  subtotal, vat_transferred, vat_withheld, income_tax_withheld, total,
  sat_status, is_test, flags, category_name, category_status
) VALUES
(
  'd1000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  'D1111111-1111-4111-8111-111111111111',
  'D1111111-1111-4111-8111-111111111111',
  'emitida', 'central_mirror', 'complete', '4.0',
  '2026-09-05T16:00:00Z', 'BVS211101H55', 'BASSOCO, VEGA, SALAS, MORALES, SERVICIOS EMPRESARIALES SC',
  'CACX7605101P8', 'Constructora Aldea del Sol',
  'I', '03', 'PUE', 'MXN',
  10000, 1600, 0, 0, 11600,
  'vigente', true, '[]'::jsonb, 'Servicios profesionales', 'confirmada'
),
(
  'd1000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000001',
  'D2222222-2222-4222-8222-222222222222',
  'D2222222-2222-4222-8222-222222222222',
  'recibida', 'central_mirror', 'complete', '4.0',
  '2026-09-08T18:30:00Z', 'IIA040805DZ4', 'Nube Operativa MX',
  'BVS211101H55', 'BASSOCO, VEGA, SALAS, MORALES, SERVICIOS EMPRESARIALES SC',
  'I', '03', 'PUE', 'MXN',
  5000, 800, 53.33, 50, 5696.67,
  'vigente', true, '[]'::jsonb, 'Gastos operativos', 'confirmada'
),
(
  'd1000000-0000-4000-8000-000000000003',
  'd0000000-0000-4000-8000-000000000001',
  'D3333333-3333-4333-8333-333333333333',
  'D3333333-3333-4333-8333-333333333333',
  'recibida', 'central_mirror', 'metadata', '4.0',
  '2026-09-12T12:00:00Z', 'ABC010101AB1', 'Papelería del Centro',
  'BVS211101H55', 'BASSOCO, VEGA, SALAS, MORALES, SERVICIOS EMPRESARIALES SC',
  'I', NULL, 'PUE', 'MXN',
  2000, 0, 0, 0, 2320,
  'unknown', true, '[{"code":"metadata_only","reason":"Detalle pendiente (ejemplo)"}]'::jsonb,
  NULL, 'por_confirmar'
),
(
  'd1000000-0000-4000-8000-000000000004',
  'd0000000-0000-4000-8000-000000000001',
  'D4444444-4444-4444-8444-444444444444',
  'D4444444-4444-4444-8444-444444444444',
  'emitida', 'central_mirror', 'complete', '4.0',
  '2026-09-15T15:00:00Z', 'BVS211101H55', 'BASSOCO, VEGA, SALAS, MORALES, SERVICIOS EMPRESARIALES SC',
  'CACX7605101P8', 'Constructora Aldea del Sol',
  'I', '99', 'PPD', 'MXN',
  8000, 1280, 0, 0, 9280,
  'vigente', true, '[]'::jsonb, 'Servicios profesionales', 'confirmada'
),
-- PPD pendiente (sin complemento) — DEMO cobranza
(
  'd1000000-0000-4000-8000-000000000005',
  'd0000000-0000-4000-8000-000000000001',
  'D5555555-5555-4555-8555-555555555555',
  'D5555555-5555-4555-8555-555555555555',
  'emitida', 'central_mirror', 'complete', '4.0',
  '2026-09-18T14:00:00Z', 'BVS211101H55', 'BASSOCO, VEGA, SALAS, MORALES, SERVICIOS EMPRESARIALES SC',
  'GHC150918XY9', 'Grupo Horizonte Comercial',
  'I', '99', 'PPD', 'MXN',
  20000, 3200, 0, 0, 23200,
  'vigente', true, '[]'::jsonb, 'Servicios profesionales', 'confirmada'
),
-- PPD pagado completo + CFDI tipo P (complemento)
(
  'd1000000-0000-4000-8000-000000000006',
  'd0000000-0000-4000-8000-000000000001',
  'D6666666-6666-4666-8666-666666666666',
  'D6666666-6666-4666-8666-666666666666',
  'emitida', 'central_mirror', 'complete', '4.0',
  '2026-09-10T13:00:00Z', 'BVS211101H55', 'BASSOCO, VEGA, SALAS, MORALES, SERVICIOS EMPRESARIALES SC',
  'STN180201ZZ2', 'Studio Norte Consultores',
  'I', '99', 'PPD', 'MXN',
  5000, 800, 0, 0, 5800,
  'vigente', true, '[]'::jsonb, 'Servicios profesionales', 'confirmada'
),
(
  'd1000000-0000-4000-8000-000000000007',
  'd0000000-0000-4000-8000-000000000001',
  'D7777777-7777-4777-8777-777777777777',
  'D7777777-7777-4777-8777-777777777777',
  'emitida', 'central_mirror', 'complete', '4.0',
  '2026-09-22T16:00:00Z', 'BVS211101H55', 'BASSOCO, VEGA, SALAS, MORALES, SERVICIOS EMPRESARIALES SC',
  'STN180201ZZ2', 'Studio Norte Consultores',
  'P', NULL, NULL, 'MXN',
  0, 0, 0, 0, 5800,
  'vigente', true, '[{"code":"complemento_pago","reason":"Complemento de pago"}]'::jsonb,
  NULL, 'por_confirmar'
),
-- Complemento parcial del PPD D4444
(
  'd1000000-0000-4000-8000-000000000008',
  'd0000000-0000-4000-8000-000000000001',
  'D8888888-8888-4888-8888-888888888888',
  'D8888888-8888-4888-8888-888888888888',
  'emitida', 'central_mirror', 'complete', '4.0',
  '2026-09-20T17:00:00Z', 'BVS211101H55', 'BASSOCO, VEGA, SALAS, MORALES, SERVICIOS EMPRESARIALES SC',
  'CACX7605101P8', 'Constructora Aldea del Sol',
  'P', NULL, NULL, 'MXN',
  0, 0, 0, 0, 4640,
  'vigente', true, '[{"code":"complemento_pago","reason":"Complemento de pago parcial"}]'::jsonb,
  NULL, 'por_confirmar'
),
-- Nota de crédito (egreso tipo E) sobre D1111
(
  'd1000000-0000-4000-8000-000000000009',
  'd0000000-0000-4000-8000-000000000001',
  'D9999999-9999-4999-8999-999999999999',
  'D9999999-9999-4999-8999-999999999999',
  'emitida', 'central_mirror', 'complete', '4.0',
  '2026-09-25T11:00:00Z', 'BVS211101H55', 'BASSOCO, VEGA, SALAS, MORALES, SERVICIOS EMPRESARIALES SC',
  'CACX7605101P8', 'Constructora Aldea del Sol',
  'E', '03', 'PUE', 'MXN',
  1000, 160, 0, 0, 1160,
  'vigente', true,
  '[{"code":"nota_credito","reason":"Descuento sobre D1111111-1111-4111-8111-111111111111"}]'::jsonb,
  'Descuentos', 'confirmada'
);

-- product_service_key = ClaveProdServ (catálogo SAT); description = concepto libre.
INSERT INTO public.portal_cfdi_concepts (cfdi_id, product_service_key, description, quantity, unit_value, amount) VALUES
  -- OK: clave de servicios profesionales + concepto coherente
  ('d1000000-0000-4000-8000-000000000001', '80101500', 'Consultoría fiscal — septiembre', 1, 10000, 10000),
  -- FALTANTE: concepto legible, sin clave
  ('d1000000-0000-4000-8000-000000000002', NULL, 'Hospedaje en nube — septiembre', 1, 5000, 5000),
  -- NO CUADRA: descripción de servicio con clave de gasolina
  ('d1000000-0000-4000-8000-000000000004', '15101514', 'Consultoría fiscal — cobro en parcialidades', 1, 8000, 8000),
  ('d1000000-0000-4000-8000-000000000005', '80101500', 'Asesoría contable — proyecto anual', 1, 20000, 20000),
  -- FORMATO INVÁLIDO
  ('d1000000-0000-4000-8000-000000000006', 'ABC', 'Honorarios de auditoría interna', 1, 5000, 5000),
  ('d1000000-0000-4000-8000-000000000009', '80121500', 'Descuento por pronto pago', 1, 1000, 1000);

INSERT INTO public.portal_cfdi_tax_lines (cfdi_id, tax, kind, rate, factor, base, amount) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'IVA', 'transfer', 0.16, 'Tasa', 10000, 1600),
  ('d1000000-0000-4000-8000-000000000002', 'IVA', 'transfer', 0.16, 'Tasa', 5000, 800),
  ('d1000000-0000-4000-8000-000000000002', 'IVA', 'withholding', 0.106667, 'Tasa', 5000, 53.33),
  ('d1000000-0000-4000-8000-000000000002', 'ISR', 'withholding', 0.01, 'Tasa', 5000, 50),
  ('d1000000-0000-4000-8000-000000000004', 'IVA', 'transfer', 0.16, 'Tasa', 8000, 1280),
  ('d1000000-0000-4000-8000-000000000005', 'IVA', 'transfer', 0.16, 'Tasa', 20000, 3200),
  ('d1000000-0000-4000-8000-000000000006', 'IVA', 'transfer', 0.16, 'Tasa', 5000, 800),
  ('d1000000-0000-4000-8000-000000000009', 'IVA', 'transfer', 0.16, 'Tasa', 1000, 160);

-- Complementos: payment_cfdi = tipo P; related = factura PPD
INSERT INTO public.portal_payment_links (payment_cfdi_id, related_cfdi_id, paid_at, paid_amount)
VALUES
  (
    'd1000000-0000-4000-8000-000000000008',
    'd1000000-0000-4000-8000-000000000004',
    '2026-09-20T17:00:00Z',
    4640
  ),
  (
    'd1000000-0000-4000-8000-000000000007',
    'd1000000-0000-4000-8000-000000000006',
    '2026-09-22T16:00:00Z',
    5800
  );

INSERT INTO public.portal_fiscal_summaries (
  client_id, external_ref, period_year, period_month, iva_basis, payload, quality, published_at
) VALUES (
  'd0000000-0000-4000-8000-000000000001',
  '2026-09',
  2026, 9, 'cash_flow',
  '{
    "gasto_total": 8016.67,
    "gasto_mes_anterior": 4200,
    "ingreso_total": 20880,
    "ingreso_mes_anterior": 10000,
    "iva_estimado": 2466.67,
    "iva": {"trasladado": 2880, "acreditable": 800, "facturas_sin_desglose": 1},
    "retenciones": {
      "iva_retenido_a_la_empresa": 0,
      "iva_retenido_por_la_empresa": 53.33,
      "isr_retenido_a_la_empresa": 0,
      "isr_retenido_por_la_empresa": 50
    },
    "por_categoria": [
      {"categoria": "Servicios profesionales", "por_confirmar": false, "total": 20880, "facturas": 2},
      {"categoria": "Gastos operativos", "por_confirmar": false, "total": 5696.67, "facturas": 1},
      {"categoria": "por confirmar", "por_confirmar": true, "total": 2320, "facturas": 1}
    ],
    "espejo": true,
    "leyenda": "Cifras de demostración. DEMO — sin validez fiscal."
  }'::jsonb,
  '{
    "complete": 3,
    "metadata_only": 1,
    "quality_label": "media",
    "quality_note": "1 de 4 factura(s) solo traen metadatos; el IVA estimado no las incluye."
  }'::jsonb,
  '2026-09-21T12:00:00Z'
);


COMMIT;
