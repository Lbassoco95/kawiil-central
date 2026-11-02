# Pendiente de confirmación de Dirección — NO se despliega ni se ejecuta

Esta carpeta está fuera de `supabase/migrations/` y `supabase/functions/` a propósito: el flujo `deploy-supabase.yml`
despliega lo que hay en esas dos rutas al fusionar a main. Nada de aquí se mueve a ellas sin la confirmación
explícita de Dirección, escritura por escritura.

Ya aplicado en producción y movido a sus rutas: `mk_api_log` (migración 20261102022104), la función `marketing-metricool`
y la migración `marketing_colchon` (20261102023909). La carga del Calendario Maestro nov–ene se ejecutó desde
`tools/marketing/carga_calendario_nov2026_ene2027.sql`.

## Ronda de monitoreo de fallas (preparada, sin aplicar). Se confirma por separado, en este orden:
1. **Despliegue de `marketing-colchon` v5** — `marketing-colchon/index.ts` + `../functions/_shared/colchon.ts` + `../functions/_shared/colchon_run.ts`.
   En producción corre la v4. La v5 revisa todos los errores de escritura; si falla la lectura de Metricool abre o actualiza
   un único caso `falla_monitoreo` (sin duplicar) y lo cierra cuando una corrida posterior sale bien.
   (Despliegue por herramienta: las importaciones se reescriben a `./colchon.ts` y `./colchon_run.ts`; con `verify_jwt = false`.)
2. **Migración del vigía** — `20261102130000_marketing_vigia_colchon.sql` (función `mk_vigia_colchon`). Se renombra a la versión real al aplicarla.
3. **Trabajo de las 7:00** — `cron_colchon_0700.sql` (`marketing-colchon-diario-0700-cdmx`, 13:00 UTC).
4. **Trabajo de las 7:30** — `cron_vigia_0730.sql` (`marketing-colchon-vigia-0730-cdmx`, 13:30 UTC). Requiere el punto 2.

Pruebas: `node --experimental-strip-types --test supabase/functions/_shared/*.test.ts` y, para el vigía contra Postgres real en memoria,
`tools/marketing/prueba_vigia_pglite.mjs` (instrucciones en su encabezado).

## Sigue aquí
- `20261101130000_marketing_nota_umbral_instagram.sql`: nota de la regla v1 de Instagram. Dirección pidió registrarla con la
  función de cambio de regla, con motivo; este SQL se descartará por ese camino. Queda para después.
