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

## Entrega 2 (preparado, sin aplicar; cada paso con su confirmación)
- **Conector con modo «forma»** — `marketing-metricool-forma/index.ts` + `../functions/_shared/metricoolForma.ts` (+ `metricoolAllowlist.ts`).
  Se pide con `operacion: "forma:<operación>"` y devuelve solo campos, tipos y una lista corta de números y códigos permitidos; el cuerpo
  completo no sale de la memoria de la función. **Falla cerrado**: un conector sin este modo rechaza `forma:...` como operación
  desconocida y no devuelve el cuerpo. Despliegue por herramienta con las importaciones reescritas a `./`, `verify_jwt = false`.
  Reglas de despliegue pedidas por Dirección: nunca entre las 6:30 y las 7:00 (Ciudad de México) y solo cuando se pueda ejecutar enseguida
  el colchón a mano para comprobar que sigue funcionando. Después se mueve a `supabase/functions/marketing-metricool/` para que el repo
  coincida con lo desplegado (mientras tanto, un redespliegue del flujo con la versión anterior no abre ningún hueco: falla cerrado).
- **Semáforo corregido** — `20261103000000_marketing_semaforo_corregido.sql` (escritura 2 de la Entrega 2). Corrección preventiva: una fila por
  pieza, corte `7d` si existe y si no `acumulado`. Hoy no cambia ningún promedio ni color. Prueba: `tools/marketing/prueba_semaforo_pglite.mjs`.
- Pruebas del modo forma: `supabase/functions/_shared/metricoolForma.test.ts` (incluye una prueba aleatoria con 400 documentos hostiles).

## Sigue aquí
- `20261101130000_marketing_nota_umbral_instagram.sql`: nota de la regla v1 de Instagram. Dirección pidió registrarla con la
  función de cambio de regla, con motivo; este SQL se descartará por ese camino. Queda para después.
