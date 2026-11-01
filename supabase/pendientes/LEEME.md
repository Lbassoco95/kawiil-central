# Pendiente de confirmación de Dirección — NO se despliega ni se ejecuta

Esta carpeta está fuera de `supabase/migrations/` y `supabase/functions/` a propósito: el flujo `deploy-supabase.yml`
aplica y despliega lo que hay en esas dos rutas al fusionar a main. Nada de aquí se mueve a ellas sin la confirmación
explícita de Dirección, escritura por escritura:
- `20261101120000_marketing_api_log.sql`: tabla `mk_api_log`.
- `marketing-metricool/`: función del conector de lectura.
- `20261101130000_marketing_nota_umbral_instagram.sql`: nota de la regla v1 de Instagram. (Dirección pidió registrarla con la función de cambio de regla, con motivo; este SQL se descartará por ese camino.)
