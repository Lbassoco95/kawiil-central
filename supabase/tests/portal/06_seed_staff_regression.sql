-- Datos sintéticos del EQUIPO para la regresión V2. Se cargan idénticos en una base
-- SIN las migraciones del portal y en otra CON ellas. Ids con prefijo d0, fechas fijas.
\set ON_ERROR_STOP 1
INSERT INTO public.organizations (id, name, slug) VALUES ('a0000000-0000-0000-0000-000000000001', 'Kawiil (prueba)', 'kawiil-prueba')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'regresion.g4@prueba.invalid', '{"full_name":"Regresión G4"}'),
  ('d0000000-0000-0000-0000-0000000000a2', 'regresion.g1@prueba.invalid', '{"full_name":"Regresión G1"}');
UPDATE public.user_roles SET role = 'transformador' WHERE user_id = 'd0000000-0000-0000-0000-0000000000a1';
UPDATE public.profiles SET created_at = '2026-01-01', updated_at = '2026-01-01' WHERE user_id::text LIKE 'd0%';
INSERT INTO public.clients (id, organization_id, name, rfc, created_at, updated_at) VALUES
  ('d0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001', 'Regresión Cliente 1', 'REG010101AAA', '2026-01-01', '2026-01-01'),
  ('d0000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-000000000001', 'Regresión Cliente 2', 'REG020202BBB', '2026-01-01', '2026-01-01');
INSERT INTO public.tasks (id, organization_id, client_id, title, created_at, updated_at) VALUES
  ('d0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000c1', 'Tarea regresión', '2026-01-01', '2026-01-01');
INSERT INTO public.fis_tax_profiles (id, organization_id, client_id, rfc, razon_social, cp_fiscal, regimen_fiscal, is_default, created_at, updated_at)
VALUES ('d0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000c1',
        'REG010101AAA', 'REGRESION CLIENTE 1', '01000', '601', true, '2026-01-01', '2026-01-01');
INSERT INTO public.fis_receipts (id, organization_id, client_id, file_path, file_hash, status, created_at, updated_at)
VALUES ('d0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000c1',
        'a0000000-0000-0000-0000-000000000001/juun/clients/d0000000-0000-0000-0000-0000000000c1/2026/01/receipts/r.jpg', repeat('d', 64), 'manual_queue', '2026-01-01', '2026-01-01');
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', 'regresion/contrato.pdf');
