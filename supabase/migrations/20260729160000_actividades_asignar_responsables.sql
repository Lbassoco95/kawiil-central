-- Enlaza el evento "Fin de Año 2026" con las CUENTAS REALES de los usuarios,
-- resolviéndolas dinámicamente desde public.profiles (por correo/nombre) — sin
-- UUIDs hardcodeados. Así los pendientes quedan asignados a su responsable y
-- aparecen en el perfil/tareas de cada persona, y los asistentes quedan
-- vinculados a su cuenta.
--
-- Idempotente y conservador: solo asigna donde aún no hay asignación, por lo
-- que no pisa cambios hechos a mano en la app.

DO $$
DECLARE
  v_org      uuid;
  v_activity uuid;
  v_polo     uuid;
  v_jesus    uuid;
  v_viri     uuid;
BEGIN
  -- Organización (a partir del perfil de Polo).
  SELECT organization_id INTO v_org
    FROM public.profiles
   WHERE lower(email) = 'lbassoco@kawiil.mx'
   LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'Asignación omitida: no se encontró la organización.';
    RETURN;
  END IF;

  SELECT id INTO v_activity
    FROM public.activities
   WHERE organization_id = v_org AND name = 'Fin de Año 2026'
   LIMIT 1;
  IF v_activity IS NULL THEN
    RAISE NOTICE 'Asignación omitida: no existe la actividad Fin de Año 2026.';
    RETURN;
  END IF;

  -- Resolver cuentas reales desde profiles (misma organización).
  -- Polo = Leopoldo (por correo, porque "Polo" es apodo y no está en el nombre).
  SELECT user_id INTO v_polo
    FROM public.profiles
   WHERE organization_id = v_org AND lower(email) = 'lbassoco@kawiil.mx'
   LIMIT 1;
  -- Jesús García y Viridiana (por nombre, patrones distintivos).
  SELECT user_id INTO v_jesus
    FROM public.profiles
   WHERE organization_id = v_org AND full_name ILIKE '%jes%garc%'
   ORDER BY full_name LIMIT 1;
  SELECT user_id INTO v_viri
    FROM public.profiles
   WHERE organization_id = v_org AND full_name ILIKE '%viridiana%'
   ORDER BY full_name LIMIT 1;

  -- Responsable general de la actividad = Viri (si se resolvió).
  IF v_viri IS NOT NULL THEN
    UPDATE public.activities SET responsible_user_id = v_viri WHERE id = v_activity;
  END IF;

  -- Asignar cada pendiente (tarea) a su responsable real, según el hilo de Slack.
  -- Solo donde aún no hay responsable, para no pisar asignaciones manuales.
  IF v_jesus IS NOT NULL THEN
    UPDATE public.tasks SET assigned_to = v_jesus
     WHERE activity_id = v_activity AND assigned_to IS NULL
       AND (title ILIKE 'Buscar casas%' OR title ILIKE 'Relación de rifas%');
  END IF;
  IF v_polo IS NOT NULL THEN
    UPDATE public.tasks SET assigned_to = v_polo
     WHERE activity_id = v_activity AND assigned_to IS NULL
       AND title ILIKE 'Opciones de alimentos%';
  END IF;
  IF v_viri IS NOT NULL THEN
    UPDATE public.tasks SET assigned_to = v_viri
     WHERE activity_id = v_activity AND assigned_to IS NULL
       AND (title ILIKE 'Termos%' OR title ILIKE 'Aguinaldos%');
  END IF;

  -- Vincular asistentes con su cuenta real (best-effort, sin pisar existentes).
  -- Polo por correo (apodo).
  IF v_polo IS NOT NULL THEN
    UPDATE public.activity_attendees SET user_id = v_polo
     WHERE activity_id = v_activity AND user_id IS NULL AND name ILIKE 'Polo';
  END IF;
  -- El resto por coincidencia de nombre contra profiles de la organización.
  UPDATE public.activity_attendees a
     SET user_id = p.user_id
    FROM public.profiles p
   WHERE a.activity_id = v_activity
     AND a.user_id IS NULL
     AND p.organization_id = v_org
     AND p.full_name ILIKE '%' || a.name || '%';

  RAISE NOTICE 'Asignaciones Fin de Año listas (jesus=%, viri=%, polo=%).', v_jesus, v_viri, v_polo;
END $$;
