-- =================================================================
-- Firma electrónica SIMPLE interna (cartas, instrucciones a agentes
-- aduanales, documentos internos). NO es para contratos: esos van por
-- WeTrust (con background check) / PSC.
--
-- Modelo:
--   user_signatures   → firma guardada por usuario (imagen en bucket `esign`)
--   esign_requests    → solicitud sobre un PDF original
--   esign_signers     → firmantes (internos con user_id, externos por token)
--
-- Todas las escrituras de solicitudes/firmantes las hace la Edge Function
-- `esign` (service role). El front solo LEE (RLS) y gestiona su propia firma.
-- Archivos: SIEMPRE por signed URL de vida corta emitida por la función.
-- Ruta: {organization_id}/requests/{request_id}/{original|signed}.pdf
--       {organization_id}/signatures/{user_id}/signature.png
-- =================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('esign', 'esign', false)
ON CONFLICT (id) DO NOTHING;

-- Firma guardada del usuario ---------------------------------------
CREATE TABLE IF NOT EXISTS public.user_signatures (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own signature select" ON public.user_signatures
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Own signature insert" ON public.user_signatures
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "Own signature update" ON public.user_signatures
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Own signature delete" ON public.user_signatures
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Solicitudes ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.esign_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  title TEXT NOT NULL,
  message TEXT,
  file_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'cancelled', 'declined', 'expired')),
  sequential BOOLEAN NOT NULL DEFAULT false,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  original_path TEXT NOT NULL,
  original_sha256 TEXT NOT NULL,
  signed_path TEXT,
  signed_sha256 TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.esign_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_esign_requests_org ON public.esign_requests(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_esign_requests_client ON public.esign_requests(client_id);

-- Firmantes --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.esign_signers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.esign_requests(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sign_order INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- NULL = externo
  token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'declined')),
  notified_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  signed_ip TEXT,
  signed_user_agent TEXT,
  signature_path TEXT,
  decline_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.esign_signers ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_esign_signers_request ON public.esign_signers(request_id);
CREATE INDEX IF NOT EXISTS idx_esign_signers_user ON public.esign_signers(user_id, status);

-- Visibilidad: quien creó la solicitud, sus firmantes internos y admins/managers.
-- (El token de firmantes externos solo lo ve quien creó la solicitud: necesario
--  para "copiar link"; internos ven solo su propia fila completa.)
CREATE POLICY "Esign requests visible" ON public.esign_requests
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      created_by = auth.uid()
      OR public.is_admin_or_manager(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.esign_signers s
        WHERE s.request_id = esign_requests.id AND s.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Esign signers visible" ON public.esign_signers
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.esign_requests r
        WHERE r.id = esign_signers.request_id
          AND (r.created_by = auth.uid() OR public.is_admin_or_manager(auth.uid()))
      )
    )
  );

-- Storage: cada usuario solo lee/escribe SU firma; todo lo demás va por
-- signed URL desde la Edge Function (service role).
CREATE POLICY "Esign own signature read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'esign'
    AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
    AND (storage.foldername(name))[2] = 'signatures'
    AND (storage.foldername(name))[3] = auth.uid()::text
  );
CREATE POLICY "Esign own signature insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'esign'
    AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
    AND (storage.foldername(name))[2] = 'signatures'
    AND (storage.foldername(name))[3] = auth.uid()::text
  );
CREATE POLICY "Esign own signature update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'esign'
    AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
    AND (storage.foldername(name))[2] = 'signatures'
    AND (storage.foldername(name))[3] = auth.uid()::text
  );
CREATE POLICY "Esign own signature delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'esign'
    AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
    AND (storage.foldername(name))[2] = 'signatures'
    AND (storage.foldername(name))[3] = auth.uid()::text
  );
