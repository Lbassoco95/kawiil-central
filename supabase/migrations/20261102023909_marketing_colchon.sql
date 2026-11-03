-- Colchón de programación e informe diario (solo lectura de Metricool).
-- 1) Lecturas diarias del colchón por red (solo inserción).
CREATE TABLE public.mk_colchon (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  red text NOT NULL CHECK (red IN ('instagram','facebook','linkedin')),
  ultima_programada date,
  dias integer NOT NULL CHECK (dias >= 0),
  color text NOT NULL CHECK (color IN ('verde','amarillo','rojo')),
  tope boolean NOT NULL DEFAULT false,
  programadas integer NOT NULL DEFAULT 0,
  simulada boolean NOT NULL DEFAULT false,
  corrida_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mk_colchon_fecha_idx ON public.mk_colchon (organization_id, fecha DESC, corrida_at DESC);

-- 2) Informe diario (solo inserción). El contenido solo lleva red, fecha, hora, estado y textos de qué falta.
CREATE TABLE public.mk_informe_diario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  contenido jsonb NOT NULL,
  simulada boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mk_informe_diario_fecha_idx ON public.mk_informe_diario (organization_id, fecha DESC, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mk_colchon','mk_informe_diario'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.mk_solo_insercion()', t || '_solo_insercion', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (organization_id = public.mk_org_id() AND public.mk_can_view())', t || '_select', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated', t);
  END LOOP;
END $$;

-- 3) Nuevo tipo de caso y nuevo agente de bitácora.
ALTER TABLE public.mk_caso DROP CONSTRAINT mk_caso_tipo_check;
ALTER TABLE public.mk_caso ADD CONSTRAINT mk_caso_tipo_check CHECK (tipo = ANY (ARRAY['publicacion','error','hueco','conexion','semaforo_rojo','semaforo_rojo_2_semanas','falla_monitoreo','dato_sospechoso','investigacion','otro','colchon']));
ALTER TABLE public.mk_bitacora DROP CONSTRAINT mk_bitacora_agente_check;
ALTER TABLE public.mk_bitacora ADD CONSTRAINT mk_bitacora_agente_check CHECK (agente = ANY (ARRAY['vigilante','revisor','direccion','sistema','informe_diario']));

-- 4) Regla v1 del colchón con su historial (Dirección la puede cambiar con mk_cambiar_regla).
WITH r AS (
  INSERT INTO public.mk_regla (organization_id, codigo, nombre, descripcion, parametros, activa, version)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'colchon', 'Colchón de programación',
    'Días desde hoy (hora de Ciudad de México) hasta la última pieza programada en Metricool, por red. Verde desde 14 días; amarillo de 7 a 13; rojo por debajo de 7. Si baja de 14 días, el Vigilante abre un caso. Solo cuenta lo pendiente sin borrador.',
    '{"verde_desde":14,"amarillo_desde":7,"ventana_dias":45,"tolerancia_min":30}'::jsonb, true, 1)
  RETURNING id, organization_id, parametros
)
INSERT INTO public.mk_regla_historial (organization_id, regla_id, version, parametros_anteriores, parametros_nuevos, activa, motivo)
SELECT organization_id, id, 1, NULL, parametros, true,
  'Versión inicial: definición de Dirección del 1 de noviembre de 2026 (ajuste mínimo: colchón de programación e informe de faltantes); umbrales iniciales, Dirección los puede cambiar.'
FROM r;
