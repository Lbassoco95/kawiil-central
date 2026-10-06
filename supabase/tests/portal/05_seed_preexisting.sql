-- Datos sintéticos que «ya existían» antes del portal (para probar la migración con datos).
-- ids de filas con prefijo e0 / f0 y objetos de storage bajo «previo/».
\set ON_ERROR_STOP 1
INSERT INTO public.organizations (id, name, slug) VALUES ('a0000000-0000-0000-0000-000000000001', 'Kawiil (prueba)', 'kawiil-prueba')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'previo.staff@prueba.invalid', '{"full_name":"Staff previo"}'),
  ('f0000000-0000-0000-0000-000000000002', 'previo.staff2@prueba.invalid', '{"full_name":"Staff previo 2"}');
INSERT INTO public.clients (id, organization_id, name, rfc, responsible_user_id) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Cliente previo 1', 'PRE010101AAA', 'f0000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Cliente previo 2', 'PRE020202BBB', NULL);
INSERT INTO public.fis_receipts (id, organization_id, client_id, file_path, file_hash, status, merchant_id)
SELECT 'e0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
       'a0000000-0000-0000-0000-000000000001/juun/clients/e0000000-0000-0000-0000-000000000001/2026/08/receipts/previo.jpg',
       repeat('0', 64), 'manual_queue', id FROM public.fis_merchants WHERE slug = 'pemex';
INSERT INTO public.client_sat_certificates (id, organization_id, client_id, cert_type, cert_ciphertext, key_ciphertext, cert_not_after)
VALUES ('e0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
        'fiel', 'CIFRADO-PREVIO', 'CIFRADO-PREVIO', now() + interval '1 year');
INSERT INTO public.documents (id, organization_id, client_id, name) VALUES
  ('e0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Documento previo');
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', 'previo/archivo.pdf'), ('juun', 'previo/ticket.jpg');
