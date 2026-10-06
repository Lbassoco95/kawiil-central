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

-- Prod demo Bassoco: NO sembrar CFDI inventados (Aldea/Horizonte/etc.).
-- Si ya hay satgo_facfiel reales, abortar para no borrar/contaminar.
DO $$
DECLARE
  n_satgo int;
BEGIN
  SELECT count(*) INTO n_satgo
  FROM public.portal_cfdi c
  JOIN public.portal_companies pc ON pc.id = c.client_id
  WHERE pc.external_ref = 'demo-espejo-fiscal' AND c.source = 'satgo_facfiel';
  IF n_satgo > 0 THEN
    RAISE EXCEPTION 'ABORT: demo-espejo-fiscal ya tiene % CFDI satgo_facfiel. No correr seed.sql (borra la empresa). Usa seed solo en ensayo vacío; didácticos → seed-didactic.sql', n_satgo;
  END IF;
END $$;

-- CFDI / conceptos / payment_links didácticos: ver kawiil-os/demo/seed-didactic.sql
-- (opt-in CI/ensayo). El demo prod Bassoco usa solo SatGo publicados.

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
  'BASSOCO, VEGA, SALAS, MORALES, SERVICIOS EMPRESARIALES SC',
  'BVS211101H55',
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
  'BVS211101H55',
  'BASSOCO, VEGA, SALAS, MORALES, SERVICIOS EMPRESARIALES SC',
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
