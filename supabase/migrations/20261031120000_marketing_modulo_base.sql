-- Marketing · Módulo de Monitoreo — Entrega 1: estructura de datos, permisos y reglas v1.
-- Solo estructura. No contiene datos del historial (se cargan aparte, desde el Calendario Maestro).
-- Zona horaria de negocio: America/Mexico_City.
--
-- Principios:
--  * Una pieza = una fila en mk_pieza; su estado por red vive en mk_pieza_red (tres redes, una pieza).
--  * Etapa (1..6) y propósito (conectar/enseñar/vender) son columnas de la pieza: las etapas 2..6 no requieren tablas nuevas.
--  * Bitácora e historial de reglas son solo-inserción (sin UPDATE ni DELETE para nadie).
--  * Los agentes escriben con service_role desde Edge Functions; ningún agente puede decidir.
--  * Las reglas solo cambian mediante mk_cambiar_regla(), que exige permiso de Dirección y motivo.

-- ---------------------------------------------------------------------------
-- Permisos del módulo (reutiliza user_module_permissions)
--   marketing           → ver
--   marketing_decidir   → aprobar/rechazar/ajustar propuestas y cambiar reglas (solo Dirección o quien asigne)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mk_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.get_user_org_id(auth.uid()) $$;

CREATE OR REPLACE FUNCTION public.mk_can_view()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_module_permissions
    WHERE user_id = auth.uid() AND module_key IN ('marketing', 'marketing_decidir') AND enabled
  )
$$;

CREATE OR REPLACE FUNCTION public.mk_can_decide()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_module_permissions
    WHERE user_id = auth.uid() AND module_key = 'marketing_decidir' AND enabled
  )
$$;

REVOKE ALL ON FUNCTION public.mk_org_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mk_can_view() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mk_can_decide() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mk_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mk_can_view() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mk_can_decide() TO authenticated;

-- ---------------------------------------------------------------------------
-- Piezas, publicaciones por red y resultados
-- ---------------------------------------------------------------------------

CREATE TABLE public.mk_pieza (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  codigo text,                                   -- identificador en el Calendario Maestro, si existe
  titulo text,
  tema text,
  pilar text,
  formato text,
  etapa smallint NOT NULL DEFAULT 1 CHECK (etapa BETWEEN 1 AND 6),
  proposito text CHECK (proposito IN ('conectar', 'ensenar', 'vender')),
  programada_at timestamptz,                     -- fecha y hora programadas
  fecha date,                                    -- fecha planeada o de publicación cuando la hora se desconoce (historial)
  copy_url text,
  -- Primera publicación real en cualquier red. La mantiene un trigger. Define la semana de la pieza.
  primera_publicacion_at timestamptz,
  origen text NOT NULL DEFAULT 'manual' CHECK (origen IN ('calendario_maestro', 'metricool', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, codigo)
);
CREATE INDEX idx_mk_pieza_org_prog ON public.mk_pieza (organization_id, programada_at);
CREATE INDEX idx_mk_pieza_org_pub ON public.mk_pieza (organization_id, primera_publicacion_at);

CREATE TABLE public.mk_pieza_red (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pieza_id uuid NOT NULL REFERENCES public.mk_pieza(id) ON DELETE CASCADE,
  red text NOT NULL CHECK (red IN ('instagram', 'facebook', 'linkedin')),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'publicada', 'con_errores')),
  programada_at timestamptz,
  publicada_at timestamptz,                      -- fecha y hora reales en esta red
  mensaje_error text,
  hora_estimada boolean NOT NULL DEFAULT false,   -- true: solo se conoce la fecha; la hora guardada es un valor de relleno
  metricool_id text,                             -- id de la publicación en Metricool (solo referencia)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pieza_id, red),
  CHECK (estado <> 'publicada' OR publicada_at IS NOT NULL)
);
CREATE INDEX idx_mk_pieza_red_org_red ON public.mk_pieza_red (organization_id, red, estado);

-- Resultados por pieza y red. 'fuente' permite guardar lado a lado la cifra de Metricool y la del
-- Calendario Maestro; la calibración las compara y Dirección decide cuál queda.
CREATE TABLE public.mk_resultado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pieza_red_id uuid NOT NULL REFERENCES public.mk_pieza_red(id) ON DELETE CASCADE,
  corte text NOT NULL CHECK (corte IN ('48h', '7d', 'acumulado')),   -- 'acumulado' = a la fecha de consulta, sin corte exacto
  fuente text NOT NULL CHECK (fuente IN ('metricool', 'calendario_maestro')),
  medida text NOT NULL CHECK (medida IN ('alcance', 'impresiones')),
  valor numeric,
  guardados integer,
  compartidos integer,
  clics integer,
  reacciones integer,
  comentarios integer,
  extra jsonb,                                    -- cifras de la fuente que no tienen columna propia (p. ej. 'interacciones' de Instagram)
  capturado_at timestamptz NOT NULL DEFAULT now(),  -- cuándo se tomó la cifra (no cuándo ocurrió)
  UNIQUE (pieza_red_id, corte, fuente)
);

CREATE TABLE public.mk_seguidores_semana (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  red text NOT NULL CHECK (red IN ('instagram', 'facebook', 'linkedin')),
  semana_inicio date NOT NULL,                    -- lunes
  seguidores integer NOT NULL,
  fuente text NOT NULL CHECK (fuente IN ('metricool', 'calendario_maestro')),
  UNIQUE (organization_id, red, semana_inicio, fuente),
  CHECK (EXTRACT(ISODOW FROM semana_inicio) = 1)
);

-- ---------------------------------------------------------------------------
-- Reglas de monitoreo (versionadas) e historial de cambios
-- ---------------------------------------------------------------------------

CREATE TABLE public.mk_regla (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  codigo text NOT NULL,                           -- ej. 'publicacion', 'semaforo_instagram'
  nombre text NOT NULL,
  descripcion text,
  parametros jsonb NOT NULL DEFAULT '{}'::jsonb,
  activa boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, codigo)
);

CREATE TABLE public.mk_regla_historial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  regla_id uuid NOT NULL REFERENCES public.mk_regla(id) ON DELETE CASCADE,
  version integer NOT NULL,
  parametros_anteriores jsonb,
  parametros_nuevos jsonb NOT NULL,
  activa boolean NOT NULL,
  motivo text NOT NULL CHECK (length(btrim(motivo)) > 0),
  cambiado_por uuid REFERENCES auth.users(id),    -- NULL solo para la carga inicial (v1)
  propuesta_id uuid,                              -- FK se agrega más abajo
  cambiado_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Casos, propuestas, decisiones, experimentos, bitácora
-- ---------------------------------------------------------------------------

CREATE TABLE public.mk_caso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  numero integer GENERATED ALWAYS AS IDENTITY,
  tipo text NOT NULL CHECK (tipo IN (
    'publicacion', 'error', 'hueco', 'conexion', 'semaforo_rojo', 'semaforo_rojo_2_semanas',
    'falla_monitoreo', 'investigacion', 'otro')),
  regla_codigo text,
  red text CHECK (red IN ('instagram', 'facebook', 'linkedin')),
  pieza_id uuid REFERENCES public.mk_pieza(id) ON DELETE SET NULL,
  titulo text NOT NULL,
  descripcion text,
  evidencia jsonb NOT NULL DEFAULT '[]'::jsonb,   -- lista de {fuente, dato, fecha}
  estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'en_investigacion', 'en_decision', 'cerrado')),
  responsable text NOT NULL DEFAULT 'vigilante' CHECK (responsable IN ('vigilante', 'revisor', 'direccion')),
  detectado_at timestamptz NOT NULL DEFAULT now(),
  cerrado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, numero)
);
CREATE INDEX idx_mk_caso_org_estado ON public.mk_caso (organization_id, estado);

CREATE TABLE public.mk_propuesta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  caso_id uuid NOT NULL REFERENCES public.mk_caso(id) ON DELETE CASCADE,
  causa text,
  pasos_investigacion jsonb NOT NULL DEFAULT '[]'::jsonb,  -- los 7 pasos de la guía, cada uno con su constancia
  evidencia jsonb NOT NULL DEFAULT '[]'::jsonb,
  correccion_propuesta text,
  cambio_monitoreo jsonb,                          -- {regla_codigo, parametros_nuevos, motivo}
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada', 'ajuste_solicitado')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mk_regla_historial
  ADD CONSTRAINT mk_regla_historial_propuesta_fk FOREIGN KEY (propuesta_id) REFERENCES public.mk_propuesta(id);

CREATE TABLE public.mk_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  propuesta_id uuid NOT NULL REFERENCES public.mk_propuesta(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('aprobada', 'rechazada', 'ajuste_solicitado')),
  comentario text,
  decidido_por uuid NOT NULL REFERENCES auth.users(id),
  decidido_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.mk_experimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  caso_id uuid REFERENCES public.mk_caso(id) ON DELETE SET NULL,
  nombre text NOT NULL,
  variable_cambiada text NOT NULL,                 -- una sola cosa
  piezas_planeadas integer,
  desde date,
  esperado text,
  resultado text,
  estado text NOT NULL DEFAULT 'planeado' CHECK (estado IN ('planeado', 'en_curso', 'concluido', 'cancelado')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.mk_bitacora (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agente text NOT NULL CHECK (agente IN ('vigilante', 'revisor', 'direccion', 'sistema')),
  accion text NOT NULL,
  resultado text NOT NULL,
  detalle jsonb,
  caso_id uuid REFERENCES public.mk_caso(id) ON DELETE SET NULL,
  registrado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_mk_bitacora_org_at ON public.mk_bitacora (organization_id, registrado_at DESC);

-- Calibración del semáforo: cifra calculada con la fórmula vs cifra del Calendario Maestro.
CREATE TABLE public.mk_calibracion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  semana_inicio date NOT NULL,
  red text NOT NULL CHECK (red IN ('instagram', 'facebook', 'linkedin')),
  piezas_calculadas integer,
  promedio_calculado numeric,
  piezas_calendario integer,
  promedio_calendario numeric,
  color_calculado text,
  color_calendario text,
  diferencia numeric,
  nota text,
  calculado_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, semana_inicio, red)
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER mk_pieza_updated BEFORE UPDATE ON public.mk_pieza
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER mk_pieza_red_updated BEFORE UPDATE ON public.mk_pieza_red
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER mk_caso_updated BEFORE UPDATE ON public.mk_caso
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Primera publicación real = mínima publicada_at entre las redes en que la pieza salió.
CREATE OR REPLACE FUNCTION public.mk_recalcular_primera_publicacion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pieza uuid := COALESCE(NEW.pieza_id, OLD.pieza_id);
BEGIN
  UPDATE public.mk_pieza p
  SET primera_publicacion_at = (
    SELECT min(r.publicada_at) FROM public.mk_pieza_red r
    WHERE r.pieza_id = v_pieza AND r.estado = 'publicada'
  )
  WHERE p.id = v_pieza;
  RETURN NULL;
END;
$$;

CREATE TRIGGER mk_pieza_red_primera_pub
  AFTER INSERT OR UPDATE OF estado, publicada_at OR DELETE ON public.mk_pieza_red
  FOR EACH ROW EXECUTE FUNCTION public.mk_recalcular_primera_publicacion();

-- Solo-inserción: ni UPDATE ni DELETE, ni siquiera con service_role (salvo superusuario/migración).
CREATE OR REPLACE FUNCTION public.mk_solo_insercion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% es solo de inserción', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER mk_bitacora_inmutable BEFORE UPDATE OR DELETE ON public.mk_bitacora
  FOR EACH ROW EXECUTE FUNCTION public.mk_solo_insercion();
CREATE TRIGGER mk_regla_historial_inmutable BEFORE UPDATE OR DELETE ON public.mk_regla_historial
  FOR EACH ROW EXECUTE FUNCTION public.mk_solo_insercion();
CREATE TRIGGER mk_decision_inmutable BEFORE UPDATE OR DELETE ON public.mk_decision
  FOR EACH ROW EXECUTE FUNCTION public.mk_solo_insercion();

-- ---------------------------------------------------------------------------
-- Cambio de regla: único camino. Exige permiso de Dirección y motivo; deja historial.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mk_cambiar_regla(
  p_codigo text,
  p_parametros jsonb,
  p_activa boolean,
  p_motivo text,
  p_propuesta_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := public.mk_org_id();
  v_regla public.mk_regla%ROWTYPE;
BEGIN
  IF NOT public.mk_can_decide() THEN
    RAISE EXCEPTION 'Solo Dirección (o quien asigne) puede cambiar reglas de monitoreo' USING ERRCODE = '42501';
  END IF;
  IF p_motivo IS NULL OR length(btrim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'El motivo del cambio es obligatorio';
  END IF;

  SELECT * INTO v_regla FROM public.mk_regla
  WHERE organization_id = v_org AND codigo = p_codigo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Regla % no existe', p_codigo;
  END IF;

  UPDATE public.mk_regla
  SET parametros = p_parametros, activa = p_activa, version = v_regla.version + 1, updated_at = now()
  WHERE id = v_regla.id;

  INSERT INTO public.mk_regla_historial
    (organization_id, regla_id, version, parametros_anteriores, parametros_nuevos, activa, motivo, cambiado_por, propuesta_id)
  VALUES
    (v_org, v_regla.id, v_regla.version + 1, v_regla.parametros, p_parametros, p_activa, p_motivo, auth.uid(), p_propuesta_id);

  INSERT INTO public.mk_bitacora (organization_id, agente, accion, resultado, detalle)
  VALUES (v_org, 'direccion', 'cambio_regla:' || p_codigo, 'version ' || (v_regla.version + 1),
          jsonb_build_object('motivo', p_motivo, 'usuario', auth.uid()));

  RETURN v_regla.version + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.mk_cambiar_regla(text, jsonb, boolean, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mk_cambiar_regla(text, jsonb, boolean, text, uuid) TO authenticated;

-- Decisión sobre una propuesta: único camino para decidir. Registra quién y cuándo.
CREATE OR REPLACE FUNCTION public.mk_decidir_propuesta(
  p_propuesta_id uuid,
  p_decision text,
  p_comentario text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := public.mk_org_id();
  v_id uuid;
BEGIN
  IF NOT public.mk_can_decide() THEN
    RAISE EXCEPTION 'Solo Dirección (o quien asigne) puede decidir propuestas' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('aprobada', 'rechazada', 'ajuste_solicitado') THEN
    RAISE EXCEPTION 'Decisión inválida: %', p_decision;
  END IF;

  UPDATE public.mk_propuesta SET estado = p_decision
  WHERE id = p_propuesta_id AND organization_id = v_org AND estado = 'pendiente';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La propuesta no existe o ya fue decidida';
  END IF;

  INSERT INTO public.mk_decision (organization_id, propuesta_id, decision, comentario, decidido_por)
  VALUES (v_org, p_propuesta_id, p_decision, p_comentario, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.mk_bitacora (organization_id, agente, accion, resultado, detalle)
  VALUES (v_org, 'direccion', 'decision_propuesta', p_decision,
          jsonb_build_object('propuesta_id', p_propuesta_id, 'usuario', auth.uid()));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mk_decidir_propuesta(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mk_decidir_propuesta(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS: ven quienes tienen 'marketing'; escribir desde la app solo por las funciones de arriba
-- (los agentes y la carga usan service_role, que no pasa por RLS).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mk_pieza', 'mk_pieza_red', 'mk_resultado', 'mk_seguidores_semana', 'mk_regla', 'mk_regla_historial',
    'mk_caso', 'mk_propuesta', 'mk_decision', 'mk_experimento', 'mk_bitacora', 'mk_calibracion'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (organization_id = public.mk_org_id() AND public.mk_can_view())',
      t || '_select', t);
    -- Sin políticas de INSERT/UPDATE/DELETE para 'authenticated': escribir exige service_role o las funciones mk_*.
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- Dirección puede reasignar y cerrar casos (única escritura directa permitida desde la app).
GRANT UPDATE (responsable, estado, cerrado_at) ON public.mk_caso TO authenticated;
CREATE POLICY mk_caso_update_direccion ON public.mk_caso FOR UPDATE TO authenticated
  USING (organization_id = public.mk_org_id() AND public.mk_can_decide())
  WITH CHECK (organization_id = public.mk_org_id() AND public.mk_can_decide());

-- ---------------------------------------------------------------------------
-- Semana y semáforo (fórmula de Dirección, 31 oct 2026)
--   Semana: lunes 00:00 a domingo 23:59 hora de Ciudad de México.
--   La pieza cuenta en la semana de su PRIMERA publicación real en cualquier red.
--   Medida: alcance (IG, FB) o impresiones (LinkedIn) acumulados a 7 días.
--   Promedio simple por pieza publicada en la semana, sin redondear. 'Desde N' incluye N.
--   Sin piezas publicadas: gris (sin datos), nunca rojo.
-- Umbrales: se leen de la regla activa 'semaforo_<red>' {verde_desde, amarillo_desde}.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mk_semana_inicio(p_ts timestamptz)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$ SELECT date_trunc('week', p_ts AT TIME ZONE 'America/Mexico_City')::date $$;

CREATE OR REPLACE FUNCTION public.mk_semaforo_semana(
  p_org uuid,
  p_semana date,
  p_red text,
  p_fuente text DEFAULT 'metricool'
)
RETURNS TABLE (piezas integer, promedio numeric, color text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_verde numeric;
  v_amarillo numeric;
  v_n integer;
  v_prom numeric;
BEGIN
  SELECT (parametros->>'verde_desde')::numeric, (parametros->>'amarillo_desde')::numeric
  INTO v_verde, v_amarillo
  FROM public.mk_regla WHERE organization_id = p_org AND codigo = 'semaforo_' || p_red AND activa;

  SELECT count(*), avg(res.valor)
  INTO v_n, v_prom
  FROM public.mk_pieza p
  JOIN public.mk_pieza_red r ON r.pieza_id = p.id AND r.red = p_red AND r.estado = 'publicada'
  LEFT JOIN public.mk_resultado res
    ON res.pieza_red_id = r.id AND res.corte IN ('7d', 'acumulado') AND res.fuente = p_fuente
  WHERE p.organization_id = p_org
    AND p.primera_publicacion_at IS NOT NULL
    AND public.mk_semana_inicio(p.primera_publicacion_at) = p_semana;

  RETURN QUERY SELECT
    v_n,
    v_prom,
    CASE
      WHEN v_n = 0 OR v_prom IS NULL OR v_verde IS NULL THEN 'gris'
      WHEN v_prom >= v_verde THEN 'verde'
      WHEN v_prom >= v_amarillo THEN 'amarillo'
      ELSE 'rojo'
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.mk_semaforo_semana(uuid, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mk_semaforo_semana(uuid, date, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Reglas v1 (sección 5 de los requisitos). Se siembran por organización, no aquí, porque la migración
-- no conoce el id de la organización. Idempotente. Se llama durante la carga del historial.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mk_sembrar_reglas_v1(p_org uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  v_id uuid;
  v_n integer := 0;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('publicacion', 'Publicación', 'A los N minutos de la hora programada la pieza debe aparecer publicada en las tres redes; si no, caso.',
       '{"minutos_tolerancia": 30}'::jsonb),
    ('errores', 'Errores', 'Cualquier pieza con estado «Con errores» abre un caso inmediato.', '{}'::jsonb),
    ('huecos', 'Huecos', 'Si una red pasa más de N días sin publicar lo planeado, caso.', '{"dias_maximos": 3}'::jsonb),
    ('conexion', 'Conexión', 'Cada lunes se confirma que las tres cuentas siguen conectadas.', '{"dia_semana": 1}'::jsonb),
    ('resultados', 'Alcance a 48 h y 7 d', 'Se registra alcance o impresiones, guardados y compartidos de cada pieza.', '{"cortes_horas": [48, 168]}'::jsonb),
    ('semaforo_instagram', 'Semáforo Instagram (alcance)', 'Promedio simple por pieza de la semana, a 7 días.', '{"verde_desde": 35, "amarillo_desde": 15, "medida": "alcance"}'::jsonb),
    ('semaforo_facebook', 'Semáforo Facebook (alcance)', 'Promedio simple por pieza de la semana, a 7 días.', '{"verde_desde": 18, "amarillo_desde": 10, "medida": "alcance"}'::jsonb),
    ('semaforo_linkedin', 'Semáforo LinkedIn (impresiones)', 'Promedio simple por pieza de la semana, a 7 días.', '{"verde_desde": 17, "amarillo_desde": 5, "medida": "impresiones"}'::jsonb),
    ('escalamiento', 'Escalamiento', 'Una semana en rojo (lectura provisional) se señala; dos lecturas definitivas seguidas en rojo abren caso para el Revisor.',
       '{"semanas_senal": 1, "semanas_caso_revisor": 2, "caso_solo_con_lectura_definitiva": true}'::jsonb),
    ('revision_resultados', 'Revisión de resultados', 'Cortes de datos y propuesta de ajuste.', '{"fechas": ["2026-11-30", "2026-12-31", "2027-01-14"]}'::jsonb),
    ('ventana_publicacion', 'Frecuencia del Vigilante', 'Cada N minutos dentro de la ventana de publicación y cada hora fuera de ella.',
       '{"minutos_dentro": 15, "minutos_fuera": 60, "antes_primera_min": 30, "despues_ultima_min": 90}'::jsonb),
    ('estado_gris', 'Estado gris por falta de datos', 'Sin consulta exitosa a Metricool en N minutos, la red pasa a gris y se abre caso de falla de monitoreo.',
       '{"minutos_dentro_ventana": 30, "minutos_fuera_ventana": 90}'::jsonb),
    ('corte_semana', 'Semana y fecha de corte de las piezas', 'Semana lunes 00:00 a domingo 23:59, America/Mexico_City. La pieza cuenta en la semana de su primera publicación real en cualquier red.',
       '{"zona": "America/Mexico_City", "criterio": "primera_publicacion_en_cualquier_red"}'::jsonb)
  ) AS x(codigo, nombre, descripcion, parametros)
  LOOP
    INSERT INTO public.mk_regla (organization_id, codigo, nombre, descripcion, parametros)
    VALUES (p_org, r.codigo, r.nombre, r.descripcion, r.parametros)
    ON CONFLICT (organization_id, codigo) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NOT NULL THEN
      INSERT INTO public.mk_regla_historial
        (organization_id, regla_id, version, parametros_anteriores, parametros_nuevos, activa, motivo, cambiado_por)
      VALUES (p_org, v_id, 1, NULL, r.parametros, true, 'Regla v1: carga inicial (requisitos de Dirección, 31 oct 2026)', NULL);
      v_n := v_n + 1;
    END IF;
    v_id := NULL;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.mk_sembrar_reglas_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mk_sembrar_reglas_v1(uuid) TO service_role;
