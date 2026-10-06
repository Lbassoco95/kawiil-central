-- Expone voucher_type en portal_cfdi_v para Facturación (PPD / NC / complemento).
-- DROP+CREATE: CREATE OR REPLACE no permite insertar columna a mitad del orden.
DROP VIEW IF EXISTS public.portal_cfdi_v;
CREATE VIEW public.portal_cfdi_v
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.client_id,
  c.uuid,
  c.direction,
  c.source,
  c.detail_status,
  c.issued_at AS fecha,
  c.issuer_rfc AS rfc_emisor,
  c.issuer_name AS nombre_emisor,
  c.receiver_rfc AS rfc_receptor,
  c.receiver_name AS nombre_receptor,
  c.voucher_type,
  c.payment_form AS forma_pago,
  c.payment_method AS metodo_pago,
  c.subtotal,
  c.vat_transferred,
  c.vat_withheld,
  c.income_tax_withheld,
  c.total,
  c.sat_status,
  c.xml_path,
  c.pdf_path,
  c.is_test,
  c.flags,
  c.category_name,
  c.category_status,
  c.external_ref,
  c.created_at
FROM public.portal_cfdi c;

GRANT SELECT ON public.portal_cfdi_v TO authenticated, service_role;
