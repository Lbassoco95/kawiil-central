-- Permisos reales del módulo Actividades (hasta hoy "solo G4" era solo de pantalla).
--
--   * Administran una actividad: G4 (rol 'transformador'), quien sea su responsable y los
--     "ayudantes" que G4 asigne a esa actividad (tabla activity_managers).
--   * Los demás kawiilers NO leen actividades, asistentes, proveedores, archivos ni tareas de actividad.
--     Solo ven su propia invitación y lo que G4 marque como visible para el equipo (RPC mis_invitaciones).
--   * Las tareas ligadas a una actividad solo las ven quienes la administran, la persona asignada y quien la creó.
--
-- La página pública de invitación (función activity-rsvp, service role) no cambia.

-- ─── Funciones de apoyo ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_g4(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'transformador');
$$;

-- Ayudantes por actividad (kawiilers que G4 asigna; ven solo esa actividad).
CREATE TABLE IF NOT EXISTS public.activity_managers (
  activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_managers_user ON public.activity_managers (user_id);
ALTER TABLE public.activity_managers ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_manage_activity(_activity_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.activities a
     WHERE a.id = _activity_id
       AND a.organization_id = public.get_user_org_id(auth.uid())
       AND (
         public.is_g4(auth.uid())
         OR a.responsible_user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.activity_managers m
                     WHERE m.activity_id = a.id AND m.user_id = auth.uid())
       )
  );
$$;

REVOKE ALL ON FUNCTION public.is_g4(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_activity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_g4(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_activity(uuid) TO authenticated, service_role;

-- Ayudantes: los ve quien administra la actividad (y cada ayudante su propia fila); solo G4 asigna o quita.
DROP POLICY IF EXISTS "activity_managers_select" ON public.activity_managers;
CREATE POLICY "activity_managers_select" ON public.activity_managers FOR SELECT TO authenticated
  USING (public.can_manage_activity(activity_id) OR user_id = auth.uid());
DROP POLICY IF EXISTS "activity_managers_insert_g4" ON public.activity_managers;
CREATE POLICY "activity_managers_insert_g4" ON public.activity_managers FOR INSERT TO authenticated
  WITH CHECK (
    public.is_g4(auth.uid()) AND created_by = auth.uid()
    AND organization_id = public.get_user_org_id(auth.uid())
    AND activity_id IN (SELECT id FROM public.activities WHERE organization_id = public.get_user_org_id(auth.uid()))
  );
DROP POLICY IF EXISTS "activity_managers_delete_g4" ON public.activity_managers;
CREATE POLICY "activity_managers_delete_g4" ON public.activity_managers FOR DELETE TO authenticated
  USING (public.is_g4(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid()));
GRANT SELECT, INSERT, DELETE ON public.activity_managers TO authenticated;
GRANT ALL ON public.activity_managers TO service_role;

-- ─── Visibilidad para el equipo y vínculo con la cuenta ──────────────────────
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS team_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS team_announcement text;

-- Índice para buscar "mis invitaciones" por cuenta. (No es único: hoy hay asistentes de arranque
-- ligados a la misma cuenta; se corrigen desde la pantalla "Cuenta vinculada" del asistente.)
CREATE INDEX IF NOT EXISTS idx_activity_attendees_user
  ON public.activity_attendees (user_id) WHERE user_id IS NOT NULL;

-- ─── activities ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "activities_select_org" ON public.activities;
DROP POLICY IF EXISTS "activities_insert_org" ON public.activities;
DROP POLICY IF EXISTS "activities_update_org" ON public.activities;
DROP POLICY IF EXISTS "activities_delete_org" ON public.activities;
CREATE POLICY "activities_select_mgr" ON public.activities FOR SELECT TO authenticated
  USING (public.can_manage_activity(id));
CREATE POLICY "activities_insert_g4" ON public.activities FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()) AND public.is_g4(auth.uid()));
CREATE POLICY "activities_update_mgr" ON public.activities FOR UPDATE TO authenticated
  USING (public.can_manage_activity(id))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "activities_delete_g4" ON public.activities FOR DELETE TO authenticated
  USING (public.is_g4(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid()));

-- ─── Tablas hijas con activity_id ────────────────────────────────────────────
-- activity_attendees
DROP POLICY IF EXISTS "activity_attendees_select_org" ON public.activity_attendees;
DROP POLICY IF EXISTS "activity_attendees_insert_org" ON public.activity_attendees;
DROP POLICY IF EXISTS "activity_attendees_update_org" ON public.activity_attendees;
DROP POLICY IF EXISTS "activity_attendees_delete_org" ON public.activity_attendees;
CREATE POLICY "activity_attendees_select_mgr" ON public.activity_attendees FOR SELECT TO authenticated
  USING (public.can_manage_activity(activity_id));
CREATE POLICY "activity_attendees_insert_mgr" ON public.activity_attendees FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()) AND public.can_manage_activity(activity_id));
CREATE POLICY "activity_attendees_update_mgr" ON public.activity_attendees FOR UPDATE TO authenticated
  USING (public.can_manage_activity(activity_id))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.can_manage_activity(activity_id));
CREATE POLICY "activity_attendees_delete_mgr" ON public.activity_attendees FOR DELETE TO authenticated
  USING (public.can_manage_activity(activity_id));

-- activity_providers
DROP POLICY IF EXISTS "activity_providers_select_org" ON public.activity_providers;
DROP POLICY IF EXISTS "activity_providers_insert_org" ON public.activity_providers;
DROP POLICY IF EXISTS "activity_providers_update_org" ON public.activity_providers;
DROP POLICY IF EXISTS "activity_providers_delete_org" ON public.activity_providers;
CREATE POLICY "activity_providers_select_mgr" ON public.activity_providers FOR SELECT TO authenticated
  USING (public.can_manage_activity(activity_id));
CREATE POLICY "activity_providers_insert_mgr" ON public.activity_providers FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()) AND public.can_manage_activity(activity_id));
CREATE POLICY "activity_providers_update_mgr" ON public.activity_providers FOR UPDATE TO authenticated
  USING (public.can_manage_activity(activity_id))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.can_manage_activity(activity_id));
CREATE POLICY "activity_providers_delete_mgr" ON public.activity_providers FOR DELETE TO authenticated
  USING (public.can_manage_activity(activity_id));

-- activity_files
DROP POLICY IF EXISTS "activity_files_select_org" ON public.activity_files;
DROP POLICY IF EXISTS "activity_files_insert_org" ON public.activity_files;
DROP POLICY IF EXISTS "activity_files_update_org" ON public.activity_files;
DROP POLICY IF EXISTS "activity_files_delete_org" ON public.activity_files;
CREATE POLICY "activity_files_select_mgr" ON public.activity_files FOR SELECT TO authenticated
  USING (public.can_manage_activity(activity_id));
CREATE POLICY "activity_files_insert_mgr" ON public.activity_files FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()) AND public.can_manage_activity(activity_id));
CREATE POLICY "activity_files_update_mgr" ON public.activity_files FOR UPDATE TO authenticated
  USING (public.can_manage_activity(activity_id))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.can_manage_activity(activity_id));
CREATE POLICY "activity_files_delete_mgr" ON public.activity_files FOR DELETE TO authenticated
  USING (public.can_manage_activity(activity_id));

-- ─── Tablas hijas de proveedores y archivos ──────────────────────────────────
-- activity_provider_items
DROP POLICY IF EXISTS "activity_provider_items_select_org" ON public.activity_provider_items;
DROP POLICY IF EXISTS "activity_provider_items_insert_org" ON public.activity_provider_items;
DROP POLICY IF EXISTS "activity_provider_items_update_org" ON public.activity_provider_items;
DROP POLICY IF EXISTS "activity_provider_items_delete_org" ON public.activity_provider_items;
CREATE POLICY "activity_provider_items_select_mgr" ON public.activity_provider_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.activity_providers p WHERE p.id = provider_id AND public.can_manage_activity(p.activity_id)));
CREATE POLICY "activity_provider_items_insert_mgr" ON public.activity_provider_items FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND organization_id = public.get_user_org_id(auth.uid())
    AND EXISTS (SELECT 1 FROM public.activity_providers p WHERE p.id = provider_id AND public.can_manage_activity(p.activity_id)));
CREATE POLICY "activity_provider_items_update_mgr" ON public.activity_provider_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.activity_providers p WHERE p.id = provider_id AND public.can_manage_activity(p.activity_id)))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "activity_provider_items_delete_mgr" ON public.activity_provider_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.activity_providers p WHERE p.id = provider_id AND public.can_manage_activity(p.activity_id)));

-- activity_provider_comments (borrar sigue siendo solo lo propio: política activity_provider_comments_delete_own)
DROP POLICY IF EXISTS "activity_provider_comments_select_org" ON public.activity_provider_comments;
DROP POLICY IF EXISTS "activity_provider_comments_insert_org" ON public.activity_provider_comments;
CREATE POLICY "activity_provider_comments_select_mgr" ON public.activity_provider_comments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.activity_providers p WHERE p.id = provider_id AND public.can_manage_activity(p.activity_id)));
CREATE POLICY "activity_provider_comments_insert_mgr" ON public.activity_provider_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND organization_id = public.get_user_org_id(auth.uid())
    AND EXISTS (SELECT 1 FROM public.activity_providers p WHERE p.id = provider_id AND public.can_manage_activity(p.activity_id)));

-- activity_file_votes (borrar el propio voto sigue igual)
DROP POLICY IF EXISTS "activity_file_votes_select_org" ON public.activity_file_votes;
DROP POLICY IF EXISTS "activity_file_votes_insert_own" ON public.activity_file_votes;
CREATE POLICY "activity_file_votes_select_mgr" ON public.activity_file_votes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.activity_files f WHERE f.id = activity_file_id AND public.can_manage_activity(f.activity_id)));
CREATE POLICY "activity_file_votes_insert_mgr" ON public.activity_file_votes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND organization_id = public.get_user_org_id(auth.uid())
    AND EXISTS (SELECT 1 FROM public.activity_files f WHERE f.id = activity_file_id AND public.can_manage_activity(f.activity_id)));

-- ─── Tareas ligadas a una actividad ──────────────────────────────────────────
-- Las demás tareas de la organización siguen igual (activity_id IS NULL).
DROP POLICY IF EXISTS "Org users see tasks" ON public.tasks;
CREATE POLICY "Org users see tasks" ON public.tasks FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (activity_id IS NULL OR assigned_to = auth.uid() OR created_by = auth.uid() OR public.can_manage_activity(activity_id))
  );
DROP POLICY IF EXISTS "Org users create tasks" ON public.tasks;
CREATE POLICY "Org users create tasks" ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND (activity_id IS NULL OR public.can_manage_activity(activity_id))
  );
DROP POLICY IF EXISTS "Org users update tasks" ON public.tasks;
CREATE POLICY "Org users update tasks" ON public.tasks FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (activity_id IS NULL OR assigned_to = auth.uid() OR created_by = auth.uid() OR public.can_manage_activity(activity_id))
  )
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND (activity_id IS NULL OR assigned_to = auth.uid() OR public.can_manage_activity(activity_id))
  );

-- ─── Lo que ve un kawiiler invitado: su propia invitación ────────────────────
-- Solo filas ligadas a su cuenta, de actividades que G4 marcó como visibles para el equipo,
-- con los campos públicos (fecha, hora, sede confirmada y anuncio) y su propio estado.
CREATE OR REPLACE FUNCTION public.mis_invitaciones()
RETURNS TABLE (
  attendee_id uuid, activity_id uuid, activity_name text,
  event_date date, event_time time, location text, announcement text,
  confirmed text, responded boolean,
  has_plus_one boolean, plus_one_confirmed text,
  extra_guests_requested integer, extra_guests_status text,
  rsvp_token uuid
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT at.id, a.id, a.name,
         a.event_date, a.event_time,
         CASE WHEN a.venue_confirmed THEN a.location END,
         a.team_announcement,
         at.confirmed, at.rsvp_responded_at IS NOT NULL,
         at.has_plus_one, at.plus_one_confirmed,
         at.extra_guests_requested, at.extra_guests_status,
         at.rsvp_token
    FROM public.activity_attendees at
    JOIN public.activities a ON a.id = at.activity_id
   WHERE at.user_id = auth.uid()
     AND a.team_visible
     AND a.organization_id = public.get_user_org_id(auth.uid())
   ORDER BY a.event_date NULLS LAST, a.name;
$$;
REVOKE ALL ON FUNCTION public.mis_invitaciones() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mis_invitaciones() TO authenticated;
