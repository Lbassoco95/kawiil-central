-- =============================================================
-- RH — Reparaciones del registro de jornada y del sync a Slack:
--   * Permite borrar jornadas propias que quedaron SIN eventos
--     (rollback del check-in cuando falla el punch: evita sesiones
--     "fantasma" que muestran "Sin iniciar" pero bloquean con
--     "ya tienes una jornada abierta").
--   * Bandera `slack_status_broken_at` en user_slack_connections:
--     el cron slack-jornada-sync la marca cuando Slack responde
--     token_revoked/invalid_auth y la UI avisa que hay que reconectar.
--     Se limpia al reconectar (slack-user-callback) o al fijar el
--     estado correctamente.
-- =============================================================

DROP POLICY IF EXISTS "Delete own orphaned attendance" ON public.rh_attendance;
CREATE POLICY "Delete own orphaned attendance" ON public.rh_attendance
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.rh_attendance_events e
      WHERE e.attendance_id = rh_attendance.id
    )
  );

ALTER TABLE public.user_slack_connections
  ADD COLUMN IF NOT EXISTS slack_status_broken_at timestamptz;

COMMENT ON COLUMN public.user_slack_connections.slack_status_broken_at IS
  'El último users.profile.set falló por token revocado/inválido; el emoji de estado ya no se actualiza hasta reconectar Slack.';
