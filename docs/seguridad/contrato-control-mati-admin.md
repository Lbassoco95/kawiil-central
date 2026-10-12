# Contrato: MATI Admin controla la seguridad de Kawiil (ola 1, solo lectura)

Para el equipo de MATI. Describe cómo **MATI API** consulta el estado de seguridad de Kawiil Central / Kawiil OS para mostrarlo en **MATI Admin**. Kawiil no se conecta a ningún sistema de MATI ni de Kit-to-Drive: solo expone esta función y MATI la llama.

- Endpoint: `POST https://qppfampapbxdgednkofc.supabase.co/functions/v1/seguridad-control`
- Solo servidor a servidor (sin CORS; no llamar desde el navegador). Versión del contrato: `1`.
- Esta ola es **solo lectura**. Las acciones de escritura (bloquear usuarios, cerrar sesiones, cambiar ajustes) son otra ola y requieren decisión aparte.

## 1. Credenciales (las genera MATI; se cargan como secretos de Kawiil)

| Secreto en Kawiil (Edge Functions) | Uso |
|---|---|
| `SEGURIDAD_CONTROL_TOKEN` | `Authorization: Bearer …` (≥ 32 caracteres) |
| `SEGURIDAD_CONTROL_HMAC_KEY` | Clave de la firma de cada petición (≥ 32 caracteres, **distinta** del token) |
| `*_PREVIOUS` de cada uno | Opcional: valor anterior durante una rotación (se aceptan ambos) |

Generar: `openssl rand -hex 32` (uno para el token, otro para la clave). Sin ellos la función responde `503 not_configured`. En MATI API van en variables de entorno del servidor, nunca en el navegador ni en el repo.

## 2. Cómo se firma cada petición

Cabeceras obligatorias:

```
Authorization:       Bearer <token>
x-control-timestamp: <segundos Unix actuales>
x-control-nonce:     <UUID nuevo en cada petición>
x-control-signature: hex( HMAC-SHA256(clave, "<timestamp>.<nonce>.POST.<sha256hex(cuerpo)>") )
x-mati-actor:        mati:<quién lo pidió en MATI Admin>   (ej. mati:ana@kawiil.mx)
Content-Type:        application/json
```

- `cuerpo` = el texto exacto que se envía (los mismos bytes que se firman).
- Ventana de hora: ±300 s. El nonce es de un solo uso (repetirlo → `401`).
- El actor queda en la bitácora de Kawiil; si no empieza con `mati:` se registra como `mati:(sin actor)`.

**Vector de prueba** (clave = `k` × 40, timestamp `1790000000`, nonce `11111111-2222-4333-8444-555555555555`, cuerpo `{"action":"status"}`):
`sha256(cuerpo)` = `c725469e2b09851166cc6c037cb8c4b5d743e9c17da53d43066e6750dd6ec0b5`
firma = `26ec4e1477d1fdae9aecdb2c18ce5dedd0b51d9ad00dd07fb80e19d95f2d39e8`

## 3. Cliente de ejemplo (Node 18+, en MATI API)

```js
import { createHash, createHmac, randomUUID } from "node:crypto";

export async function kawiilControl(action, params, actor) {
  const body = JSON.stringify(params ? { action, params } : { action });
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", process.env.KAWIIL_CONTROL_HMAC_KEY)
    .update(`${ts}.${nonce}.POST.${bodyHash}`).digest("hex");
  const res = await fetch(process.env.KAWIIL_CONTROL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.KAWIIL_CONTROL_TOKEN}`,
      "x-control-timestamp": ts,
      "x-control-nonce": nonce,
      "x-control-signature": signature,
      "x-mati-actor": `mati:${actor}`,
    },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error ?? "error"), { status: res.status, code: json.code });
  return json.data;
}
```

## 4. Acciones (lista cerrada)

Cuerpo: `{ "action": "...", "params": { ... } }`. Respuesta OK: `{ "contract": "1", "action": "...", "data": ... }`.

| action | params | data |
|---|---|---|
| `status` | — | `{contract, read_only, actions[], generated_at}` |
| `snapshot` | — | todo junto: `{posture, users, activity, secrets, findings[]}` (la llamada para el panel) |
| `posture` | — | tablas sin RLS, políticas abiertas, privilegios de `anon`, funciones SECURITY DEFINER expuestas, buckets públicos, extensiones en `public` |
| `users` | `limit` 1–1000 (500) | `{users:[{id, email enmascarado, full_name, roles, created_at, last_sign_in_at, email_confirmed, banned, mfa_enabled}]}` |
| `activity` | `hours` 1–168 (24) | `{available, window_hours, events_by_action, distinct_ips}` (sin IPs ni usuarios) |
| `secrets` | — | `{secrets:[{name, required, set, length_ok, purpose}]}` (nunca valores) |
| `audit` | `limit` 1–100 (50) | lo que MATI consultó: `{entries:[{created_at, action, outcome, http_status, user_email, detail}]}` |

`findings[]` viene ordenado por gravedad: `{id, severity: high|medium|low, title, count?, items?}`. El panel puede mostrarlo tal cual.

Cualquier otra clave en `params`, o una acción fuera de la lista → `400`.

## 5. Errores

| HTTP | `code` | Significado |
|---|---|---|
| 503 | `not_configured` | Faltan secretos en Kawiil |
| 401 | — | Token inválido |
| 401 | `signature_invalid` | Firma ausente/errónea, hora fuera de ventana o nonce repetido |
| 400 | `bad_request` / `unknown_action` / `bad_params` | Cuerpo o parámetros inválidos |
| 413 | `too_large` | Cuerpo > 8 KB |
| 429 | `rate_limited` | Más de 60 consultas por minuto |
| 500 | `internal` | Error interno (sin detalle) |

## 6. Qué garantiza Kawiil

- Solo lectura; nada que MATI envíe se ejecuta como SQL ni modifica datos.
- Correos de usuarios enmascarados; sin IPs; sin valores de secretos.
- Toda consulta autenticada queda en `integration_audit` (sistema `mati-control`), tabla append-only.
- Las funciones SQL que leen el estado solo las ejecuta el rol de servicio, con `search_path` fijo.
