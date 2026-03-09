-- Tabla principal para datos extraídos de documentos
CREATE TABLE public.extracted_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  
  document_type text NOT NULL DEFAULT 'unknown',
  extraction_status text NOT NULL DEFAULT 'pending',
  extraction_model text,
  extraction_error text,
  processing_time_ms integer,
  
  extracted_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  fiscal_period text,
  rfc_emisor text,
  rfc_receptor text,
  total_amount numeric,
  tax_amount numeric,
  currency text DEFAULT 'MXN',
  document_date date,
  
  uuid_fiscal text,
  cfdi_type text,
  
  declaration_type text,
  isr_amount numeric,
  iva_amount numeric,
  retenciones_amount numeric,
  
  ai_summary text,
  ai_observations jsonb DEFAULT '[]'::jsonb,
  confidence_score numeric,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_extracted_docs_org ON public.extracted_documents(organization_id);
CREATE INDEX idx_extracted_docs_client ON public.extracted_documents(client_id);
CREATE INDEX idx_extracted_docs_type ON public.extracted_documents(document_type);
CREATE INDEX idx_extracted_docs_period ON public.extracted_documents(fiscal_period);
CREATE INDEX idx_extracted_docs_status ON public.extracted_documents(extraction_status);
CREATE INDEX idx_extracted_docs_rfc ON public.extracted_documents(rfc_emisor);
CREATE INDEX idx_extracted_docs_date ON public.extracted_documents(document_date);

ALTER TABLE public.extracted_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Transformadores see extracted documents"
  ON public.extracted_documents FOR SELECT
  TO authenticated
  USING (
    organization_id = get_user_org_id(auth.uid()) 
    AND has_role(auth.uid(), 'transformador'::app_role)
  );

CREATE POLICY "Service insert extracted documents"
  ON public.extracted_documents FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Service update extracted documents"
  ON public.extracted_documents FOR UPDATE
  TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE TABLE public.extraction_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extracted_document_id uuid REFERENCES public.extracted_documents(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) NOT NULL,
  action text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.extraction_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Transformadores see extraction logs"
  ON public.extraction_logs FOR SELECT
  TO authenticated
  USING (
    organization_id = get_user_org_id(auth.uid()) 
    AND has_role(auth.uid(), 'transformador'::app_role)
  );

CREATE POLICY "Service insert extraction logs"
  ON public.extraction_logs FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

CREATE TRIGGER update_extracted_documents_updated_at
  BEFORE UPDATE ON public.extracted_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();