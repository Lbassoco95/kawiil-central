# Pendiente de confirmación de Dirección — NO se despliega ni se ejecuta

Esta carpeta está fuera de `supabase/migrations/` y `supabase/functions/` a propósito: el flujo `deploy-supabase.yml`
despliega lo que hay en esas dos rutas al fusionar a main. Nada de aquí se mueve a ellas sin la confirmación
explícita de Dirección, escritura por escritura.

## Ya aplicado en producción (y en sus rutas definitivas)
- Migraciones: `mk_api_log` (20261102022104), `marketing_colchon` (20261102023909), `marketing_vigia_colchon` (20261102033958),
  `marketing_agentes_estado` (20261103203209), `marketing_registrar_agentes` (20261104015632; reversa en `tools/marketing/rollback_registrar_agentes.sql`).
- Funciones: `marketing-metricool` (v6, con modo «forma») y `marketing-colchon` (v5), ambas con `verify_jwt = false` en `supabase/config.toml`.
- Trabajos programados 7:00 y 7:30 (registro en `tools/marketing/cron_colchon_0700.sql` y `cron_vigia_0730.sql`).
- Carga del Calendario Maestro nov–ene: `tools/marketing/carga_calendario_nov2026_ene2027.sql`.

## Sigue aquí (Entrega 2, escrituras 2–8, cada una con su confirmación)
- `20261103000000_marketing_semaforo_corregido.sql`: una fila por pieza (corte `7d` si existe, si no `acumulado`). Corrección preventiva;
  hoy no cambia ningún promedio ni color. Prueba: `tools/marketing/prueba_semaforo_pglite.mjs`.
- `20261101130000_marketing_nota_umbral_instagram.sql`: se descartará; Dirección pidió registrar la nota con `mk_cambiar_regla`, con motivo.
