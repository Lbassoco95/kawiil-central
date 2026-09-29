-- =================================================================
-- Portal del cliente — M1/M2/M3: cuentas, membresías, textos legales,
-- bitácora inmutable y funciones de aislamiento.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-28
-- Rollback (a mano): migrations/2026-09-28_portal_core.rollback.sql
--
-- Por qué existe esta capa:
--   El tenant de kawiil-central es la ORGANIZACIÓN. Cualquier usuario con fila
--   en `profiles` ve a todos los clientes. Un usuario del portal NUNCA debe
--   tener `profiles`: su acceso nace de `portal_memberships` (cliente por
--   cliente) y lo impone la RLS con `portal_my_client_ids()`.
--
--   Dos agujeros que se cierran aquí para las cuentas del portal:
--   1) `handle_new_user` le creaba perfil + rol `en_formacion` en la
--      organización Kawiil a TODO usuario nuevo. Ahora, si el alta viene
--      marcada `kawiil_portal = true`, crea `portal_accounts` y nada más.
--   2) La policy `"Users insert own profile"` deja que un autenticado sin
--      perfil se inserte uno en la organización que quiera. Un trigger en
--      `profiles` y otro en `user_roles` lo rechazan para cuentas del portal.
-- =================================================================

-- ── 0. Configuración del portal (una fila) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Organización dueña de los clientes que nacen del nivel básico.
  basic_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  -- Límite por defecto de facturas incluidas en el nivel básico.
  default_basic_invoice_limit int NOT NULL DEFAULT 10 CHECK (default_basic_invoice_limit >= 0),
  -- Horas sin respuesta antes de marcar un hilo en la bandeja.
  default_thread_sla_hours int NOT NULL DEFAULT 24 CHECK (default_thread_sla_hours > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.portal_config ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.portal_config IS
  'Parámetros globales del portal del cliente (una sola fila).';

INSERT INTO public.portal_config (id, basic_organization_id)
SELECT true, o.id FROM public.organizations o
 WHERE o.id = 'a0000000-0000-0000-0000-000000000001'
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.portal_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ── 1. Cuentas del portal ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  -- pendiente = registrada y sin vincular: no ve ningún dato de cliente.
  status text NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'activa', 'suspendida')),
  -- Nivel: atributo de la cuenta. NULL mientras está pendiente.
  tier text CHECK (tier IS NULL OR tier IN ('premier', 'basico')),
  created_via text NOT NULL DEFAULT 'registro'
    CHECK (created_via IN ('registro', 'invitacion')),
  linked_at timestamptz,
  linked_by uuid,
  suspended_at timestamptz,
  suspended_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_accounts_active_has_tier CHECK (status <> 'activa' OR tier IS NOT NULL)
);
ALTER TABLE public.portal_accounts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_portal_accounts_status ON public.portal_accounts (status);
COMMENT ON TABLE public.portal_accounts IS
  'Cuenta de una persona en el portal del cliente. Excluyente con profiles: una cuenta del portal nunca es staff.';

-- ── 2. Membresías (persona ↔ cliente) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.portal_accounts(user_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('administrador', 'operativo', 'consulta')),
  status text NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'suspendida')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, user_id)
);
ALTER TABLE public.portal_memberships ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_portal_memberships_user ON public.portal_memberships (user_id) WHERE status = 'activa';
CREATE INDEX IF NOT EXISTS idx_portal_memberships_org_client ON public.portal_memberships (organization_id, client_id);

-- organization_id SIEMPRE es el del cliente; no se confía en lo que mande nadie.
CREATE OR REPLACE FUNCTION public.portal_inherit_client_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.clients WHERE id = NEW.client_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'portal: el cliente % no existe', NEW.client_id;
  END IF;
  NEW.organization_id := v_org;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_inherit_client_org() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_portal_memberships_org ON public.portal_memberships;
CREATE TRIGGER trg_portal_memberships_org
  BEFORE INSERT OR UPDATE OF client_id ON public.portal_memberships
  FOR EACH ROW EXECUTE FUNCTION public.portal_inherit_client_org();

-- ── 3. Ajustes por cliente ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_client_settings (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  origin text NOT NULL DEFAULT 'kawiil' CHECK (origin IN ('kawiil', 'basico')),
  -- Interruptor de emisión: apagado por defecto. El trigger de la migración de
  -- facturas impide prenderlo con el expediente incompleto.
  emission_enabled boolean NOT NULL DEFAULT false,
  emission_changed_at timestamptz,
  emission_changed_by uuid,
  -- Responsable de la bandeja de mensajes. Vacío hasta que Polo lo asigne.
  inbox_owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  thread_sla_hours int CHECK (thread_sla_hours IS NULL OR thread_sla_hours > 0),
  basic_invoice_limit int CHECK (basic_invoice_limit IS NULL OR basic_invoice_limit >= 0),
  -- Tickets en nivel básico: función de paga, apagada.
  basic_tickets_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.portal_client_settings ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_portal_client_settings_org ON public.portal_client_settings;
CREATE TRIGGER trg_portal_client_settings_org
  BEFORE INSERT OR UPDATE OF client_id ON public.portal_client_settings
  FOR EACH ROW EXECUTE FUNCTION public.portal_inherit_client_org();

-- ── 4. Textos legales versionados ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('aviso_privacidad', 'terminos', 'contrato_uso', 'carta_instruccion')),
  version text NOT NULL,
  title text NOT NULL,
  body_md text NOT NULL,
  -- true = marcador pendiente de que Polo entregue el texto real.
  is_placeholder boolean NOT NULL DEFAULT true,
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, version)
);
ALTER TABLE public.portal_legal_documents ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_portal_legal_current ON public.portal_legal_documents (kind, published_at DESC);

INSERT INTO public.portal_legal_documents (kind, version, title, body_md, is_placeholder, published_at)
VALUES
  ('aviso_privacidad', '0.0-marcador', 'Aviso de privacidad',
   '> **MARCADOR — TEXTO PENDIENTE.** Este aviso de privacidad es un marcador. Kawiil entregará el texto definitivo conforme a la LFPDPPP antes de abrir el portal.', true, now()),
  ('terminos', '0.0-marcador', 'Términos y condiciones',
   '> **MARCADOR — TEXTO PENDIENTE.** Estos términos son un marcador. Kawiil entregará el texto definitivo antes de abrir el portal.', true, now()),
  ('contrato_uso', '0.0-marcador', 'Contrato de uso (nivel básico)',
   '> **MARCADOR — TEXTO PENDIENTE.** Contrato de uso para emitir facturas desde el nivel básico. Kawiil entregará el texto definitivo.', true, now()),
  ('carta_instruccion', '0.0-marcador', 'Carta de instrucción para emisión',
   '> **MARCADOR — TEXTO PENDIENTE.** Modelo de carta por la que el cliente instruye a Kawiil a emitir CFDI en su nombre. Kawiil entregará el texto definitivo.', true, now())
ON CONFLICT (kind, version) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.portal_legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Sin FK: la aceptación es evidencia y sobrevive a la eliminación de la cuenta.
  user_id uuid NOT NULL,
  user_email text NOT NULL,
  client_id uuid,
  document_id uuid NOT NULL REFERENCES public.portal_legal_documents(id),
  kind text NOT NULL,
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  user_agent text
);
ALTER TABLE public.portal_legal_acceptances ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_portal_legal_acc_user ON public.portal_legal_acceptances (user_id, kind);
CREATE INDEX IF NOT EXISTS idx_portal_legal_acc_client ON public.portal_legal_acceptances (client_id, kind);

-- ── 5. Bitácora inmutable ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_audit_log (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- Sin FK a auth.users ni a clients: la bitácora sobrevive a borrados.
  actor_user_id uuid,
  actor_kind text NOT NULL CHECK (actor_kind IN ('portal', 'staff', 'sistema')),
  actor_email text,
  organization_id uuid,
  client_id uuid,
  action text NOT NULL CHECK (action IN (
    'acceso', 'documento_consulta', 'documento_descarga', 'archivo_descarga',
    'emision', 'emision_rechazada', 'emision_interruptor',
    'cancelacion_solicitud', 'cancelacion_resolucion',
    'mensaje', 'hilo_asignacion', 'hilo_estado',
    'publicacion', 'despublicacion', 'documento_subida',
    'rol_cambio', 'nivel_cambio', 'vinculacion', 'invitacion', 'suspension', 'reactivacion',
    'cuenta_registro', 'cuenta_eliminada', 'nivel_basico_activado',
    'legal_aceptacion', 'carta_instruccion_registro',
    'csd_carga', 'csd_uso', 'csd_revocacion',
    'ticket_carga', 'ticket_estado', 'ticket_facturado',
    'cfdi_carga', 'cfdi_importacion', 'categoria_confirmada',
    'dropbox_mapeo', 'dropbox_sincronizacion'
  )),
  entity_type text,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.portal_audit_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_portal_audit_client ON public.portal_audit_log (client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_audit_actor ON public.portal_audit_log (actor_user_id, occurred_at DESC);
COMMENT ON TABLE public.portal_audit_log IS
  'Bitácora del portal. Solo INSERT (por funciones SECURITY DEFINER). UPDATE, DELETE y TRUNCATE los rechaza un trigger, incluso para service_role.';

CREATE OR REPLACE FUNCTION public.portal_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'portal_audit_log es inmutable (% rechazado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_audit_no_update ON public.portal_audit_log;
CREATE TRIGGER trg_portal_audit_no_update
  BEFORE UPDATE OR DELETE ON public.portal_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.portal_audit_immutable();
DROP TRIGGER IF EXISTS trg_portal_audit_no_truncate ON public.portal_audit_log;
CREATE TRIGGER trg_portal_audit_no_truncate
  BEFORE TRUNCATE ON public.portal_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.portal_audit_immutable();

REVOKE UPDATE, DELETE, TRUNCATE ON public.portal_audit_log FROM anon, authenticated, service_role;
REVOKE INSERT ON public.portal_audit_log FROM anon, authenticated;

-- ── 6. Funciones de identidad y aislamiento ─────────────────────────
CREATE OR REPLACE FUNCTION public.portal_is_portal_user(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$ SELECT EXISTS (SELECT 1 FROM public.portal_accounts WHERE user_id = _uid) $$;

-- Staff = tiene perfil activo y NO es cuenta del portal.
CREATE OR REPLACE FUNCTION public.portal_is_staff(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT _uid IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = _uid AND p.is_active)
     AND NOT EXISTS (SELECT 1 FROM public.portal_accounts a WHERE a.user_id = _uid)
$$;

-- Staff G3/G4 (referente/transformador): administra cuentas y publicación.
CREATE OR REPLACE FUNCTION public.portal_is_staff_admin(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$ SELECT public.portal_is_staff(_uid) AND public.is_admin_or_manager(_uid) $$;

-- ¿El staff pertenece a la organización del cliente?
CREATE OR REPLACE FUNCTION public.portal_staff_in_client_org(_uid uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT public.portal_is_staff(_uid) AND EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.id = _client_id AND c.organization_id = public.get_user_org_id(_uid)
  )
$$;

-- Clientes a los que el usuario del portal tiene acceso HOY.
CREATE OR REPLACE FUNCTION public.portal_my_client_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT m.client_id
    FROM public.portal_memberships m
    JOIN public.portal_accounts a ON a.user_id = m.user_id
   WHERE m.user_id = auth.uid()
     AND a.status = 'activa'
     AND m.status = 'activa'
$$;

CREATE OR REPLACE FUNCTION public.portal_can_read_client(_client_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$ SELECT _client_id IN (SELECT public.portal_my_client_ids()) $$;

CREATE OR REPLACE FUNCTION public.portal_has_client_role(_client_id uuid, _roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.portal_memberships m
      JOIN public.portal_accounts a ON a.user_id = m.user_id
     WHERE m.user_id = auth.uid()
       AND m.client_id = _client_id
       AND a.status = 'activa'
       AND m.status = 'activa'
       AND m.role = ANY (_roles)
  )
$$;

CREATE OR REPLACE FUNCTION public.portal_my_tier()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$ SELECT tier FROM public.portal_accounts WHERE user_id = auth.uid() AND status = 'activa' $$;

-- Staff asignado al cliente (bandeja de mensajes): responsable, colaborador,
-- acceso global, responsable de bandeja, o G3/G4.
CREATE OR REPLACE FUNCTION public.portal_staff_assigned_to_client(_uid uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT public.portal_staff_in_client_org(_uid, _client_id) AND (
       public.is_admin_or_manager(_uid)
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = _uid AND p.has_global_client_access)
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = _client_id AND c.responsible_user_id = _uid)
    OR EXISTS (SELECT 1 FROM public.client_collaborators cc WHERE cc.client_id = _client_id AND cc.user_id = _uid)
    OR EXISTS (SELECT 1 FROM public.portal_client_settings s WHERE s.client_id = _client_id AND s.inbox_owner_user_id = _uid)
  )
$$;

-- Organización de un cliente (para policies que no deben leer `clients` con la RLS del invocador).
CREATE OR REPLACE FUNCTION public.portal_client_org_id(_client_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT c.organization_id FROM public.clients c
   WHERE c.id = _client_id
     AND (auth.uid() IS NULL
          OR c.id IN (SELECT public.portal_my_client_ids())
          OR (public.portal_is_staff(auth.uid()) AND c.organization_id = public.get_user_org_id(auth.uid())))
$$;

-- ¿El usuario del portal tiene algún cliente en esa organización?
CREATE OR REPLACE FUNCTION public.portal_can_read_org(_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.clients c
                  WHERE c.organization_id = _org_id AND c.id IN (SELECT public.portal_my_client_ids()))
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'portal_is_portal_user(uuid)', 'portal_is_staff(uuid)', 'portal_is_staff_admin(uuid)',
    'portal_staff_in_client_org(uuid, uuid)', 'portal_my_client_ids()',
    'portal_can_read_client(uuid)', 'portal_has_client_role(uuid, text[])', 'portal_my_tier()',
    'portal_staff_assigned_to_client(uuid, uuid)', 'portal_client_org_id(uuid)', 'portal_can_read_org(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- Escritura de bitácora (interna: la llaman las funciones del portal y service_role).
CREATE OR REPLACE FUNCTION public.portal_audit(
  _action text,
  _client_id uuid DEFAULT NULL,
  _entity_type text DEFAULT NULL,
  _entity_id text DEFAULT NULL,
  _details jsonb DEFAULT '{}'::jsonb,
  _actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_actor uuid := COALESCE(_actor, auth.uid());
  v_kind text;
  v_email text;
  v_org uuid;
BEGIN
  IF v_actor IS NULL THEN
    v_kind := 'sistema';
  ELSIF EXISTS (SELECT 1 FROM public.portal_accounts WHERE user_id = v_actor) THEN
    v_kind := 'portal';
    SELECT email INTO v_email FROM public.portal_accounts WHERE user_id = v_actor;
  ELSE
    v_kind := 'staff';
    SELECT email INTO v_email FROM public.profiles WHERE user_id = v_actor;
  END IF;
  IF _client_id IS NOT NULL THEN
    SELECT organization_id INTO v_org FROM public.clients WHERE id = _client_id;
  END IF;
  INSERT INTO public.portal_audit_log
    (actor_user_id, actor_kind, actor_email, organization_id, client_id, action, entity_type, entity_id, details)
  VALUES
    (v_actor, v_kind, v_email, v_org, _client_id, _action, _entity_type, _entity_id, COALESCE(_details, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.portal_audit(text, uuid, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_audit(text, uuid, text, text, jsonb, uuid) TO service_role;

-- ── 7. Exclusión mutua staff ↔ portal ───────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_block_staff_rows_for_portal_accounts()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.portal_accounts WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Una cuenta del portal del cliente no puede tener % (usuario %)', TG_TABLE_NAME, NEW.user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_block_staff_rows_for_portal_accounts() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_portal_block_profiles ON public.profiles;
CREATE TRIGGER trg_portal_block_profiles
  BEFORE INSERT OR UPDATE OF user_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.portal_block_staff_rows_for_portal_accounts();

DROP TRIGGER IF EXISTS trg_portal_block_user_roles ON public.user_roles;
CREATE TRIGGER trg_portal_block_user_roles
  BEFORE INSERT OR UPDATE OF user_id ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.portal_block_staff_rows_for_portal_accounts();

CREATE OR REPLACE FUNCTION public.portal_block_portal_account_for_staff()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'El usuario % ya es del equipo Kawiil; no puede ser cuenta del portal', NEW.user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_block_portal_account_for_staff() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_portal_accounts_not_staff ON public.portal_accounts;
CREATE TRIGGER trg_portal_accounts_not_staff
  BEFORE INSERT ON public.portal_accounts
  FOR EACH ROW EXECUTE FUNCTION public.portal_block_portal_account_for_staff();

-- ── 8. handle_new_user: rama del portal ─────────────────────────────
-- Se conserva idéntico el comportamiento para el equipo. Solo se agrega la
-- rama: alta marcada kawiil_portal → portal_accounts y RETURN, sin perfil.
-- La marca solo puede BAJAR privilegios (quien la ponga no obtiene nada).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_temp', 'public'
AS $$
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'kawiil_portal', '') = 'true'
     OR COALESCE(NEW.raw_app_meta_data->>'kawiil_portal', '') = 'true' THEN
    INSERT INTO public.portal_accounts (user_id, email, full_name, created_via)
    VALUES (
      NEW.id,
      COALESCE(NEW.email, ''),
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      CASE WHEN NEW.raw_app_meta_data->>'portal_created_via' = 'invitacion' THEN 'invitacion' ELSE 'registro' END
    )
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (user_id, organization_id, email, full_name)
  VALUES (
    NEW.id,
    'a0000000-0000-0000-0000-000000000001',
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'en_formacion');

  RETURN NEW;
END;
$$;

-- ── 9. updated_at ───────────────────────────────────────────────────
DROP TRIGGER IF EXISTS update_portal_accounts_updated_at ON public.portal_accounts;
CREATE TRIGGER update_portal_accounts_updated_at BEFORE UPDATE ON public.portal_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_portal_memberships_updated_at ON public.portal_memberships;
CREATE TRIGGER update_portal_memberships_updated_at BEFORE UPDATE ON public.portal_memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_portal_client_settings_updated_at ON public.portal_client_settings;
CREATE TRIGGER update_portal_client_settings_updated_at BEFORE UPDATE ON public.portal_client_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 10. RLS ─────────────────────────────────────────────────────────
-- Lecturas por RLS; toda escritura del portal pasa por funciones SECURITY
-- DEFINER (abajo) que verifican rol y cliente.
DROP POLICY IF EXISTS portal_config_select ON public.portal_config;
CREATE POLICY portal_config_select ON public.portal_config
  FOR SELECT TO authenticated USING (public.portal_is_staff(auth.uid()));
DROP POLICY IF EXISTS portal_config_update ON public.portal_config;
CREATE POLICY portal_config_update ON public.portal_config
  FOR UPDATE TO authenticated
  USING (public.portal_is_staff(auth.uid()) AND public.has_role(auth.uid(), 'transformador'))
  WITH CHECK (public.portal_is_staff(auth.uid()) AND public.has_role(auth.uid(), 'transformador'));

DROP POLICY IF EXISTS portal_accounts_select_self ON public.portal_accounts;
CREATE POLICY portal_accounts_select_self ON public.portal_accounts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS portal_accounts_select_staff ON public.portal_accounts;
CREATE POLICY portal_accounts_select_staff ON public.portal_accounts
  FOR SELECT TO authenticated USING (
    public.portal_is_staff(auth.uid()) AND (
      NOT EXISTS (SELECT 1 FROM public.portal_memberships m WHERE m.user_id = portal_accounts.user_id)
      OR EXISTS (SELECT 1 FROM public.portal_memberships m
                  WHERE m.user_id = portal_accounts.user_id
                    AND m.organization_id = public.get_user_org_id(auth.uid()))
    )
  );

DROP POLICY IF EXISTS portal_memberships_select_self ON public.portal_memberships;
CREATE POLICY portal_memberships_select_self ON public.portal_memberships
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS portal_memberships_select_staff ON public.portal_memberships;
CREATE POLICY portal_memberships_select_staff ON public.portal_memberships
  FOR SELECT TO authenticated USING (
    public.portal_is_staff(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid())
  );

DROP POLICY IF EXISTS portal_client_settings_select_portal ON public.portal_client_settings;
CREATE POLICY portal_client_settings_select_portal ON public.portal_client_settings
  FOR SELECT TO authenticated USING (public.portal_can_read_client(client_id));
DROP POLICY IF EXISTS portal_client_settings_select_staff ON public.portal_client_settings;
CREATE POLICY portal_client_settings_select_staff ON public.portal_client_settings
  FOR SELECT TO authenticated USING (
    public.portal_is_staff(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid())
  );

-- Los textos legales son públicos (se muestran antes de crear la cuenta).
DROP POLICY IF EXISTS portal_legal_documents_read ON public.portal_legal_documents;
CREATE POLICY portal_legal_documents_read ON public.portal_legal_documents
  FOR SELECT TO anon, authenticated USING (published_at IS NOT NULL OR public.portal_is_staff(auth.uid()));
DROP POLICY IF EXISTS portal_legal_documents_write ON public.portal_legal_documents;
CREATE POLICY portal_legal_documents_write ON public.portal_legal_documents
  FOR INSERT TO authenticated WITH CHECK (public.portal_is_staff_admin(auth.uid()));

DROP POLICY IF EXISTS portal_legal_acceptances_select_self ON public.portal_legal_acceptances;
CREATE POLICY portal_legal_acceptances_select_self ON public.portal_legal_acceptances
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS portal_legal_acceptances_select_staff ON public.portal_legal_acceptances;
CREATE POLICY portal_legal_acceptances_select_staff ON public.portal_legal_acceptances
  FOR SELECT TO authenticated USING (
    public.portal_is_staff(auth.uid())
    AND (client_id IS NULL OR public.portal_staff_in_client_org(auth.uid(), client_id))
  );
REVOKE INSERT, UPDATE, DELETE ON public.portal_legal_acceptances FROM anon, authenticated;

DROP POLICY IF EXISTS portal_audit_select_staff ON public.portal_audit_log;
CREATE POLICY portal_audit_select_staff ON public.portal_audit_log
  FOR SELECT TO authenticated USING (
    public.portal_is_staff(auth.uid())
    AND (organization_id = public.get_user_org_id(auth.uid())
         OR (organization_id IS NULL AND public.is_admin_or_manager(auth.uid())))
  );

-- Nadie escribe directo estas tablas desde el navegador.
REVOKE INSERT, UPDATE, DELETE ON public.portal_accounts, public.portal_memberships, public.portal_client_settings
  FROM anon, authenticated;
REVOKE ALL ON public.portal_config FROM anon;

-- ── 11. RPC del portal (cliente) ────────────────────────────────────

-- Versión vigente de un texto legal.
CREATE OR REPLACE FUNCTION public.portal_current_legal(_kind text)
RETURNS public.portal_legal_documents
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT * FROM public.portal_legal_documents
   WHERE kind = _kind AND published_at IS NOT NULL AND published_at <= now()
   ORDER BY published_at DESC, created_at DESC
   LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.portal_current_legal(text) TO anon, authenticated;

-- Estado de la sesión: cuenta, clientes y textos pendientes de aceptar.
CREATE OR REPLACE FUNCTION public.portal_me()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_acc public.portal_accounts;
  v_pending jsonb;
  v_clients jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sin sesión' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_acc FROM public.portal_accounts WHERE user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_portal_account', false);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', d.kind, 'version', d.version, 'title', d.title)), '[]'::jsonb)
    INTO v_pending
    FROM (SELECT (public.portal_current_legal(k)).* FROM unnest(ARRAY['aviso_privacidad', 'terminos']) k) d
   WHERE d.id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.portal_legal_acceptances a
                      WHERE a.user_id = v_uid AND a.document_id = d.id);

  IF v_acc.status = 'activa' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'client_id', c.id, 'client_name', c.name, 'rfc', c.rfc, 'role', m.role,
             'emission_enabled', COALESCE(s.emission_enabled, false),
             'origin', COALESCE(s.origin, 'kawiil'),
             'tickets_enabled', (v_acc.tier = 'premier' OR COALESCE(s.basic_tickets_enabled, false))
           ) ORDER BY c.name), '[]'::jsonb)
      INTO v_clients
      FROM public.portal_memberships m
      JOIN public.clients c ON c.id = m.client_id
      LEFT JOIN public.portal_client_settings s ON s.client_id = c.id
     WHERE m.user_id = v_uid AND m.status = 'activa';
  ELSE
    v_clients := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'is_portal_account', true,
    'user_id', v_acc.user_id,
    'email', v_acc.email,
    'full_name', v_acc.full_name,
    'status', v_acc.status,
    'tier', v_acc.tier,
    'clients', v_clients,
    'pending_legal', v_pending
  );
END;
$$;
REVOKE ALL ON FUNCTION public.portal_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_me() TO authenticated;

-- Aceptar la versión vigente de un texto legal.
CREATE OR REPLACE FUNCTION public.portal_accept_legal(_kind text, _client_id uuid DEFAULT NULL, _user_agent text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_doc public.portal_legal_documents;
  v_email text;
BEGIN
  SELECT email INTO v_email FROM public.portal_accounts WHERE user_id = v_uid;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Solo cuentas del portal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _kind NOT IN ('aviso_privacidad', 'terminos', 'contrato_uso') THEN
    RAISE EXCEPTION 'Texto no aceptable desde el portal: %', _kind;
  END IF;
  IF _client_id IS NOT NULL AND NOT public.portal_has_client_role(_client_id, ARRAY['administrador']) THEN
    RAISE EXCEPTION 'Sin permiso sobre el cliente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_doc := public.portal_current_legal(_kind);
  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'No hay versión vigente de %', _kind;
  END IF;
  INSERT INTO public.portal_legal_acceptances (user_id, user_email, client_id, document_id, kind, version, user_agent)
  VALUES (v_uid, v_email, _client_id, v_doc.id, v_doc.kind, v_doc.version, left(_user_agent, 300));
  PERFORM public.portal_audit('legal_aceptacion', _client_id, 'portal_legal_documents', v_doc.id::text,
    jsonb_build_object('kind', v_doc.kind, 'version', v_doc.version));
  RETURN jsonb_build_object('kind', v_doc.kind, 'version', v_doc.version, 'accepted_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.portal_accept_legal(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_accept_legal(text, uuid, text) TO authenticated;

-- Registro de acceso (al iniciar sesión).
CREATE OR REPLACE FUNCTION public.portal_log_access(_client_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
BEGIN
  IF NOT public.portal_is_portal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Solo cuentas del portal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _client_id IS NOT NULL AND NOT public.portal_can_read_client(_client_id) THEN
    _client_id := NULL;
  END IF;
  PERFORM public.portal_audit('acceso', _client_id, NULL, NULL, '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_log_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_log_access(uuid) TO authenticated;

-- Nivel básico: la cuenta pendiente crea su propio espacio (cliente prospecto).
CREATE OR REPLACE FUNCTION public.portal_activate_basic(_razon_social text, _rfc text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_acc public.portal_accounts;
  v_org uuid;
  v_limit int;
  v_client uuid;
  v_rfc text := upper(regexp_replace(COALESCE(_rfc, ''), '\s', '', 'g'));
BEGIN
  SELECT * INTO v_acc FROM public.portal_accounts WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo cuentas del portal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_acc.status <> 'pendiente' OR EXISTS (SELECT 1 FROM public.portal_memberships WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'La cuenta ya está vinculada';
  END IF;
  IF v_rfc !~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$' THEN
    RAISE EXCEPTION 'RFC con formato inválido';
  END IF;
  IF btrim(COALESCE(_razon_social, '')) = '' THEN
    RAISE EXCEPTION 'La razón social es obligatoria';
  END IF;
  SELECT basic_organization_id, default_basic_invoice_limit INTO v_org, v_limit FROM public.portal_config WHERE id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El nivel básico no está configurado (portal_config.basic_organization_id)';
  END IF;

  INSERT INTO public.clients (organization_id, name, rfc, client_type, status, notes)
  VALUES (v_org, btrim(_razon_social), v_rfc,
          CASE WHEN length(v_rfc) = 12 THEN 'persona_moral'::client_type ELSE 'persona_fisica'::client_type END,
          'prospecto', 'Alta desde el portal del cliente (nivel básico).')
  RETURNING id INTO v_client;

  INSERT INTO public.portal_client_settings (client_id, organization_id, origin, basic_invoice_limit)
  VALUES (v_client, v_org, 'basico', v_limit);

  INSERT INTO public.portal_memberships (organization_id, client_id, user_id, role, created_by)
  VALUES (v_org, v_client, v_uid, 'administrador', v_uid);

  UPDATE public.portal_accounts
     SET status = 'activa', tier = 'basico', linked_at = now(), linked_by = v_uid
   WHERE user_id = v_uid;

  PERFORM public.portal_audit('nivel_basico_activado', v_client, 'clients', v_client::text,
    jsonb_build_object('rfc', v_rfc));
  RETURN jsonb_build_object('client_id', v_client);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_activate_basic(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_activate_basic(text, text) TO authenticated;

-- ── 12. RPC del equipo (central) ────────────────────────────────────

-- Vincular una cuenta a un cliente (o agregar otro cliente a la misma persona).
CREATE OR REPLACE FUNCTION public.portal_staff_link_account(
  _user_id uuid, _client_id uuid, _role text, _tier text DEFAULT 'premier'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_m uuid;
BEGIN
  IF NOT (public.portal_is_staff_admin(v_me) AND public.portal_staff_in_client_org(v_me, _client_id)) THEN
    RAISE EXCEPTION 'Solo G3/G4 de la organización del cliente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _role NOT IN ('administrador', 'operativo', 'consulta') THEN RAISE EXCEPTION 'Rol inválido'; END IF;
  IF _tier NOT IN ('premier', 'basico') THEN RAISE EXCEPTION 'Nivel inválido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_accounts WHERE user_id = _user_id) THEN
    RAISE EXCEPTION 'La cuenta no existe en el portal';
  END IF;

  INSERT INTO public.portal_client_settings (client_id, organization_id)
  SELECT _client_id, c.organization_id FROM public.clients c WHERE c.id = _client_id
  ON CONFLICT (client_id) DO NOTHING;

  INSERT INTO public.portal_memberships (organization_id, client_id, user_id, role, created_by)
  SELECT c.organization_id, _client_id, _user_id, _role, v_me FROM public.clients c WHERE c.id = _client_id
  ON CONFLICT (client_id, user_id) DO UPDATE SET role = excluded.role, status = 'activa'
  RETURNING id INTO v_m;

  UPDATE public.portal_accounts
     SET status = CASE WHEN status = 'suspendida' THEN status ELSE 'activa' END,
         tier = _tier, linked_at = COALESCE(linked_at, now()), linked_by = COALESCE(linked_by, v_me)
   WHERE user_id = _user_id;

  PERFORM public.portal_audit('vinculacion', _client_id, 'portal_memberships', v_m::text,
    jsonb_build_object('user_id', _user_id, 'role', _role, 'tier', _tier));
  RETURN jsonb_build_object('membership_id', v_m);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_staff_set_membership(_membership_id uuid, _role text, _status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_row public.portal_memberships;
BEGIN
  SELECT * INTO v_row FROM public.portal_memberships WHERE id = _membership_id;
  IF NOT FOUND OR NOT (public.portal_is_staff_admin(v_me) AND public.portal_staff_in_client_org(v_me, v_row.client_id)) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _role NOT IN ('administrador', 'operativo', 'consulta') OR _status NOT IN ('activa', 'suspendida') THEN
    RAISE EXCEPTION 'Rol o estado inválido';
  END IF;
  UPDATE public.portal_memberships SET role = _role, status = _status WHERE id = _membership_id;
  PERFORM public.portal_audit('rol_cambio', v_row.client_id, 'portal_memberships', _membership_id::text,
    jsonb_build_object('user_id', v_row.user_id, 'antes', jsonb_build_object('role', v_row.role, 'status', v_row.status),
                       'despues', jsonb_build_object('role', _role, 'status', _status)));
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_staff_set_account(_user_id uuid, _tier text, _suspended boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_acc public.portal_accounts;
BEGIN
  SELECT * INTO v_acc FROM public.portal_accounts WHERE user_id = _user_id;
  IF NOT FOUND OR NOT public.portal_is_staff_admin(v_me) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Si la cuenta tiene clientes, al menos uno debe ser de la organización del staff.
  IF EXISTS (SELECT 1 FROM public.portal_memberships WHERE user_id = _user_id)
     AND NOT EXISTS (SELECT 1 FROM public.portal_memberships
                      WHERE user_id = _user_id AND organization_id = public.get_user_org_id(v_me)) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tier IS NOT NULL AND _tier NOT IN ('premier', 'basico') THEN RAISE EXCEPTION 'Nivel inválido'; END IF;

  IF _tier IS NOT NULL AND _tier IS DISTINCT FROM v_acc.tier THEN
    UPDATE public.portal_accounts SET tier = _tier WHERE user_id = _user_id;
    PERFORM public.portal_audit('nivel_cambio', NULL, 'portal_accounts', _user_id::text,
      jsonb_build_object('antes', v_acc.tier, 'despues', _tier));
  END IF;

  IF _suspended IS TRUE AND v_acc.status <> 'suspendida' THEN
    UPDATE public.portal_accounts SET status = 'suspendida', suspended_at = now(), suspended_by = v_me
     WHERE user_id = _user_id;
    PERFORM public.portal_audit('suspension', NULL, 'portal_accounts', _user_id::text, '{}'::jsonb);
  ELSIF _suspended IS FALSE AND v_acc.status = 'suspendida' THEN
    UPDATE public.portal_accounts
       SET status = CASE WHEN tier IS NOT NULL
                              AND EXISTS (SELECT 1 FROM public.portal_memberships WHERE user_id = _user_id)
                         THEN 'activa' ELSE 'pendiente' END,
           suspended_at = NULL, suspended_by = NULL
     WHERE user_id = _user_id;
    PERFORM public.portal_audit('reactivacion', NULL, 'portal_accounts', _user_id::text, '{}'::jsonb);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_staff_update_client_settings(
  _client_id uuid,
  _inbox_owner_user_id uuid DEFAULT NULL,
  _thread_sla_hours int DEFAULT NULL,
  _basic_invoice_limit int DEFAULT NULL,
  _basic_tickets_enabled boolean DEFAULT NULL,
  _clear_inbox_owner boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
BEGIN
  IF NOT (public.portal_is_staff_admin(auth.uid()) AND public.portal_staff_in_client_org(auth.uid(), _client_id)) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _inbox_owner_user_id IS NOT NULL AND NOT public.portal_staff_in_client_org(_inbox_owner_user_id, _client_id) THEN
    RAISE EXCEPTION 'El responsable debe ser del equipo de la organización';
  END IF;
  INSERT INTO public.portal_client_settings (client_id, organization_id)
  SELECT _client_id, c.organization_id FROM public.clients c WHERE c.id = _client_id
  ON CONFLICT (client_id) DO NOTHING;
  UPDATE public.portal_client_settings SET
    inbox_owner_user_id = CASE WHEN _clear_inbox_owner THEN NULL ELSE COALESCE(_inbox_owner_user_id, inbox_owner_user_id) END,
    thread_sla_hours = COALESCE(_thread_sla_hours, thread_sla_hours),
    basic_invoice_limit = COALESCE(_basic_invoice_limit, basic_invoice_limit),
    basic_tickets_enabled = COALESCE(_basic_tickets_enabled, basic_tickets_enabled)
  WHERE client_id = _client_id;
END;
$$;

-- Lista de cuentas para la pantalla de administración.
CREATE OR REPLACE FUNCTION public.portal_staff_accounts()
RETURNS TABLE (
  user_id uuid, email text, full_name text, status text, tier text, created_via text,
  created_at timestamptz, memberships jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT a.user_id, a.email, a.full_name, a.status, a.tier, a.created_via, a.created_at,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
                     'id', m.id, 'client_id', m.client_id, 'client_name', c.name,
                     'role', m.role, 'status', m.status) ORDER BY c.name)
                     FROM public.portal_memberships m JOIN public.clients c ON c.id = m.client_id
                    WHERE m.user_id = a.user_id
                      AND m.organization_id = public.get_user_org_id(auth.uid())), '[]'::jsonb)
    FROM public.portal_accounts a
   WHERE public.portal_is_staff(auth.uid())
     AND (NOT EXISTS (SELECT 1 FROM public.portal_memberships m WHERE m.user_id = a.user_id)
          OR EXISTS (SELECT 1 FROM public.portal_memberships m
                      WHERE m.user_id = a.user_id AND m.organization_id = public.get_user_org_id(auth.uid())))
   ORDER BY (a.status = 'pendiente') DESC, a.created_at DESC
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'portal_staff_link_account(uuid, uuid, text, text)',
    'portal_staff_set_membership(uuid, text, text)',
    'portal_staff_set_account(uuid, text, boolean)',
    'portal_staff_update_client_settings(uuid, uuid, int, int, boolean, boolean)',
    'portal_staff_accounts()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
