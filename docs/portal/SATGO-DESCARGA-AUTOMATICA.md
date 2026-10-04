# SATgo — descarga automática de facturas (CFDI)

Central descarga; Kawiil OS solo espeja. **No** cargar FIEL/CIEC en OS.

## Qué hay en el repo

| Pieza | Rol |
|---|---|
| `satgo-query` / `satgo-monthly` | CSF, 32D, 69-B, buzón (ya existentes) |
| `moffin-facturas` | CFDI on-demand vía Moffin Solutions + **CIEC** (manual UI) |
| **`satgo-facturas`** (nuevo) | CFDI emitidas+recibidas vía SATgo **`/api/v2/consultar/facfiel`** + FIEL JWE |
| Cron `satgo-facturas-cdmx` | Invoca la Edge en ventanas UTC; la Edge valida **08/15/21 America/Mexico_City** |
| `clients.portal_company_ref` | Mapeo a `company_ref` de OS para `invoice.publish` |

## Gate FIEL

La descarga automática **solo** incluye clientes con:

1. RFC en `clients`
2. Fila `client_sat_certificates` (`cert_type=fiel`) con `satgo_key_jwe` + `satgo_password_jwe` + `.cer` cifrado
3. `MOFFIN_FIEL_SECRET` (≥32) en Edge Secrets (descifrado del `.cer`)

Sin e.firma JWE → el cliente **no entra** al lote. En la ficha SAT de central se muestra el badge **CFDI auto: bloqueado (falta FIEL)** o **CFDI auto 08/15/21 CDMX**.

## Horario (CDMX confirmado)

Zona: **`America/Mexico_City`** (CST/CDT).

| Hora local | Acción |
|---|---|
| 08:00 | Descarga emitidas + recibidas (lookback configurable, default 3 días) |
| 15:00 | Igual |
| 21:00 | Igual |

pg_cron corre a `5 2,3,13,14,20,21 * * *` UTC; si la hora local no es 8/15/21, la Edge responde `outside_cdmx_window` (no-op). Ensayo: `POST` con `{"force":true}`.

## Espejo OS

Ops Corte 3: `invoice.publish` firmada hacia `portal-system-api`.

Secretos en **central**:

- `KAWIIL_OS_SYSTEM_API_URL`
- `CENTRAL_TO_OS_SIGNING_SECRET`

Por cliente: `clients.portal_company_ref` = `external_ref` de la empresa en OS. Sin eso, los CFDI quedan en `satgo_cfdi_items` (central) y **no** cruzan al espejo.

## Checklist Polo

Ver guía operativa en el store del proyecto: `docs/satgo-descarga-automatica.md`.
