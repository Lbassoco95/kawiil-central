-- Caché persistente de perfiles de usuarios de Slack (nombre y avatar).
--
-- Antes la app pedía a Slack (users.info) el perfil de CADA usuario en cada
-- recarga, porque la única caché era en memoria de React Query. Eso disparaba
-- decenas de llamadas y provocaba rate-limit (429) → historial "se queda
-- cargando". Con esta tabla la Edge lee de aquí y solo consulta a Slack los
-- perfiles que faltan o llevan >7 días sin refrescarse.
--
-- Son perfiles del workspace (compartidos, no dato por-usuario): cualquier
-- usuario autenticado puede leerlos. La escritura la hace la Edge slack-api con
-- service_role (que omite RLS), así que no hacen falta políticas de INSERT/UPDATE.

CREATE TABLE IF NOT EXISTS public.slack_user_profiles (
  slack_user_id text PRIMARY KEY,
  display_name  text,
  real_name     text,
  avatar_url    text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.slack_user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "slack_user_profiles_read_authenticated" ON public.slack_user_profiles;
CREATE POLICY "slack_user_profiles_read_authenticated"
  ON public.slack_user_profiles FOR SELECT TO authenticated
  USING (true);
