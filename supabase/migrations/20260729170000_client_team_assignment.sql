-- Asignación de Responsable y Colaboradores en Clientes — Fase 1
-- Servicio único de dominio + reglas R1–R4 + candados de grado (RF-07) + bitácora (RF-08)
-- + acceso global de clientes (RF-06).
--
-- Nota: el modelo ya existe en dos piezas y NO se recrea:
--   * Responsable  = clients.responsible_user_id  (garantiza R1: 0 o 1 por cliente)
--   * Colaboradores = client_collaborators (N a N)  (R2)
-- Aquí solo se extiende lo existente.

-- ---------------------------------------------------------------------------
-- RF-06: acceso global a la cartera de clientes (en vez de insertar N filas de
-- colaborador, se marca al usuario como "colaborador global").
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS has_global_client_access boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.has_global_client_access IS
  'RF-06: el usuario colabora/ve toda la cartera de clientes sin insertar filas por cliente.';

-- Auditoría de la asignación de colaboradores (quién lo agregó). created_at ya
-- cubre "asignado_en"; agregamos "asignado_por".
ALTER TABLE public.client_collaborators
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- RF-07 (candado por CAMPO, no por fila): solo G3 (referente) o G4 (transformador)
-- pueden cambiar el responsable. La política amplia "Org users update clients"
-- NO se toca, para que el staff siga capturando el resto de la ficha (no rompe).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_client_responsible_grade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
BEGIN
  IF NEW.responsible_user_id IS DISTINCT FROM OLD.responsible_user_id THEN
    -- auth.uid() NULL = contexto de servidor/servicio (migraciones, jobs, edge
    -- functions con service_role): permitido.
    IF auth.uid() IS NOT NULL AND NOT public.is_admin_or_manager(auth.uid()) THEN
      RAISE EXCEPTION 'Solo G3 (Referente) o G4 (Transformador) pueden cambiar el responsable del cliente'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_client_responsible_grade ON public.clients;
CREATE TRIGGER trg_enforce_client_responsible_grade
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_client_responsible_grade();

-- ---------------------------------------------------------------------------
-- Servicio único de dominio: asigna el responsable a 1..N clientes aplicando
-- R1–R4, la bitácora con su origen y el candado de grado de RF-07.
--   * Individual (1 cliente)  -> G3+ (is_admin_or_manager)
--   * Masivo   (>1 cliente)   -> solo G4 (transformador)
-- Idempotente: un cliente que ya tiene ese responsable no genera cambios ni log.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_client_responsible(
  _client_ids uuid[],
  _responsible uuid,
  _origin text DEFAULT 'ui_listado'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid;
  _is_bulk boolean := (COALESCE(array_length(_client_ids, 1), 0) > 1);
  _cid uuid;
  _old uuid;
  _client_org uuid;
  _changed integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  _org := public.get_user_org_id(_uid);

  -- RF-07
  IF _is_bulk THEN
    IF NOT public.has_role(_uid, 'transformador') THEN
      RAISE EXCEPTION 'Las cargas masivas están reservadas a G4 (Transformador)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF NOT public.is_admin_or_manager(_uid) THEN
      RAISE EXCEPTION 'Solo G3 (Referente) o G4 (Transformador) pueden asignar responsable'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- El responsable (si no es NULL) debe pertenecer a la misma organización.
  IF _responsible IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = _responsible AND p.organization_id = _org
    ) THEN
      RAISE EXCEPTION 'El responsable indicado no pertenece a la organización';
    END IF;
  END IF;

  FOREACH _cid IN ARRAY _client_ids LOOP
    SELECT c.responsible_user_id, c.organization_id
      INTO _old, _client_org
      FROM public.clients c
      WHERE c.id = _cid;

    -- Cliente inexistente o de otra organización: se ignora.
    IF _client_org IS NULL OR _client_org <> _org THEN
      CONTINUE;
    END IF;

    -- Idempotencia.
    IF _old IS NOT DISTINCT FROM _responsible THEN
      CONTINUE;
    END IF;

    UPDATE public.clients SET responsible_user_id = _responsible WHERE id = _cid;

    -- R3: el nuevo responsable no puede ser a la vez colaborador del mismo cliente.
    IF _responsible IS NOT NULL THEN
      DELETE FROM public.client_collaborators
        WHERE client_id = _cid AND user_id = _responsible;
    END IF;

    -- R4: el responsable anterior conserva acceso pasando a colaborador.
    IF _old IS NOT NULL THEN
      INSERT INTO public.client_collaborators (client_id, user_id, assigned_by)
        VALUES (_cid, _old, _uid)
        ON CONFLICT (client_id, user_id) DO NOTHING;
    END IF;

    -- RF-08: bitácora con origen (ui_listado | ui_detalle | ui_masivo | importacion | kawiil_ai | migracion).
    INSERT INTO public.activity_log (user_id, organization_id, entity_type, entity_id, action, details)
      VALUES (
        _uid, _org, 'client', _cid, 'responsible_changed',
        jsonb_build_object('old', _old, 'new', _responsible, 'origin', _origin)
      );

    _changed := _changed + 1;
  END LOOP;

  RETURN _changed;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_client_responsible(uuid[], uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_client_responsible(uuid[], uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Migración inicial de RF-06: el solicitante queda con acceso global a la
-- cartera (idempotente). Ajustar el correo si cambia el solicitante.
-- ---------------------------------------------------------------------------
UPDATE public.profiles
  SET has_global_client_access = true
  WHERE lower(email) = 'lbassoco@kawiil.mx';
