-- Permisos API para envíos programados (PostgREST / rol authenticated).
-- Sin esto, el insert desde el cliente puede fallar con "permission denied" según configuración del proyecto.

GRANT SELECT, INSERT, UPDATE ON public.scheduled_mail_jobs TO authenticated;
GRANT ALL ON public.scheduled_mail_jobs TO service_role;
