# Actividades: quién ve y quién administra

Decisión de producto (Louis, nov 2026). Se aplica **en la base** (RLS), no solo en pantalla.
Migración: `supabase/migrations/20261123050000_actividades_permisos.sql`.

## Quién administra una actividad
- **G4** (rol `transformador`): todas las actividades; es el único que crea o borra actividades y asigna ayudantes.
- **Responsable** de la actividad (`responsible_user_id`; hoy es G4).
- **Ayudantes** asignados por G4 a esa actividad (tabla `activity_managers`, pestaña *Equipo y visibilidad*):
  ven el módulo Actividades con **solo** su actividad y manejan asistentes, proveedores, archivos y tareas de ella.

Función de apoyo: `can_manage_activity(activity_id)`; `is_g4(uid)`.

## Qué cubre
`activities`, `activity_attendees`, `activity_providers`, `activity_files`, `activity_provider_items`,
`activity_provider_comments`, `activity_file_votes` y las **tareas ligadas a una actividad** (`tasks.activity_id`).
Las tareas ligadas las ve quien administra la actividad, la persona asignada y quien la creó; el resto de las tareas de la
organización no cambia.

## Qué ve un kawiiler invitado (no administra)
Solo **su propia invitación**, en *Mis invitaciones* (`/mis-invitaciones`, RPC `mis_invitaciones()`), y solo si:
1. G4 encendió **“Visible para los invitados del equipo”** en la actividad, y
2. el asistente está **ligado a su cuenta** (campo *Cuenta de Kawiil* al editar al asistente).

Ve: si su invitación está confirmada o rechazada, su +1, el estado de sus invitados extra, la fecha, la hora, la sede (solo si
está confirmada) y el **anuncio** que G4 escribe. No ve a los demás invitados, proveedores, presupuesto ni nada más.

## Pendiente conocido
- Los archivos de actividades viven en Storage; sus políticas de bucket no se revisaron en este cambio.
- Hay asistentes de arranque ligados a la misma cuenta (p. ej. “Habib” y “Fernando”); corregir desde *Cuenta de Kawiil*.
