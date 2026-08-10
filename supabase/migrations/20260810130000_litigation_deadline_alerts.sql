-- Alertas de términos y audiencias de litigio.
-- Tabla de deduplicación para que el cron `litigation-deadline-alerts` avise UNA vez
-- por cada (término, ventana de aviso) — buckets T-7 / T-3 / T-1 / hoy / vencido.
-- Los términos/audiencias viven en projects.lawsuit_details.deadlines[] (JSON), por eso
-- el estado de "ya avisado" se lleva en esta tabla y no en el JSON.

CREATE TABLE IF NOT EXISTS public.litigation_deadline_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  deadline_id text NOT NULL,
  bucket text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT litigation_deadline_alerts_unique UNIQUE (deadline_id, bucket)
);

CREATE INDEX IF NOT EXISTS idx_litigation_alerts_project ON public.litigation_deadline_alerts (project_id);

ALTER TABLE public.litigation_deadline_alerts ENABLE ROW LEVEL SECURITY;

-- Lectura opcional por organización (transparencia); la escritura la hace el cron (service_role).
DROP POLICY IF EXISTS "litig_alerts_select_org" ON public.litigation_deadline_alerts;
CREATE POLICY "litig_alerts_select_org"
  ON public.litigation_deadline_alerts FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

GRANT SELECT ON public.litigation_deadline_alerts TO authenticated;
GRANT ALL ON public.litigation_deadline_alerts TO service_role;
