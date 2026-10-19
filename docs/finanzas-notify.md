# Servicio interno de notificaciones (`notify`)

Punto único para enviar notificaciones por cualquier canal, reutilizando la
infraestructura ya existente del repo. Es el cimiento (P0.1) de Finanzas v3:
cobranza, alertas de liquidez, provisión de nómina, presupuestos, etc. lo
consumen para avisar a las personas.

## Piezas

| Archivo | Rol |
|---|---|
| `supabase/functions/_shared/notify.ts` | Núcleo reutilizable y **testeable** (validación, plantillas, envío por canal). Sin dependencias de Deno: el cliente Supabase y la config se inyectan. |
| `supabase/functions/_shared/notifyEnv.ts` | Carga la config de canales desde los secrets (`Deno.env`). |
| `supabase/functions/notify/index.ts` | Entrada HTTP (Edge Function) con auth dual (usuario / cron / service-role). |
| `src/lib/notifyClient.ts` | Wrapper de consumo desde el frontend (`invokeNotify`). |
| `src/lib/notify.test.ts` | Pruebas vitest del router de canal y del envío. |
| tabla `notification_log` | Bitácora de cada intento de envío (canal, destino, plantilla, estado, payload, `enviado_at`). |

## Canales

- **slack** — Web API `chat.postMessage` (`SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`). `destino` = ID de canal (`#general`) o de usuario (`Uxxxx`, abre DM); vacío = canal por defecto.
- **email** — Microsoft Graph app-only + `/users/{SENDER_EMAIL}/sendMail`. `destino` = dirección de correo.
- **whatsapp** — WhatsApp Business Cloud API (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`). Si faltan credenciales, el envío se **omite** sin fallar (stub listo para activar).
- **in_app** — inserta en la tabla `notifications` existente. `destino` = `user_id` (uuid); requiere `organization_id`.

## Secrets (Supabase → Edge Functions)

Reutiliza los mismos que ya usan otras funciones:

```
SLACK_BOT_TOKEN, SLACK_CHANNEL_ID
AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET   (o MICROSOFT_*)
SENDER_EMAIL                                              (default comercial@kawiil.mx)
WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID                  (opcionales; stub si faltan)
CRON_SECRET                                              (para invocación por crons)
```

## Cómo lo consume otro módulo

### Desde otra Edge Function (servidor)

```ts
import { sendNotification } from "../_shared/notify.ts";
import { loadNotifyConfigFromEnv } from "../_shared/notifyEnv.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const config = loadNotifyConfigFromEnv();

await sendNotification({ admin, config }, {
  canal: "email",
  destino: "cliente@empresa.com",
  plantilla: "cobranza_recordatorio",
  datos: { cliente: "Sylon", folio: "F-101", monto: 12345.6, moneda: "MXN", vencimiento: "2026-07-30" },
  organization_id: orgId,
});
```

### Vía HTTP (crons / otras funciones sin importar el módulo)

`POST /functions/v1/notify` con `x-cron-secret: <CRON_SECRET>` o `Authorization: Bearer <service-role|jwt>`:

```json
{ "canal": "slack", "destino": "#finanzas", "plantilla": "alerta_liquidez",
  "datos": { "titulo": "Saldo bajo", "detalle": "Revisar antes de la quincena", "monto": 50000 } }
```

Lote: `{ "notifications": [ {…}, {…} ] }`.

### Desde el frontend (React)

```ts
import { invokeNotify } from "@/lib/notifyClient";

await invokeNotify({
  canal: "in_app",
  destino: userId,
  plantilla: "generico",
  datos: { titulo: "Gasto aprobado", cuerpo: "Tu solicitud fue aprobada." },
});
```

## Plantillas

Definidas en `NOTIFICATION_TEMPLATES` (`_shared/notify.ts`), fáciles de extender:

- `raw` — usa `datos.subject` / `datos.text` / `datos.html` tal cual.
- `generico` — `titulo` + `cuerpo`.
- `cobranza_recordatorio` — `cliente`, `folio`, `monto`, `moneda`, `vencimiento`.
- `alerta_liquidez` — `titulo`, `detalle`, `monto`, `moneda`, `accion`.

Cada plantilla devuelve `{ subject, text, html }`; Slack usa `text` (con `**negritas**`→`*mrkdwn*`), email usa `html`.

## Respuesta

`{ ok, results: [{ canal, estado: "enviado"|"error"|"omitido", error? }] }`.
Todo intento —incluidos `omitido` y `error`— queda en `notification_log`.
