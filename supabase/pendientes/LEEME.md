# Pendiente de confirmación de Dirección — NO se despliega ni se ejecuta

Esta carpeta está fuera de `supabase/migrations/` y `supabase/functions/` a propósito: el flujo `deploy-supabase.yml`
despliega lo que hay en esas dos rutas al fusionar a main. Nada de aquí se mueve a ellas sin la confirmación
explícita de Dirección, escritura por escritura.

Ya aplicado en producción (2 nov 2026) y movido a sus rutas: `mk_api_log` (migración 20261102022104), la función
`marketing-metricool` y la migración `marketing_colchon` (20261102023909).

Sigue aquí:
- `marketing-colchon/index.ts`: versión 2 de la función del colchón (corrige el alta de casos: `mk_caso.numero` es identidad
  y no se envía; los errores ya no se callan). En producción está desplegada la versión 1, con ese defecto.
  Se mueve a `supabase/functions/marketing-colchon/` (con `verify_jwt = false` en config.toml) cuando Dirección confirme
  volver a desplegarla.
- `20261101130000_marketing_nota_umbral_instagram.sql`: nota de la regla v1 de Instagram. Dirección pidió registrarla con la
  función de cambio de regla, con motivo; este SQL se descartará por ese camino. Queda para después del 2 de noviembre.
