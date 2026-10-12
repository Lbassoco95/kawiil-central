-- Seguridad: cerrar la lectura anónima de las tablas de agentes y la inserción
-- directa de tareas. Idempotente: se puede ejecutar más de una vez.
--
-- Antes:
--   · `anon_read_registry`, `anon_read_tasks` y `anon_read_logs` eran SELECT
--     `USING (true)` para el rol `public`: cualquiera con la clave `anon` (que va
--     en el JavaScript del sitio) leía tareas y resultados de los agentes, el
--     catálogo de agentes y sus logs.
--   · `auth_insert_tasks` dejaba a cualquier usuario con sesión insertar tareas
--     con cualquier agente. Nadie la usa: las tareas las crea la VM de agentes
--     (`kawiil-agents`, con service_role) detrás de `dispatch-to-agent`.
--
-- Ahora:
--   · Solo usuarios con sesión (`authenticated`) leen estas tablas. El front sigue
--     igual (las lee con la sesión del usuario) y `service_role` sigue pudiendo
--     todo porque se salta RLS.
--   · No se filtra por organización: los agentes, sus tareas y logs viven en la
--     organización global 00000000-0000-0000-0000-000000000001, distinta de la de
--     los usuarios. Acotar por `created_by` / rol queda como paso siguiente.
--   · Sin lectura para `anon` también a nivel de privilegios (defensa en profundidad).

DROP POLICY IF EXISTS "anon_read_registry" ON public.agent_registry;
DROP POLICY IF EXISTS "anon_read_tasks"    ON public.agent_tasks;
DROP POLICY IF EXISTS "anon_read_logs"     ON public.agent_activity_logs;
DROP POLICY IF EXISTS "auth_insert_tasks"  ON public.agent_tasks;

DROP POLICY IF EXISTS "authenticated_read_registry" ON public.agent_registry;
CREATE POLICY "authenticated_read_registry" ON public.agent_registry
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_tasks" ON public.agent_tasks;
CREATE POLICY "authenticated_read_tasks" ON public.agent_tasks
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_logs" ON public.agent_activity_logs;
CREATE POLICY "authenticated_read_logs" ON public.agent_activity_logs
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.agent_registry      FROM anon;
REVOKE ALL ON public.agent_tasks         FROM anon;
REVOKE ALL ON public.agent_activity_logs FROM anon;
