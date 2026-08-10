# Alertas de términos y audiencias de litigio

El cron `litigation-deadline-alerts` avisa automáticamente de los términos y
audiencias registrados en los juicios (`projects.lawsuit_details.deadlines[]`).

## Cómo funciona
- Recorre los juicios y evalúa cada término/audiencia **pendiente**.
- Avisa en ventanas: **T-7, T-3, T-1, el día (hoy) y vencido**.
- Deduplica por `(deadline_id, bucket)` en la tabla `litigation_deadline_alerts`
  → cada ventana avisa una sola vez.
- Destinatarios: el usuario **asignado** al término (+ asistentes que sean usuarios);
  si no hay, el **responsable del juicio**.
- Canal: **notificación in-app** (campana / `/notificaciones`) y **push** best-effort.

## Despliegue (lado Supabase)
1. Aplicar migración `20260810130000_litigation_deadline_alerts.sql` (`supabase db push`).
2. Desplegar: `supabase functions deploy litigation-deadline-alerts --no-verify-jwt`.
3. Programar el cron (1–2 veces al día, p. ej. 7:00 y 13:00 CDMX) invocando la función
   con el header `x-cron-secret: <CRON_SECRET>`. Requiere el secreto `CRON_SECRET`
   (el mismo que usan los demás crons) y `APP_ORIGIN` (para el enlace del push).

## Notas
- Reutiliza `notifications` + `sendWebPushToUsers` (mismo patrón que `cert-expiry-notifier`).
- No modifica el front: los avisos aparecen en el sistema de notificaciones existente.
