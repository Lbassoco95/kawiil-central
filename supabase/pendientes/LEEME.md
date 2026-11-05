# Pendiente de confirmación de Dirección — NO se despliega ni se ejecuta

Esta carpeta está fuera de `supabase/migrations/` y `supabase/functions/` a propósito: el flujo `deploy-supabase.yml`
despliega lo que hay en esas dos rutas al fusionar a main. Nada de aquí se mueve a ellas sin la confirmación
explícita de Dirección, escritura por escritura.

## Ya aplicado en producción (y en sus rutas definitivas)
- Migraciones: `marketing_analista_datos` (20261105191631), `mk_api_log` (20261102022104), `marketing_colchon` (20261102023909), `marketing_vigia_colchon` (20261102033958),
  `marketing_agentes_estado` (20261103203209), `marketing_registrar_agentes` (20261104015632; reversa en `tools/marketing/rollback_registrar_agentes.sql`),
  `marketing_registrar_corrida` (20261104165545) y `marketing_vigia_registra` (20261104165612) (reversas en `tools/marketing/rollback_registrar_corrida.sql` y `rollback_vigia_registra.sql`).
- Funciones: `marketing-metricool` (v7, con modo «forma») y `marketing-colchon` (v11, handler v6: registra tarea y latido), ambas con `verify_jwt = false` en `supabase/config.toml`.
- Trabajos programados 7:00 y 7:30 (registro en `tools/marketing/cron_colchon_0700.sql` y `cron_vigia_0730.sql`).
- Carga del Calendario Maestro nov–ene: `tools/marketing/carga_calendario_nov2026_ene2027.sql`.

## Sigue aquí (Entrega 2, escrituras 2–8, cada una con su confirmación)
- `20261103000000_marketing_semaforo_corregido.sql`: una fila por pieza (corte `7d` si existe, si no `acumulado`). Corrección preventiva;
  hoy no cambia ningún promedio ni color. Prueba: `tools/marketing/prueba_semaforo_pglite.mjs`.
- `20261101130000_marketing_nota_umbral_instagram.sql`: se descartará; Dirección pidió registrar la nota con `mk_cambiar_regla`, con motivo.

## Analista de resultados (fase 2; preparado, sin aplicar; ver `docs/marketing-equipo-agentes-diseno.md`, sección 12)
Orden, cada paso con confirmación de Dirección:
1. ~~`marketing_analista_datos`~~ **APLICADA el 5 nov 2026** (20261105191631, ya en `supabase/migrations/`): función de lectura `mk_analista_datos` (solo `service_role`). Reversa: `tools/marketing/rollback_analista_datos.sql`.
2. `20261105120100_marketing_analista_registro.sql`: agente `marketing_analista`, tabla `mk_consulta` (RLS, sin escritura para usuarios) y las dos funciones de registro de corridas ampliadas. Reversa: `tools/marketing/rollback_analista_registro.sql`.
3. Fusionar a `main` **después** de los pasos 1 y 2: el flujo despliega `marketing-agente` (`supabase/functions/`) y Vercel el panel.
4. Pregunta de prueba con la sesión de Dirección.
Pruebas: `tools/marketing/prueba_analista_pglite.mjs`; Node `supabase/functions/_shared/analista*.test.ts`.

