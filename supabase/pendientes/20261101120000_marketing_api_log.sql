-- Registro de cada llamada del conector de Metricool (ruta, método, estado, duración). Solo inserción.
CREATE TABLE public.mk_api_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  operacion text NOT NULL,
  ruta text NOT NULL,
  metodo text NOT NULL DEFAULT 'GET' CHECK (metodo = 'GET'),
  estado integer NOT NULL,
  ok boolean NOT NULL,
  duracion_ms integer,
  motivo text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mk_api_log_created_idx ON public.mk_api_log (created_at DESC);

CREATE TRIGGER mk_api_log_solo_insercion BEFORE UPDATE OR DELETE ON public.mk_api_log
  FOR EACH ROW EXECUTE FUNCTION public.mk_solo_insercion();

ALTER TABLE public.mk_api_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY mk_api_log_select ON public.mk_api_log FOR SELECT TO authenticated
  USING (organization_id = public.mk_org_id() AND public.mk_can_view());
REVOKE ALL ON public.mk_api_log FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.mk_api_log FROM authenticated;
