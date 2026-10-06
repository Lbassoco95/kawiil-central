# Despliegue de Edges del portal + secretos HMAC (ensayo / demo)

**NO FUSIONAR** hasta completar la lista del PR. Este documento no contiene valores secretos.

## Destinos autorizados

| Destino | Nombre | Project ref |
|---|---|---|
| Ensayo | `kawiil-os-ensayo` | `tglhceuszxcgkxmskdkl` |
| Demo | `kawiil-os-demo` | `ehtmlkvmiipmtcidsffk` |
| Central (prohibido) | — | `qppfampapbxdgednkofc` |

Los scripts en `tools/portal/` se detienen si el `--project-ref` no es ensayo o demo, o si es Central.

## Ubicación de scripts

En este repositorio el directorio `scripts/` está en `.gitignore`. Los comandos reproducibles viven en `tools/portal/` (misma allowlist ensayo/demo; leen `SUPABASE_ACCESS_TOKEN` del entorno).

## Requisitos

- `SUPABASE_ACCESS_TOKEN` en el entorno (Management API). **No** se lee de `.env` versionados ni se embebe en scripts.
- Node/`npx` (CLI Supabase) y `openssl`.
- Opcional para conteo de filas en la batería: `KAWIIL_OS_DB_URL` del proyecto destino (nunca Central).

## Cómo desplegar (reproducible)

```bash
export SUPABASE_ACCESS_TOKEN='…'   # solo en el entorno local / CI secreto

# Pipeline completo (secretos HMAC nuevos + deploy + batería):
./tools/portal/run-portal-hmac-pipeline.sh ensayo
# Solo si ensayo pasó:
./tools/portal/run-portal-hmac-pipeline.sh demo

# O por pasos:
./tools/portal/set-portal-hmac-secrets.sh tglhceuszxcgkxmskdkl
./tools/portal/deploy-portal-edge-functions.sh tglhceuszxcgkxmskdkl
CENTRAL_TO_OS_SIGNING_SECRET='…' ./tools/portal/hmac-battery-portal-system.sh tglhceuszxcgkxmskdkl
```

`deploy-portal-edge-functions.sh` despliega, en este orden lógico vía CLI:

1. `portal-api`
2. `portal-system-api`
3. `portal-system-dispatch`
4. `portal-notify`

Todas con `--no-verify-jwt` (la autenticación HMAC/JWT se valida en código).

## Secretos (solo nombres)

### Obligatorios para la frontera HMAC (cargados por `set-portal-hmac-secrets.sh`)

| Nombre | Dónde se carga | Para qué |
|---|---|---|
| `CENTRAL_TO_OS_SIGNING_SECRET` | Edge Functions → Secrets (CLI `supabase secrets set`) | Valida firmas entrantes en `portal-system-api` |
| `OS_TO_CENTRAL_SIGNING_SECRET` | Idem | Firma salidas de `portal-system-dispatch` |
| `CRON_SECRET` | Idem | Auth de `portal-system-dispatch` vía `x-cron-secret` |
| `PORTAL_MIRROR_READ_ONLY` | Idem (valor fijo `true` en ensayo/demo) | Espejo fiscal solo lectura |

Los tres HMAC/cron se generan con `openssl rand` **distintos por proyecto** (ensayo ≠ demo). Nunca se escriben al repo ni a `.env` versionados. La evidencia en `docs/portal/evidencia/` solo guarda longitud y `sha256_6` (primeros 6 hex).

### Opcionales (si están en el entorno del operador, se reenvían; si no, quedan pendientes)

| Nombre | Notas |
|---|---|
| `PORTAL_PUBLIC_URL` | URL pública del front del portal |
| `PORTAL_ALLOWED_ORIGIN` | CORS |
| `CENTRAL_SYSTEM_API_URL` | URL HTTPS de `central-portal-api` (la aporta Polo/Central; **no se inventa**) |
| `TURNSTILE_SECRET_KEY` | Captcha; en demo usar llaves de prueba Cloudflare |
| `PORTAL_CSD_KEY_SECRET` | Cifrado CSD (≥32); no usar en demo con material real |
| `PORTAL_CSD_SECRET` | Cifrado contraseña CSD (≥32) |

### No configurar en ensayo/demo OS

Credenciales de Central (`service_role` de Central), Microsoft/Slack/Dropbox/Moffin de producción, e.firma/CIEC/SatGo reales.

## Batería HMAC (casos)

Contra `POST /functions/v1/portal-system-api`:

| Caso | Esperado |
|---|---|
| Firma válida | Aceptada (HTTP 200, `ok`) |
| Firma alterada | Rechazada (`signature_invalid`) |
| Timestamp vencido (>300s) | Rechazado (`timestamp_invalid`) |
| Nonce repetido | Sin efecto nuevo (`duplicate` / sin fila inbox nueva) |
| Misma `idempotency_key` | No duplica (`duplicate: true`; conteo inbox estable si hay DB URL) |

Evidencia (sin secretos): `docs/portal/evidencia/hmac-battery-<ref>-<stamp>.txt`.

## Pendientes conocidos

- `CENTRAL_SYSTEM_API_URL` y el par HMAC en **Central** requieren coordinación Polo (no se toca Central desde estos scripts).
- Canarios `portal-api-*` residuales en ensayo/demo: limpieza operativa aparte.
- Si `SUPABASE_ACCESS_TOKEN` no está inyectado en el agente, el pipeline se detiene a propósito (no se usan otras credenciales).
