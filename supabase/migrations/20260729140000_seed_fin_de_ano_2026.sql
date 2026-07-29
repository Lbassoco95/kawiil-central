-- Carga inicial (seed) del evento real "Fin de Año 2026" en las tablas del
-- módulo de Actividades, con base en el hilo de Slack (17-jul) y el Excel
-- FIN DE AÑO 2026. Los datos quedan en la BASE DE DATOS (no hardcodeados en la
-- app): la interfaz los lee de estas tablas.
--
-- Resuelve organización y usuario a partir del perfil de Polo (por email) para
-- no depender de IDs fijos, y es idempotente: si el evento ya existe en esa
-- organización, no vuelve a insertarlo.

DO $$
DECLARE
  v_user uuid;
  v_org  uuid;
  v_activity uuid;
BEGIN
  -- Usuario/organización dueños del seed (Polo).
  SELECT user_id, organization_id
    INTO v_user, v_org
    FROM public.profiles
   WHERE lower(email) = 'lbassoco@kawiil.mx'
   LIMIT 1;

  IF v_user IS NULL OR v_org IS NULL THEN
    RAISE NOTICE 'Seed Fin de Año 2026 omitido: no se encontró el perfil lbassoco@kawiil.mx.';
    RETURN;
  END IF;

  -- Idempotencia: si ya existe la actividad en esta organización, no hacer nada.
  SELECT id INTO v_activity
    FROM public.activities
   WHERE organization_id = v_org AND name = 'Fin de Año 2026'
   LIMIT 1;

  IF v_activity IS NOT NULL THEN
    RAISE NOTICE 'Seed Fin de Año 2026 omitido: la actividad ya existe (%).', v_activity;
    RETURN;
  END IF;

  -- 1) La actividad.
  INSERT INTO public.activities
    (organization_id, name, activity_type, status, event_date, location,
     responsible_user_id, notes, created_by)
  VALUES
    (v_org, 'Fin de Año 2026', 'convivencia', 'planeacion', NULL,
     'CDMX — sede por definir', v_user,
     'Convivencia de fin de año. Base: hilo de Slack (17-jul) y Excel FIN DE AÑO 2026. '
     'Idea: rentar casa de viernes a sábado (diciembre) para convivir; cena/carne asada '
     'la noche del viernes y desayuno preparado por el equipo.',
     v_user)
  RETURNING id INTO v_activity;

  -- 2) Pendientes / seguimiento (las responsabilidades del hilo).
  INSERT INTO public.activity_items
    (activity_id, organization_id, title, responsible, status, sort_order, notes, created_by)
  VALUES
    (v_activity, v_org, 'Buscar casas / sede en CDMX (camas, cupo, que permitan fiestas)', 'Jesús García', 'en_proceso', 1, 'Debe caber todo el equipo.', v_user),
    (v_activity, v_org, 'Opciones de alimentos (cena y desayuno)', 'Polo / Jesús', 'en_proceso', 2, 'Carne asada o servicio de comida; desayuno lo prepara el equipo.', v_user),
    (v_activity, v_org, 'Termos, sudaderas y libretas 2027', 'Viridiana', 'pendiente', 3, 'Souvenirs de equipo.', v_user),
    (v_activity, v_org, 'Aguinaldos', 'Viridiana', 'pendiente', 4, 'Preparar cálculo y calendario de pago.', v_user),
    (v_activity, v_org, 'Relación de rifas', 'Jesús / Viridiana', 'pendiente', 5, 'Definir premios y dinámica.', v_user),
    (v_activity, v_org, 'Insumos: agua, papel, bebidas, desechables', 'Por asignar', 'pendiente', 6, 'Compra previa al evento.', v_user),
    (v_activity, v_org, 'Dinámicas / actividades de convivencia', 'Por asignar', 'pendiente', 7, NULL, v_user),
    (v_activity, v_org, 'Obsequios a personal de apoyo', 'Administración', 'pendiente', 8, 'Personal de apoyo: Martín, Óscar, Galileo, Jaime, Mary, Erandy, Estacionamiento.', v_user);

  -- 3) Asistentes (los 11 kawiilers).
  INSERT INTO public.activity_attendees
    (activity_id, organization_id, name, confirmed, created_by)
  SELECT v_activity, v_org, nombre, 'pendiente', v_user
    FROM unnest(ARRAY[
      'Polo', 'Viri', 'Jesús', 'Fernando', 'Montse', 'Sebastián',
      'Erik', 'Alan', 'Ángel', 'Habib', 'Administración'
    ]) AS nombre;

  -- 4) Proveedores / cotizaciones (lo que ya estaba capturado en el Excel).
  INSERT INTO public.activity_providers
    (activity_id, organization_id, category, name, description, unit_price, quantity, status, link, created_by)
  VALUES
    (v_activity, v_org, 'alimentos', 'DELIFOOD',
     'Parrillada de carnes: Picaña, Rib-Eye, Arrachera, New York y Costilla',
     245, 11, 'cotizacion', 'https://taquizasyparrilladasadomicilio.com', v_user);

  RAISE NOTICE 'Seed Fin de Año 2026 creado (actividad %).', v_activity;
END $$;
