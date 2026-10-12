-- Fase 2 de seguridad: bitácora de accesos a sistemas externos (MATI / Kit-to-Drive).
-- Idempotente: se puede ejecutar más de una vez.
--
-- · Una fila por intento (también los rechazados y los que fallan).
-- · Append-only: ni UPDATE ni DELETE, ni siquiera con service_role (trigger).
-- · Solo la lee un `transformador` de la misma organización. Nadie escribe desde
--   el cliente: la Edge Function `integraciones-gateway` inserta con service_role.
-- · `detail` nunca guarda cuerpos de respuesta, tokens ni contraseñas.

CREATE TABLE IF NOT EXISTS public.integration_audit (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  organization_id uuid,
  user_id         uuid,
  user_email      text,
  system          text        NOT NULL,
  action          text        NOT NULL,
  outcome         text        NOT NULL
                  CHECK (outcome IN ('ok', 'denied', 'error', 'rate_limited', 'not_configured')),
  http_status     integer,
  duration_ms     integer,
  detail          jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS integration_audit_user_created_idx
  ON public.integration_audit (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS integration_audit_org_created_idx
  ON public.integration_audit (organization_id, created_at DESC);

ALTER TABLE public.integration_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Transformadores leen integration_audit" ON public.integration_audit;
CREATE POLICY "Transformadores leen integration_audit" ON public.integration_audit
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'transformador'
    )
  );

-- Sin políticas de escritura para authenticated/anon; además se quitan los privilegios.
REVOKE ALL ON TABLE public.integration_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.integration_audit TO authenticated;
GRANT ALL ON TABLE public.integration_audit TO service_role;

-- Append-only: bloquea UPDATE y DELETE para cualquier rol.
CREATE OR REPLACE FUNCTION public.integration_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'integration_audit es append-only (% no permitido)', TG_OP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.integration_audit_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS integration_audit_no_update_delete ON public.integration_audit;
CREATE TRIGGER integration_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON public.integration_audit
  FOR EACH ROW EXECUTE FUNCTION public.integration_audit_append_only();

COMMENT ON TABLE public.integration_audit IS
  'Bitácora append-only de accesos a sistemas externos desde Kawiil OS (integraciones-gateway).';
