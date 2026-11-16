# Comunicación interna de Kawiil

Agente de Marketing **«Comunicación interna»** (`marketing_comunicacion_interna`) y avisos para el equipo.

## Qué hace
1. Dirección escribe qué quiere avisar («el lunes 16 no se trabajará») en **Agentes → Comunicación**.
2. El agente **redacta** el aviso con fechas exactas (título, mensaje, desde, hasta). Solo propone: no escribe nada.
3. Dirección **revisa, corrige y aprueba**. Solo entonces una **función del sistema** (`comunicacion-interna`) publica el aviso en `aviso_equipo`.
4. Mientras esté vigente, **cualquier persona con sesión** ve un aviso en pantalla al entrar a cualquier pantalla del sistema («Hoy no se trabaja…»). Se puede cerrar en la sesión; no bloquea nada.

Solo avisos en pantalla: **no hay correo, Slack ni WhatsApp**.

## Reglas
- El paso técnico (publicar el aviso por fecha) **no lo hace ningún agente con IA**: lo hace una función con permisos acotados, tras la aprobación de una persona de Dirección.
- Un aviso dura como máximo 31 días, no puede terminar antes de hoy y no puede contener contraseñas ni claves (se rechaza).
- Un aviso solo se **publica** o se **cancela**; no se borra ni se edita (queda el historial). Cada redacción y cada publicación quedan como corrida del agente (`mk_registrar_corrida`).
- El agente tiene instrucción de no incluir datos de clientes ni confidenciales. Los avisos los lee cualquier usuario autenticado: son para todo el equipo.

## Piezas
- Migración (pendiente de aplicar): `supabase/pendientes/20261116200000_marketing_comunicacion_interna.sql` (tabla `aviso_equipo` con RLS de solo lectura de publicados, agente en `agent_registry`, y las dos funciones de registro con el agente permitido). Reversa: `tools/marketing/rollback_comunicacion_interna.sql`. Prueba: `tools/marketing/prueba_comunicacion_interna_pglite.mjs`.
- Función: `supabase/functions/comunicacion-interna` (`redactar`, `publicar`, `cancelar`, `listar`; `verify_jwt = true`, solo `is_admin_or_manager`). Lógica pura y pruebas en `_shared/avisos.ts` y `_shared/avisos.test.ts`.
- Pantalla: banner `src/components/AvisosEquipo.tsx` (en `AppLayout`) y panel `src/components/agentes/ComunicacionInterna.tsx`.

## Orden de puesta en producción
1. Aplicar la migración (con la confirmación de Dirección) y mover el archivo a `supabase/migrations/` con la versión real.
2. Fusionar el PR (despliega la función y la pantalla). Si se fusiona antes, el banner simplemente no muestra nada (la lectura falla en silencio) y el panel avisa que no puede leer.
3. Secreto `ANTHROPIC_API_KEY`: ya existe en el proyecto (lo usan otras funciones).
