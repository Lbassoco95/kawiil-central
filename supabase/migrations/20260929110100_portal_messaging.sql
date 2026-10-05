-- =================================================================
-- Portal del cliente — M8: mensajería propia (camino A) + bandeja de salida.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-28
-- Rollback (a mano): migrations/2026-09-28_portal_messaging.rollback.sql
--
-- Slack NO es almacén: los mensajes viven aquí. A Slack solo sale un AVISO
-- (portal_outbox → Edge portal-notify). El correo al cliente sale igual.
-- =================================================================

CREATE TABLE IF NOT EXISTS public.portal_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- servicio = cliente premier con su equipo; contratacion = nivel básico que
  -- quiere contratar (cae en la bandeja «Prospectos»).
  kind text NOT NULL DEFAULT 'servicio' CHECK (kind IN ('servicio', 'contratacion')),
  subject text NOT NULL CHECK (btrim(subject) <> ''),
  status text NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto', 'resuelto')),
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  last_client_message_at timestamptz,
  last_staff_message_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid
);
ALTER TABLE public.portal_threads ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_portal_threads_client ON public.portal_threads (client_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_threads_org_kind ON public.portal_threads (organization_id, kind, status);

DROP TRIGGER IF EXISTS trg_portal_threads_org ON public.portal_threads;
CREATE TRIGGER trg_portal_threads_org
  BEFORE INSERT OR UPDATE OF client_id ON public.portal_threads
  FOR EACH ROW EXECUTE FUNCTION public.portal_inherit_client_org();
DROP TRIGGER IF EXISTS update_portal_threads_updated_at ON public.portal_threads;
CREATE TRIGGER update_portal_threads_updated_at BEFORE UPDATE ON public.portal_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.portal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.portal_threads(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  author_user_id uuid,
  author_kind text NOT NULL CHECK (author_kind IN ('cliente', 'equipo')),
  author_name text,
  body text NOT NULL CHECK (btrim(body) <> '' AND length(body) <= 10000),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.portal_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_portal_messages_thread ON public.portal_messages (thread_id, created_at);

CREATE TABLE IF NOT EXISTS public.portal_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.portal_messages(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes <= 20 * 1024 * 1024),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.portal_message_attachments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_portal_msg_att_message ON public.portal_message_attachments (message_id);

CREATE TABLE IF NOT EXISTS public.portal_message_reads (
  thread_id uuid NOT NULL REFERENCES public.portal_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);
ALTER TABLE public.portal_message_reads ENABLE ROW LEVEL SECURITY;

-- organization_id / client_id de mensajes y adjuntos se derivan del hilo.
CREATE OR REPLACE FUNCTION public.portal_inherit_thread_scope()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_org uuid; v_client uuid;
BEGIN
  IF TG_TABLE_NAME = 'portal_messages' THEN
    SELECT organization_id, client_id INTO v_org, v_client FROM public.portal_threads WHERE id = NEW.thread_id;
  ELSE
    SELECT organization_id, client_id INTO v_org, v_client FROM public.portal_messages WHERE id = NEW.message_id;
  END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'portal: padre inexistente'; END IF;
  NEW.organization_id := v_org;
  NEW.client_id := v_client;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_inherit_thread_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_portal_messages_scope ON public.portal_messages;
CREATE TRIGGER trg_portal_messages_scope BEFORE INSERT OR UPDATE ON public.portal_messages
  FOR EACH ROW EXECUTE FUNCTION public.portal_inherit_thread_scope();
DROP TRIGGER IF EXISTS trg_portal_msg_att_scope ON public.portal_message_attachments;
CREATE TRIGGER trg_portal_msg_att_scope BEFORE INSERT OR UPDATE ON public.portal_message_attachments
  FOR EACH ROW EXECUTE FUNCTION public.portal_inherit_thread_scope();

-- ── Bandeja de salida (avisos Slack y correos) ──────────────────────
CREATE TABLE IF NOT EXISTS public.portal_outbox (
  id bigserial PRIMARY KEY,
  channel text NOT NULL CHECK (channel IN ('slack', 'correo')),
  event text NOT NULL,
  organization_id uuid,
  client_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'enviado', 'error', 'omitido')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
ALTER TABLE public.portal_outbox ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_portal_outbox_pending ON public.portal_outbox (status, created_at) WHERE status = 'pendiente';
REVOKE ALL ON public.portal_outbox FROM anon, authenticated;
COMMENT ON TABLE public.portal_outbox IS
  'Avisos por despachar (Slack al equipo, correo al cliente). Solo service_role. Slack recibe un aviso, nunca la conversación.';

-- Correos de los administradores activos de un cliente.
CREATE OR REPLACE FUNCTION public.portal_client_admin_emails(_client_id uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT COALESCE(array_agg(DISTINCT a.email), '{}')
    FROM public.portal_memberships m
    JOIN public.portal_accounts a ON a.user_id = m.user_id
   WHERE m.client_id = _client_id AND m.status = 'activa' AND a.status = 'activa'
     AND m.role IN ('administrador', 'operativo', 'consulta') AND a.email <> ''
$$;
REVOKE ALL ON FUNCTION public.portal_client_admin_emails(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_enqueue(_channel text, _event text, _client_id uuid, _payload jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.clients WHERE id = _client_id;
  INSERT INTO public.portal_outbox (channel, event, organization_id, client_id, payload)
  VALUES (_channel, _event, v_org, _client_id, COALESCE(_payload, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.portal_enqueue(text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Tras cada mensaje: tiempos del hilo, bitácora y aviso.
CREATE OR REPLACE FUNCTION public.portal_after_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_thread public.portal_threads; v_client_name text;
BEGIN
  UPDATE public.portal_threads SET
    last_message_at = NEW.created_at,
    last_client_message_at = CASE WHEN NEW.author_kind = 'cliente' THEN NEW.created_at ELSE last_client_message_at END,
    last_staff_message_at = CASE WHEN NEW.author_kind = 'equipo' THEN NEW.created_at ELSE last_staff_message_at END,
    status = CASE WHEN NEW.author_kind = 'cliente' THEN 'abierto' ELSE status END
  WHERE id = NEW.thread_id
  RETURNING * INTO v_thread;

  SELECT name INTO v_client_name FROM public.clients WHERE id = NEW.client_id;

  PERFORM public.portal_audit('mensaje', NEW.client_id, 'portal_messages', NEW.id::text,
    jsonb_build_object('thread_id', NEW.thread_id, 'author_kind', NEW.author_kind), NEW.author_user_id);

  IF NEW.author_kind = 'cliente' THEN
    PERFORM public.portal_enqueue('slack', 'mensaje_nuevo', NEW.client_id, jsonb_build_object(
      'thread_id', NEW.thread_id, 'kind', v_thread.kind, 'subject', v_thread.subject,
      'client_name', v_client_name, 'assigned_to', v_thread.assigned_to));
  ELSE
    PERFORM public.portal_enqueue('correo', 'respuesta_equipo', NEW.client_id, jsonb_build_object(
      'thread_id', NEW.thread_id, 'subject', v_thread.subject, 'client_name', v_client_name,
      'to', to_jsonb(public.portal_client_admin_emails(NEW.client_id))));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_after_message() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_portal_after_message ON public.portal_messages;
CREATE TRIGGER trg_portal_after_message AFTER INSERT ON public.portal_messages
  FOR EACH ROW EXECUTE FUNCTION public.portal_after_message();

-- Visibilidad del staff: hilos de sus clientes asignados; prospectos, toda la organización.
CREATE OR REPLACE FUNCTION public.portal_staff_can_see_thread(_uid uuid, _thread_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portal_threads t
     WHERE t.id = _thread_id
       AND public.portal_staff_in_client_org(_uid, t.client_id)
       AND (t.kind = 'contratacion'
            OR t.assigned_to = _uid
            OR public.portal_staff_assigned_to_client(_uid, t.client_id))
  )
$$;
REVOKE ALL ON FUNCTION public.portal_staff_can_see_thread(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_staff_can_see_thread(uuid, uuid) TO authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS portal_threads_select_portal ON public.portal_threads;
CREATE POLICY portal_threads_select_portal ON public.portal_threads
  FOR SELECT TO authenticated USING (public.portal_can_read_client(client_id));
DROP POLICY IF EXISTS portal_threads_select_staff ON public.portal_threads;
CREATE POLICY portal_threads_select_staff ON public.portal_threads
  FOR SELECT TO authenticated USING (public.portal_staff_can_see_thread(auth.uid(), id));

DROP POLICY IF EXISTS portal_messages_select_portal ON public.portal_messages;
CREATE POLICY portal_messages_select_portal ON public.portal_messages
  FOR SELECT TO authenticated USING (public.portal_can_read_client(client_id));
DROP POLICY IF EXISTS portal_messages_select_staff ON public.portal_messages;
CREATE POLICY portal_messages_select_staff ON public.portal_messages
  FOR SELECT TO authenticated USING (public.portal_staff_can_see_thread(auth.uid(), thread_id));

DROP POLICY IF EXISTS portal_msg_att_select_portal ON public.portal_message_attachments;
CREATE POLICY portal_msg_att_select_portal ON public.portal_message_attachments
  FOR SELECT TO authenticated USING (public.portal_can_read_client(client_id));
DROP POLICY IF EXISTS portal_msg_att_select_staff ON public.portal_message_attachments;
CREATE POLICY portal_msg_att_select_staff ON public.portal_message_attachments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.portal_messages m
             WHERE m.id = message_id AND public.portal_staff_can_see_thread(auth.uid(), m.thread_id))
  );

DROP POLICY IF EXISTS portal_msg_reads_select ON public.portal_message_reads;
CREATE POLICY portal_msg_reads_select ON public.portal_message_reads
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.portal_threads t WHERE t.id = thread_id
             AND (public.portal_can_read_client(t.client_id) OR public.portal_staff_can_see_thread(auth.uid(), t.id)))
  );

REVOKE INSERT, UPDATE, DELETE ON public.portal_threads, public.portal_messages,
  public.portal_message_attachments, public.portal_message_reads FROM anon, authenticated;

-- ── RPC ─────────────────────────────────────────────────────────────

-- Adjuntos: [{storage_path, file_name, mime_type, size_bytes}] ya subidos al
-- bucket `portal` bajo {org}/{client}/mensajes/{thread}/.
CREATE OR REPLACE FUNCTION public.portal_insert_attachments(_message_id uuid, _thread_id uuid, _attachments jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_t public.portal_threads;
  v_prefix text;
  a jsonb;
BEGIN
  IF _attachments IS NULL OR jsonb_typeof(_attachments) <> 'array' THEN RETURN; END IF;
  SELECT * INTO v_t FROM public.portal_threads WHERE id = _thread_id;
  v_prefix := v_t.organization_id::text || '/' || v_t.client_id::text || '/mensajes/' || v_t.id::text || '/';
  FOR a IN SELECT * FROM jsonb_array_elements(_attachments) LOOP
    IF left(a->>'storage_path', length(v_prefix)) <> v_prefix OR (a->>'storage_path') LIKE '%..%' THEN
      RAISE EXCEPTION 'Ruta de adjunto fuera del hilo';
    END IF;
    INSERT INTO public.portal_message_attachments (message_id, organization_id, client_id, storage_path, file_name, mime_type, size_bytes)
    VALUES (_message_id, v_t.organization_id, v_t.client_id, a->>'storage_path',
            COALESCE(NULLIF(a->>'file_name', ''), 'archivo'), a->>'mime_type', NULLIF(a->>'size_bytes', '')::bigint);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_insert_attachments(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- El cliente abre un hilo. Básico: solo «contratacion».
CREATE OR REPLACE FUNCTION public.portal_thread_create(_client_id uuid, _subject text, _body text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tier text := public.portal_my_tier();
  v_thread uuid;
  v_name text;
BEGIN
  IF NOT public.portal_has_client_role(_client_id, ARRAY['administrador', 'operativo']) THEN
    RAISE EXCEPTION 'Sin permiso para escribir por este cliente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT COALESCE(full_name, email) INTO v_name FROM public.portal_accounts WHERE user_id = v_uid;
  INSERT INTO public.portal_threads (organization_id, client_id, kind, subject, created_by)
  SELECT c.organization_id, _client_id,
         CASE WHEN v_tier = 'basico' THEN 'contratacion' ELSE 'servicio' END,
         left(btrim(_subject), 200), v_uid
    FROM public.clients c WHERE c.id = _client_id
  RETURNING id INTO v_thread;
  INSERT INTO public.portal_messages (thread_id, organization_id, client_id, author_user_id, author_kind, author_name, body)
  VALUES (v_thread, '00000000-0000-0000-0000-000000000000', _client_id, v_uid, 'cliente', v_name, _body);
  INSERT INTO public.portal_message_reads (thread_id, user_id) VALUES (v_thread, v_uid)
  ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = now();
  RETURN v_thread;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_thread_create(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_thread_create(uuid, text, text) TO authenticated;

-- Enviar mensaje (cliente o equipo). El autor y el lado se deciden aquí, no en el navegador.
CREATE OR REPLACE FUNCTION public.portal_message_send(_thread_id uuid, _body text, _attachments jsonb DEFAULT '[]'::jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.portal_threads;
  v_kind text;
  v_name text;
  v_msg uuid;
BEGIN
  SELECT * INTO v_t FROM public.portal_threads WHERE id = _thread_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hilo inexistente' USING ERRCODE = 'insufficient_privilege'; END IF;

  IF public.portal_is_portal_user(v_uid) THEN
    IF NOT public.portal_has_client_role(v_t.client_id, ARRAY['administrador', 'operativo']) THEN
      RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_kind := 'cliente';
    SELECT COALESCE(full_name, email) INTO v_name FROM public.portal_accounts WHERE user_id = v_uid;
  ELSIF public.portal_staff_can_see_thread(v_uid, _thread_id) THEN
    v_kind := 'equipo';
    SELECT full_name INTO v_name FROM public.profiles WHERE user_id = v_uid;
  ELSE
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.portal_messages (thread_id, organization_id, client_id, author_user_id, author_kind, author_name, body)
  VALUES (_thread_id, v_t.organization_id, v_t.client_id, v_uid, v_kind, v_name, _body)
  RETURNING id INTO v_msg;
  PERFORM public.portal_insert_attachments(v_msg, _thread_id, _attachments);
  INSERT INTO public.portal_message_reads (thread_id, user_id) VALUES (_thread_id, v_uid)
  ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = now();
  RETURN v_msg;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_message_send(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_message_send(uuid, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_thread_mark_read(_thread_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_client uuid;
BEGIN
  SELECT client_id INTO v_client FROM public.portal_threads WHERE id = _thread_id;
  IF v_client IS NULL
     OR NOT (public.portal_can_read_client(v_client) OR public.portal_staff_can_see_thread(auth.uid(), _thread_id)) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.portal_message_reads (thread_id, user_id) VALUES (_thread_id, auth.uid())
  ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.portal_thread_mark_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_thread_mark_read(uuid) TO authenticated;

-- El equipo asigna o resuelve.
CREATE OR REPLACE FUNCTION public.portal_staff_thread_update(_thread_id uuid, _assigned_to uuid DEFAULT NULL, _status text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_t public.portal_threads;
BEGIN
  SELECT * INTO v_t FROM public.portal_threads WHERE id = _thread_id;
  IF NOT FOUND OR NOT public.portal_staff_can_see_thread(auth.uid(), _thread_id) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _assigned_to IS NOT NULL THEN
    IF NOT public.portal_staff_in_client_org(_assigned_to, v_t.client_id) THEN
      RAISE EXCEPTION 'Solo se asigna a personas del equipo';
    END IF;
    UPDATE public.portal_threads SET assigned_to = _assigned_to WHERE id = _thread_id;
    PERFORM public.portal_audit('hilo_asignacion', v_t.client_id, 'portal_threads', _thread_id::text,
      jsonb_build_object('assigned_to', _assigned_to));
  END IF;
  IF _status IS NOT NULL THEN
    IF _status NOT IN ('abierto', 'resuelto') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
    UPDATE public.portal_threads
       SET status = _status,
           resolved_at = CASE WHEN _status = 'resuelto' THEN now() ELSE NULL END,
           resolved_by = CASE WHEN _status = 'resuelto' THEN auth.uid() ELSE NULL END
     WHERE id = _thread_id;
    PERFORM public.portal_audit('hilo_estado', v_t.client_id, 'portal_threads', _thread_id::text,
      jsonb_build_object('status', _status));
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_staff_thread_update(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_staff_thread_update(uuid, uuid, text) TO authenticated;

-- Bandeja del equipo. `_kind` = 'servicio' (Clientes) o 'contratacion' (Prospectos).
-- sin_respuesta = el último mensaje es del cliente y lleva más del plazo configurable.
CREATE OR REPLACE FUNCTION public.portal_staff_inbox(_kind text DEFAULT 'servicio')
RETURNS TABLE (
  thread_id uuid, client_id uuid, client_name text, kind text, subject text, status text,
  assigned_to uuid, assigned_name text, inbox_owner_user_id uuid,
  last_message_at timestamptz, last_client_message_at timestamptz, last_staff_message_at timestamptz,
  unread_count bigint, overdue boolean, sla_hours int, last_body text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT t.id, t.client_id, c.name, t.kind, t.subject, t.status,
         t.assigned_to, pa.full_name, s.inbox_owner_user_id,
         t.last_message_at, t.last_client_message_at, t.last_staff_message_at,
         (SELECT count(*) FROM public.portal_messages m
           WHERE m.thread_id = t.id AND m.author_kind = 'cliente'
             AND m.created_at > COALESCE((SELECT r.last_read_at FROM public.portal_message_reads r
                                          WHERE r.thread_id = t.id AND r.user_id = auth.uid()), '-infinity'::timestamptz)),
         (t.status = 'abierto'
          AND t.last_client_message_at IS NOT NULL
          AND t.last_client_message_at > COALESCE(t.last_staff_message_at, '-infinity'::timestamptz)
          AND now() - t.last_client_message_at >
              make_interval(hours => COALESCE(s.thread_sla_hours, cfg.default_thread_sla_hours, 24))),
         COALESCE(s.thread_sla_hours, cfg.default_thread_sla_hours, 24),
         (SELECT left(m.body, 160) FROM public.portal_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1)
    FROM public.portal_threads t
    JOIN public.clients c ON c.id = t.client_id
    LEFT JOIN public.portal_client_settings s ON s.client_id = t.client_id
    LEFT JOIN public.profiles pa ON pa.user_id = t.assigned_to
    LEFT JOIN public.portal_config cfg ON cfg.id
   WHERE t.kind = _kind
     AND public.portal_staff_can_see_thread(auth.uid(), t.id)
   ORDER BY (t.status = 'abierto') DESC, t.last_message_at DESC NULLS LAST
$$;
REVOKE ALL ON FUNCTION public.portal_staff_inbox(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_staff_inbox(text) TO authenticated;

-- Estado de lectura para el cliente: ¿el equipo ya leyó mi último mensaje?
CREATE OR REPLACE FUNCTION public.portal_thread_read_state(_thread_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_client uuid; v_team_read timestamptz; v_client_read timestamptz;
BEGIN
  SELECT client_id INTO v_client FROM public.portal_threads WHERE id = _thread_id;
  IF v_client IS NULL
     OR NOT (public.portal_can_read_client(v_client) OR public.portal_staff_can_see_thread(auth.uid(), _thread_id)) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT max(r.last_read_at) INTO v_team_read FROM public.portal_message_reads r
   WHERE r.thread_id = _thread_id AND NOT public.portal_is_portal_user(r.user_id);
  SELECT max(r.last_read_at) INTO v_client_read FROM public.portal_message_reads r
   WHERE r.thread_id = _thread_id AND public.portal_is_portal_user(r.user_id);
  RETURN jsonb_build_object('team_last_read_at', v_team_read, 'client_last_read_at', v_client_read);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_thread_read_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_thread_read_state(uuid) TO authenticated;
