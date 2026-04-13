-- Vínculo estable cliente Kawiil ↔ cliente Savio (GET/POST /customer en Edge).

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS savio_customer_id text NULL,
  ADD COLUMN IF NOT EXISTS savio_customer_linked_at timestamptz NULL;

COMMENT ON COLUMN public.clients.savio_customer_id IS 'Id del cliente en Savio (API); usado para facturas/pagos y alineación.';
COMMENT ON COLUMN public.clients.savio_customer_linked_at IS 'Última vez que se confirmó o guardó el vínculo con Savio en Kawiil.';

CREATE INDEX IF NOT EXISTS clients_organization_savio_customer_id_idx
  ON public.clients (organization_id)
  WHERE savio_customer_id IS NOT NULL;
