-- Semilla exacta del entorno de demostración del espejo fiscal (Corte 4).
-- Idempotente: borra la empresa demo-espejo-fiscal y la recrea con IDs fijos.
-- Sin RH, sin emisión, sin credenciales reales. Representa el cliente contable BASSOCO/VEGA/SALAS/MORALES SC; RFCs de CFDI siguen siendo sintéticos (DEMO) hasta publish real.
-- Requiere: migraciones baseline + espejo aplicadas.
-- Cuenta: si no existe auth.users d0000000-…-0101, crea filas mínimas compatibles
-- con el stub de CI; en Supabase real Polo debe crear antes el usuario Auth
-- demo.cliente@kawiil-demo.invalid (ver docs/portal/DEMO.md).

BEGIN;

-- Guardia: no correr contra un esquema que parezca central.
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL
     AND to_regclass('public.user_roles') IS NOT NULL
     AND to_regclass('public.clients') IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: este seed solo aplica en Kawiil OS (sin tablas de central)';
  END IF;
  IF to_regclass('public.portal_companies') IS NULL
     OR to_regclass('public.portal_fiscal_summaries') IS NULL THEN
    RAISE EXCEPTION 'ABORT: faltan migraciones baseline/espejo de Kawiil OS';
  END IF;
END $$;

-- Limpieza exacta de la empresa demo (cascadas en FKs).
DELETE FROM public.portal_companies WHERE external_ref = 'demo-espejo-fiscal';
DELETE FROM public.portal_accounts WHERE user_id = 'd0000000-0000-4000-8000-000000000101'::uuid;

-- Usuario Auth sintético (stub CI o entornos que permiten INSERT en auth.users).
INSERT INTO auth.users (id, email)
VALUES ('d0000000-0000-4000-8000-000000000101', 'demo.cliente@kawiil-demo.invalid')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.portal_companies (
  id, external_ref, name, rfc, tier, status,
  fiscal_enabled, tickets_enabled, rh_enabled, auto_publish_sat_documents, retention_years
) VALUES (
  'd0000000-0000-4000-8000-000000000001',
  'demo-espejo-fiscal',
  'Bassoco, Vega, Salas, Morales, Servicios Empresariales S.C.',
  'XAXX010101000',
  'premier',
  'active',
  true, false, false, true, 5
);

INSERT INTO public.portal_accounts (user_id, email, full_name, status)
VALUES (
  'd0000000-0000-4000-8000-000000000101',
  'demo.cliente@kawiil-demo.invalid',
  'Contacto demo · Bassoco SC',
  'activa'
);

INSERT INTO public.portal_memberships (user_id, client_id, role, active)
VALUES (
  'd0000000-0000-4000-8000-000000000101',
  'd0000000-0000-4000-8000-000000000001',
  'administrador',
  true
);

INSERT INTO public.portal_client_settings (
  client_id, emission_enabled, pac_sync_enabled, iva_basis, demo_mode
) VALUES (
  'd0000000-0000-4000-8000-000000000001',
  false, false, 'cash_flow', true
);

INSERT INTO public.portal_tax_profiles (
  client_id, rfc, legal_name, fiscal_regime, fiscal_postal_code, active, is_default
) VALUES (
  'd0000000-0000-4000-8000-000000000001',
  'XAXX010101000',
  'Bassoco, Vega, Salas, Morales, Servicios Empresariales S.C.',
  '601',
  '06600',
  true, true
);

-- Textos legales marcadores (aceptados para no bloquear el guion).
INSERT INTO public.portal_legal_documents (kind, version, title, body_md, is_placeholder)
VALUES
  ('aviso_privacidad', 'demo-1', 'Aviso de privacidad (DEMO)', 'Marcador de demostración. Sin validez legal.', true),
  ('terminos', 'demo-1', 'Términos (DEMO)', 'Marcador de demostración. Sin validez legal.', true)
ON CONFLICT (kind, version) DO NOTHING;

INSERT INTO public.portal_legal_acceptances (user_id, client_id, document_id, kind, version)
SELECT
  'd0000000-0000-4000-8000-000000000101'::uuid,
  'd0000000-0000-4000-8000-000000000001'::uuid,
  d.id, d.kind, d.version
FROM public.portal_legal_documents d
WHERE d.kind IN ('aviso_privacidad', 'terminos') AND d.version = 'demo-1'
ON CONFLICT DO NOTHING;

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
  '2026-09-05T16:00:00Z', 'XAXX010101000', 'Bassoco, Vega, Salas, Morales, Servicios Empresariales S.C.',
  'CACX7605101P8', 'Cliente Demo Uno',
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
  '2026-09-08T18:30:00Z', 'IIA040805DZ4', 'Proveedor Demo Servicios',
  'XAXX010101000', 'Bassoco, Vega, Salas, Morales, Servicios Empresariales S.C.',
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
  '2026-09-12T12:00:00Z', 'ABC010101AB1', 'Proveedor Solo Metadatos',
  'XAXX010101000', 'Bassoco, Vega, Salas, Morales, Servicios Empresariales S.C.',
  'I', NULL, 'PUE', 'MXN',
  2000, 0, 0, 0, 2320,
  'unknown', true, '[{"code":"metadata_only","reason":"Solo metadatos (DEMO)"}]'::jsonb,
  NULL, 'por_confirmar'
),
(
  'd1000000-0000-4000-8000-000000000004',
  'd0000000-0000-4000-8000-000000000001',
  'D4444444-4444-4444-8444-444444444444',
  'D4444444-4444-4444-8444-444444444444',
  'emitida', 'central_mirror', 'complete', '4.0',
  '2026-09-15T15:00:00Z', 'XAXX010101000', 'Bassoco, Vega, Salas, Morales, Servicios Empresariales S.C.',
  'CACX7605101P8', 'Cliente Demo Uno',
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
  '2026-09-18T14:00:00Z', 'XAXX010101000', 'Bassoco, Vega, Salas, Morales, Servicios Empresariales S.C.',
  'GHC150918XY9', 'Cliente Demo Dos',
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
  '2026-09-10T13:00:00Z', 'XAXX010101000', 'Bassoco, Vega, Salas, Morales, Servicios Empresariales S.C.',
  'STN180201ZZ2', 'Cliente Demo Tres',
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
  '2026-09-22T16:00:00Z', 'XAXX010101000', 'Bassoco, Vega, Salas, Morales, Servicios Empresariales S.C.',
  'STN180201ZZ2', 'Cliente Demo Tres',
  'P', NULL, NULL, 'MXN',
  0, 0, 0, 0, 5800,
  'vigente', true, '[{"code":"complemento_pago","reason":"Complemento de pago (DEMO)"}]'::jsonb,
  NULL, 'por_confirmar'
),
-- Complemento parcial del PPD D4444
(
  'd1000000-0000-4000-8000-000000000008',
  'd0000000-0000-4000-8000-000000000001',
  'D8888888-8888-4888-8888-888888888888',
  'D8888888-8888-4888-8888-888888888888',
  'emitida', 'central_mirror', 'complete', '4.0',
  '2026-09-20T17:00:00Z', 'XAXX010101000', 'Bassoco, Vega, Salas, Morales, Servicios Empresariales S.C.',
  'CACX7605101P8', 'Cliente Demo Uno',
  'P', NULL, NULL, 'MXN',
  0, 0, 0, 0, 4640,
  'vigente', true, '[{"code":"complemento_pago","reason":"Complemento parcial (DEMO)"}]'::jsonb,
  NULL, 'por_confirmar'
),
-- Nota de crédito (egreso tipo E) sobre D1111
(
  'd1000000-0000-4000-8000-000000000009',
  'd0000000-0000-4000-8000-000000000001',
  'D9999999-9999-4999-8999-999999999999',
  'D9999999-9999-4999-8999-999999999999',
  'emitida', 'central_mirror', 'complete', '4.0',
  '2026-09-25T11:00:00Z', 'XAXX010101000', 'Bassoco, Vega, Salas, Morales, Servicios Empresariales S.C.',
  'CACX7605101P8', 'Cliente Demo Uno',
  'E', '03', 'PUE', 'MXN',
  1000, 160, 0, 0, 1160,
  'vigente', true,
  '[{"code":"nota_credito","reason":"Descuento sobre D1111111-1111-4111-8111-111111111111 (DEMO)"}]'::jsonb,
  'Descuentos', 'confirmada'
);

-- product_service_key = ClaveProdServ (catálogo SAT); description = concepto libre.
INSERT INTO public.portal_cfdi_concepts (cfdi_id, product_service_key, description, quantity, unit_value, amount) VALUES
  -- OK: clave de servicios profesionales + concepto coherente
  ('d1000000-0000-4000-8000-000000000001', '80101500', 'Consultoría fiscal (DEMO)', 1, 10000, 10000),
  -- FALTANTE: concepto legible, sin clave
  ('d1000000-0000-4000-8000-000000000002', NULL, 'Servicio de nube (DEMO)', 1, 5000, 5000),
  -- NO CUADRA: descripción de servicio con clave de gasolina
  ('d1000000-0000-4000-8000-000000000004', '15101514', 'Proyecto PPD parcial — consultoría (DEMO)', 1, 8000, 8000),
  ('d1000000-0000-4000-8000-000000000005', '80101500', 'Proyecto PPD pendiente (DEMO)', 1, 20000, 20000),
  -- FORMATO INVÁLIDO
  ('d1000000-0000-4000-8000-000000000006', 'ABC', 'Proyecto PPD pagado (DEMO)', 1, 5000, 5000),
  ('d1000000-0000-4000-8000-000000000009', '80121500', 'Descuento por pronto pago (DEMO)', 1, 1000, 1000);

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

INSERT INTO public.portal_documents (
  client_id, external_ref, title, doc_type, obtained_at, period_year, period_month,
  opinion_result, storage_path, file_name, status, published_at
) VALUES
(
  'd0000000-0000-4000-8000-000000000001',
  'demo-csf-2026-09',
  'Constancia de situación fiscal (DEMO)',
  'constancia',
  '2026-09-01T10:00:00Z', 2026, 9, NULL,
  'demo/espejo/csf-2026-09.pdf', 'csf-demo.pdf', 'published', '2026-09-01T10:05:00Z'
),
(
  'd0000000-0000-4000-8000-000000000001',
  'demo-opinion-2026-09',
  'Opinión de cumplimiento 32-D (DEMO)',
  'opinion_cumplimiento',
  '2026-09-02T11:00:00Z', 2026, 9, 'positiva',
  'demo/espejo/opinion-2026-09.pdf', 'opinion-demo.pdf', 'published', '2026-09-02T11:05:00Z'
),
(
  'd0000000-0000-4000-8000-000000000001',
  'demo-decl-2026-08',
  'Declaración provisional IVA ago 2026 (DEMO)',
  'declaracion',
  '2026-09-10T09:00:00Z', 2026, 8, NULL,
  'demo/espejo/decl-2026-08.pdf', 'declaracion-demo.pdf', 'published', '2026-09-10T09:05:00Z'
);

INSERT INTO public.portal_fiscal_alerts (
  client_id, external_ref, alert_type, severity, title, detail, related_uuid, detected_at, published_at
) VALUES
(
  'd0000000-0000-4000-8000-000000000001',
  'demo-alerta-efos-1', 'efos', 'critical',
  'Posible coincidencia EFOS (DEMO)',
  'El RFC IIA040805DZ4 aparece en un listado de demostración. Sin validez fiscal.',
  'D2222222-2222-4222-8222-222222222222',
  '2026-09-18T08:00:00Z', '2026-09-18T08:05:00Z'
),
(
  'd0000000-0000-4000-8000-000000000001',
  'demo-alerta-cancel-1', 'cancelacion', 'warn',
  'Cancelación detectada (DEMO)',
  'Se simuló una cancelación de CFDI para el guion de demostración.',
  'D3333333-3333-4333-8333-333333333333',
  '2026-09-19T14:00:00Z', '2026-09-19T14:05:00Z'
);

INSERT INTO public.portal_sat_notifications (
  client_id, external_ref, title, body, notification_type, notified_at, obtained_at, published_at
) VALUES (
  'd0000000-0000-4000-8000-000000000001',
  'demo-sat-notif-1',
  'Aviso SAT de demostración',
  'Notificación sintética del buzón tributario. DEMO — sin validez fiscal.',
  'sat',
  '2026-09-07T12:00:00Z',
  '2026-09-07T12:05:00Z',
  '2026-09-07T12:10:00Z'
);

INSERT INTO public.portal_audit_log (client_id, action, entity_type, entity_id, details)
VALUES (
  'd0000000-0000-4000-8000-000000000001',
  'demo.seed',
  'demo',
  'demo-espejo-fiscal',
  '{"mark":"DEMO — sin validez fiscal","corte":4}'::jsonb
);

COMMIT;
