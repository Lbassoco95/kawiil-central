-- =============================================================
-- AI Artifacts: permitir SELECT a miembros de la misma organización.
--
-- Hasta ahora la política única ("Users can manage their own artifacts")
-- exigía `user_id = auth.uid()` para CUALQUIER operación (incluido SELECT).
-- Esto provocaba que al abrir un artefacto desde un mensaje del chat el
-- cliente reciba 0 filas cuando el autor del artefacto era otro miembro
-- del equipo (por ejemplo, al retomar una conversación compartida) y
-- mostraba "No se encontró el artefacto".
--
-- Cambio:
--   - Se deja INSERT/UPDATE/DELETE restringido a `user_id = auth.uid()`
--     (cada usuario sigue pudiendo modificar solo sus artefactos).
--   - Se añade una política de SELECT amplia: cualquier usuario autenticado
--     de la misma `organization_id` puede leerlo. Service role mantiene
--     acceso total (ya definido en la migración base).
-- =============================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'ai_artifacts'
      AND policyname = 'Users can manage their own artifacts'
  ) THEN
    DROP POLICY "Users can manage their own artifacts" ON public.ai_artifacts;
  END IF;
END $$;

DROP POLICY IF EXISTS "Users can insert their own artifacts" ON public.ai_artifacts;
CREATE POLICY "Users can insert their own artifacts"
  ON public.ai_artifacts
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own artifacts" ON public.ai_artifacts;
CREATE POLICY "Users can update their own artifacts"
  ON public.ai_artifacts
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own artifacts" ON public.ai_artifacts;
CREATE POLICY "Users can delete their own artifacts"
  ON public.ai_artifacts
  FOR DELETE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Members of same org can view artifacts" ON public.ai_artifacts;
-- SELECT org-wide: cualquier miembro de la misma organización puede ver
-- el artefacto. Se resuelve `organization_id` via `profiles` del usuario
-- autenticado para evitar confiar solo en la fila remota.
CREATE POLICY "Members of same org can view artifacts"
  ON public.ai_artifacts
  FOR SELECT
  USING (
    organization_id IN (
      SELECT p.organization_id
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id IS NOT NULL
    )
  );
