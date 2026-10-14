-- Envíos programados de correo NUEVO (sin borrador previo) desde el redactor.
--
-- Antes el redactor insertaba kind = 'send_new' sin draft_id, pero el enum solo tenía
-- 'send_draft' y draft_id era NOT NULL: programar un correo siempre fallaba.
--
-- Cambios:
--   1. Nuevo valor 'send_new' en scheduled_mail_job_kind.
--   2. draft_id pasa a ser opcional, pero sigue siendo obligatorio para 'send_draft'.
--   3. RPC scheduled_mail_job_status: deja ver el estado de un envío programado a
--      cualquier usuario de la misma organización (la tabla solo es legible por su dueño).
--      Se usa para mostrar «Programado / Enviado / Falló / Cancelado» en el historial del cliente.

ALTER TYPE public.scheduled_mail_job_kind ADD VALUE IF NOT EXISTS 'send_new';

ALTER TABLE public.scheduled_mail_jobs
  ALTER COLUMN draft_id DROP NOT NULL;

ALTER TABLE public.scheduled_mail_jobs
  DROP CONSTRAINT IF EXISTS scheduled_mail_jobs_draft_id_required_for_send_draft;
ALTER TABLE public.scheduled_mail_jobs
  ADD CONSTRAINT scheduled_mail_jobs_draft_id_required_for_send_draft
  CHECK (kind <> 'send_draft' OR draft_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.scheduled_mail_job_status(p_job_ids uuid[])
RETURNS TABLE (
  id uuid,
  status text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  error_message text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id,
         j.status::text,
         j.scheduled_at,
         j.sent_at,
         left(j.error_message, 300)
  FROM public.scheduled_mail_jobs j
  WHERE j.id = ANY (p_job_ids)
    AND public.get_user_org_id(j.user_id) IS NOT DISTINCT FROM public.get_user_org_id(auth.uid())
    AND public.get_user_org_id(auth.uid()) IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.scheduled_mail_job_status(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scheduled_mail_job_status(uuid[]) TO authenticated, service_role;
