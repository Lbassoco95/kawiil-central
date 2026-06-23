-- =============================================================
-- Búho Legal — Integración del módulo Litigio (juicios)
-- Vincula proyectos de juicios con alertas/expedientes monitoreados
-- en Búho Legal (https://miscasos-expedientes.buholegal.com) y cachea
-- los acuerdos que devuelve el monitoreo.
--   1 juicio = 1 alerta BL (por ahora) -> UNIQUE(project_id).
-- RLS por organización usando el helper public.get_user_org_id(auth.uid()),
-- igual que el resto de tablas de Kawiil (profiles se llavea por user_id).
-- =============================================================

-- ---------------- Alertas (vínculo proyecto <-> Búho Legal) ----------------
CREATE TABLE IF NOT EXISTS public.buholegal_alertas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  entidad text NOT NULL,                  -- slug del estado/fuero ej: "cdmx", "federal"
  buholegal_id integer NOT NULL,          -- ID de la alerta en Búho Legal
  numero_expediente text NOT NULL,
  nombre_alerta text NOT NULL,
  juzgado_id integer,
  tipo_expediente_id integer,
  last_sync_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(project_id)                      -- un juicio = una alerta BL (por ahora)
);

ALTER TABLE public.buholegal_alertas ENABLE ROW LEVEL SECURITY;

-- Miembros de la organización dueña del proyecto pueden gestionar la alerta.
DROP POLICY IF EXISTS "org members can manage buholegal alertas" ON public.buholegal_alertas;
CREATE POLICY "org members can manage buholegal alertas"
  ON public.buholegal_alertas
  FOR ALL
  TO authenticated
  USING (
    project_id IN (
      SELECT id FROM public.projects
      WHERE organization_id = public.get_user_org_id(auth.uid())
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT id FROM public.projects
      WHERE organization_id = public.get_user_org_id(auth.uid())
    )
  );

CREATE INDEX IF NOT EXISTS idx_buholegal_alertas_project
  ON public.buholegal_alertas(project_id);

-- ---------------- Acuerdos (cache del monitoreo) ----------------
CREATE TABLE IF NOT EXISTS public.buholegal_acuerdos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alerta_id uuid NOT NULL REFERENCES public.buholegal_alertas(id) ON DELETE CASCADE,
  fecha text,
  actor text,
  demandado text,
  acuerdo text,
  fetched_at timestamptz DEFAULT now(),
  UNIQUE(alerta_id, fecha, acuerdo)       -- evitar duplicados al re-sincronizar
);

ALTER TABLE public.buholegal_acuerdos ENABLE ROW LEVEL SECURITY;

-- Lectura para miembros de la organización dueña del proyecto.
DROP POLICY IF EXISTS "org members can read acuerdos" ON public.buholegal_acuerdos;
CREATE POLICY "org members can read acuerdos"
  ON public.buholegal_acuerdos
  FOR SELECT
  TO authenticated
  USING (
    alerta_id IN (
      SELECT ba.id
      FROM public.buholegal_alertas ba
      JOIN public.projects p ON ba.project_id = p.id
      WHERE p.organization_id = public.get_user_org_id(auth.uid())
    )
  );

-- Escritura (upsert al sincronizar) para miembros de la organización.
DROP POLICY IF EXISTS "org members can write acuerdos" ON public.buholegal_acuerdos;
CREATE POLICY "org members can write acuerdos"
  ON public.buholegal_acuerdos
  FOR ALL
  TO authenticated
  USING (
    alerta_id IN (
      SELECT ba.id
      FROM public.buholegal_alertas ba
      JOIN public.projects p ON ba.project_id = p.id
      WHERE p.organization_id = public.get_user_org_id(auth.uid())
    )
  )
  WITH CHECK (
    alerta_id IN (
      SELECT ba.id
      FROM public.buholegal_alertas ba
      JOIN public.projects p ON ba.project_id = p.id
      WHERE p.organization_id = public.get_user_org_id(auth.uid())
    )
  );

CREATE INDEX IF NOT EXISTS idx_buholegal_acuerdos_alerta
  ON public.buholegal_acuerdos(alerta_id);
