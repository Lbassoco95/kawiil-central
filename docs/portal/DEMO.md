# DEMO — entorno de demostración del espejo fiscal (Corte 4)

**Alcance:** solo lectura del espejo fiscal con datos sintéticos. **Sin RH y sin emisión.** No usa el proyecto ni las credenciales de central (`qppfampapbxdgednkofc`).

Guion de la sesión: [DEMO-GUION.md](DEMO-GUION.md). Reinicio: `kawiil-os/demo/reset.sh`.

## Checklist D1–D7 (adaptado al espejo)

| Ítem | Qué exige | Cómo se cumple en este corte |
|---|---|---|
| **D1** | Demo en proyecto/rama propio, sin credenciales reales | Proyecto Supabase **independiente** (o rama aislada) + build con `VITE_PORTAL_*` distintos de central. Turnstile de prueba. Nada de Moffin/PAC/Slack reales. |
| **D2** | Datos sintéticos del espejo | Semilla `kawiil-os/demo/seed.sql` + fixture `fixtures/mirror-dataset.json`: facturas emitidas/recibidas, IVA/retenciones, constancia/opinión, declaración, notificación SAT, alertas EFOS/cancelación. |
| **D3** | Factura simulada con marca «DEMO — sin validez fiscal» | Todas las CFDI de la semilla llevan `is_test=true`. UI muestra `DEMO — sin validez fiscal`. Banner con `VITE_PORTAL_DEMO_MODE=true`. |
| **D4** | Reinicio exacto documentado y automatizable | `PORTAL_DEMO_ALLOW_RESET=1 npm run portal:demo-reset` reaplica la semilla de IDs fijos y verifica conteos. Prueba: `npm run test:kawiil-os-demo`. |
| **D5** | Guion alineado a la primera etapa, **sin RH ni emisión** | [DEMO-GUION.md](DEMO-GUION.md): tablero → facturas → documentos → alertas. Excluye tickets, CSD, crear factura y módulos RH. |
| **D6** | Aislamiento verificable del demo | El reset aborta si la URL contiene el ref de central. El seed aborta si detecta tablas de central. `demo_mode=true` y `emission_enabled=false` en la empresa demo. |
| **D7** | Conservación / no confundir con producción | [CONSERVACION.md](CONSERVACION.md) §10: datos demo son sintéticos, se reinician a voluntad y **no** sustituyen el resguardo fiscal de clientes reales. |

## Cómo levantar el demo (Polo)

1. Crear proyecto Supabase **nuevo** (nombre sugerido `kawiil-os-demo`) según [PROYECTO-SEPARADO.md](PROYECTO-SEPARADO.md). **No** enlazar central.
2. `npx supabase link --workdir kawiil-os --project-ref <REF_DEMO>`
3. `npm run kawiil-os:db-push`
4. Desplegar solo funciones OS: `portal-api`, `portal-system-api`, `portal-system-dispatch`, `portal-notify`.
5. Secretos **sintéticos** / de prueba (Turnstile always-pass, firmas distintas a producción). `PORTAL_MIRROR_READ_ONLY=true`.
6. Sembrar:
   ```bash
   PORTAL_DEMO_ALLOW_RESET=1 DATABASE_URL='postgresql://…' npm run portal:demo-reset
   ```
7. En Auth del proyecto demo, asegurar usuario `demo.cliente@kawiil-demo.invalid` con el UUID fijo `d0000000-0000-4000-8000-000000000101` **o** recrear la membresía apuntando al `user_id` real (la semilla del stub CI inserta el usuario; en Supabase hospedado Polo crea la cuenta y, si el UUID difiere, ajusta `portal_memberships` / `portal_accounts`).
8. Build del portal:
   ```bash
   VITE_PORTAL_DEMO_MODE=true \
   VITE_PORTAL_SUPABASE_URL=https://<REF_DEMO>.supabase.co \
   VITE_PORTAL_SUPABASE_PUBLISHABLE_KEY=… \
   VITE_PORTAL_PUBLIC_URL=https://demo-portal.ejemplo.mx \
   VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
   npm run build:portal
   ```
9. Seguir [DEMO-GUION.md](DEMO-GUION.md).

## Reinicio exacto

```bash
# Opcional: bloquear el ref de central en runtime (no vive dentro de kawiil-os/).
PORTAL_DEMO_ALLOW_RESET=1 \
PORTAL_DEMO_FORBID_PROJECT_REF="$VITE_SUPABASE_PROJECT_ID" \
DATABASE_URL='…' \
npm run portal:demo-reset
```

Qué hace:

1. Exige `PORTAL_DEMO_ALLOW_RESET=1`.
2. Rechaza si `VITE_PORTAL_SUPABASE_URL` == `VITE_SUPABASE_URL`, o si la conexión contiene `PORTAL_DEMO_FORBID_PROJECT_REF` (cuando se pasa).
3. Borra la empresa `demo-espejo-fiscal` y la cuenta demo fija.
4. Reinserta el dataset canónico (`seed.sql`).
5. Corre `verify.sql` (4 CFDI `is_test`, resumen sep-2026, 3 documentos, 2 alertas, 1 notificación, sin RH ni emisión).

La semilla es **determinista** (UUIDs fijos). Dos reinicios consecutivos producen el mismo contenido fiscal. El árbol `kawiil-os/` no embebe el project ref ni JWT de central (`test:kawiil-os-db` lo vigila).

## Qué no entra en este demo

- Emisión / Facturapi / PAC / CSD / e.firma / CIEC / SatGo.
- Módulos RH (asistencia, clima, empleados).
- Carga de XML por el cliente.
- Datos o secretos de producción.
- Tickets con foto (F4) ni flujo de contratación básica.

## Archivos

| Ruta | Rol |
|---|---|
| `kawiil-os/demo/seed.sql` | Semilla canónica |
| `kawiil-os/demo/reset.sh` | Reinicio automatizable |
| `kawiil-os/demo/verify.sql` | Conteos de aceptación |
| `kawiil-os/demo/fixtures/mirror-dataset.json` | Fixture legible / productor futuro |
| `kawiil-os/demo/constants.json` | IDs y marca DEMO |
| `src/portal/lib/demo.ts` | Bandera de build y texto de marca |
