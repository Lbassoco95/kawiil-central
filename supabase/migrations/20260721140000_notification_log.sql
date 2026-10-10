-- Bitácora del servicio interno de notificaciones `notify` (P0.1).
-- Registra cada intento de envío por cualquier canal (slack | email | whatsapp |
-- in_app) con su estado, para trazabilidad y depuración. La tabla in-app de
-- notificaciones sigue siendo `notifications`; esto es el LOG de envíos salientes.

CREATE TABLE IF NOT EXISTS public.notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  canal text NOT NULL,
  destino text,
  plantilla text NOT NULL,
  -- enviado | error | omitido
  estado text NOT NULL DEFAULT 'enviado',
  error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  enviado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_log_canal_check
    CHECK (canal IN ('slack','email','whatsapp','in_app')),
  CONSTRAINT notification_log_estado_check
    CHECK (estado IN ('enviado','error','omitido'))
);

CREATE INDEX IF NOT EXISTS idx_notification_log_org ON public.notification_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_estado ON public.notification_log (estado, created_at DESC);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

-- Lectura: miembros de la organización (o admin/manager para logs sin org).
DROP POLICY IF EXISTS "Org users see notification log" ON public.notification_log;
CREATE POLICY "Org users see notification log" ON public.notification_log
  FOR SELECT TO authenticated
  USING (
    (organization_id IS NOT NULL AND organization_id = get_user_org_id(auth.uid()))
    OR is_admin_or_manager(auth.uid())
  );

-- Inserción: usuarios de la organización (el service-role de la Edge Function
-- ignora RLS; esta policy cubre inserciones desde el cliente si hicieran falta).
DROP POLICY IF EXISTS "Org users insert notification log" ON public.notification_log;
CREATE POLICY "Org users insert notification log" ON public.notification_log
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IS NULL OR organization_id = get_user_org_id(auth.uid()));

-- Borrado: solo admin/manager (mantenimiento).
DROP POLICY IF EXISTS "Admin delete notification log" ON public.notification_log;
CREATE POLICY "Admin delete notification log" ON public.notification_log
  FOR DELETE TO authenticated
  USING (is_admin_or_manager(auth.uid()));
