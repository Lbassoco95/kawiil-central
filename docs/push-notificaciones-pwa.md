# Avisos al celular (PWA + Web Push)

Kawiil OS se instala como PWA (iPhone y Android, sin tienda) y avisa con la app cerrada mediante Web Push.

## Qué avisa y a quién

| Evento | Tipo en `notifications` | Quién lo recibe | Al tocar abre |
|---|---|---|---|
| Solicitud de ausencia/vacaciones por aprobar | `rh_request_pending` | Aprobador asignado (responsable de la célula) o, sin aprobador, los G4 | `/rh?rh=solicitudes` |
| Solicitud aprobada/rechazada | `rh_request_decided` | Quien la pidió | `/rh?rh=solicitudes` |
| Candidato nuevo | `rh_candidate_new` | Responsables de la vacante (`rh_process_owners`) o, sin responsables, los G4 | `/rh?rh=reclutamiento` |
| Aviso publicado del equipo | `aviso_equipo` | Toda la organización (menos quien lo aprobó) | `/` |
| Correo nuevo sin leer | `email_new` | Dueño de la cuenta (agrupado por corrida) | `/correo` |
| DM y menciones de Slack | `slack_message` / `slack_mention` | Ya existía (`slack-events`), no pasa por el puente | `/comunicacion` |

## Cómo funciona

```
evento → fila en notifications (campana) → trigger trg_push_bridge_notification (pg_net)
       → edge function push-from-notification → sendWebPushToUsers → sw.js muestra el aviso
```

- `supabase/migrations/20261117120000_push_bridge_notifications.sql`: triggers, tabla `email_push_state` y cron `push-email-poller` (cada 5 min).
- `supabase/functions/push-from-notification`: traduce tipo → ruta y envía el push. Auth: `x-cron-secret` (= `CRON_SECRET`).
- `supabase/functions/push-email-poller`: lee remitente/asunto de correos sin leer (Microsoft Graph y Gmail) desde la última marca. No marca ni modifica nada en los buzones. La primera vez que ve una cuenta solo guarda la marca.
- Las funciones nuevas atrapan sus errores: nunca bloquean el alta del candidato, el aviso o la solicitud.
- Para agregar un tipo nuevo: añadirlo al `when (...)` del trigger y a `RUTAS_PUSH` de `push-from-notification`.

## Que cada persona reciba los avisos

1. **iPhone**: abrir Kawiil en Safari → Compartir → *Añadir a pantalla de inicio* → abrir desde el ícono (iOS 16.4+; solo funciona instalada).
2. **Android**: Chrome → ⋮ → *Instalar app*.
3. Pulsar **Activar avisos** en la tarjeta que aparece dentro de la app (o en Notificaciones). Se registra el dispositivo y se enciende `profiles.desktop_push_notifications`.

Diagnóstico: Notificaciones → «Probar push» (`push-test`).

## Operación

- Secrets de Edge Functions necesarios: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET` (igual a `pipeline_cron_secret` del Vault), `MICROSOFT_*`, `GOOGLE_CLIENT_ID/SECRET`. Variable de frontend: `VITE_VAPID_PUBLIC_KEY`.
- Cuentas de Google con `status = 'error'` se omiten hasta que el usuario las reconecte.
- Un buzón de Microsoft que responde 404 se registra como `push-email-poller lectura: … Graph 404` y se omite sin afectar a los demás.

## Rollback

```sql
drop trigger if exists trg_push_bridge_notification on public.notifications;
drop trigger if exists trg_rh_candidate_notify_new on public.rh_candidates;
drop trigger if exists trg_aviso_equipo_notify on public.aviso_equipo;
select cron.unschedule('push-email-poller');
```
