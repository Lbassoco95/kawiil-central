# RUNBOOK — portal del cliente

## 1. Migraciones (orden)

| # | Archivo (`supabase/migrations/`) | Qué hace | Rollback (`migrations/`, a mano, **en orden inverso**) |
|---|---|---|---|
| 1 | `20260928140000_portal_core.sql` | Cuentas, membresías, ajustes, textos legales (marcadores), bitácora inmutable, aislamiento, rama del portal en `handle_new_user` | `2026-09-28_portal_core.rollback.sql` (10.º) |
| 2 | `…140100_portal_messaging.sql` | Hilos, mensajes, adjuntos, bandeja de salida | `…portal_messaging.rollback.sql` (9.º) |
| 3 | `…140200_portal_documents.sql` | Bucket `portal`, Dropbox, documentos, publicación | `…portal_documents.rollback.sql` (8.º) |
| 4 | `…140300_portal_cfdi.sql` | Facturas, tablero, expediente, CSD, emisión, cancelaciones | `…portal_cfdi.rollback.sql` (7.º) |
| 5 | `…140400_portal_tickets.sql` | Tickets sobre Ju'un | `…portal_tickets.rollback.sql` (6.º) |
| 6 | `…140500_portal_isolation_guard.sql` | Cerco restrictivo + `pgrst.db_pre_request` | `…portal_isolation_guard.rollback.sql` (5.º) |
| 7 | `…150000_portal_csd_authorization.sql` | C2/C5: autorización previa del CSD, guardado atómico, versión de secreto | `…portal_csd_authorization.rollback.sql` (4.º) |
| 8 | `…150100_portal_rate_limits.sql` | C3: límites por IP/correo (huellas) | `…portal_rate_limits.rollback.sql` (3.º) |
| 9 | `…150200_portal_account_deletion.sql` | C4: política de conservación, eliminación, seudonimización, purga diaria (pg_cron `portal-retention-purge`) | `…portal_account_deletion.rollback.sql` (2.º) |
| 10 | `…150300_portal_route_guard_health.sql` | V1: diagnóstico del cerco y bloqueo de vinculación si no está activo | `…portal_route_guard_health.rollback.sql` (1.º) |

- El pipeline (`deploy-supabase.yml`) aplica las migraciones al integrar a `main` (forward-only). Los rollback se corren a mano en el SQL editor.
- Ninguna migración borra ni altera datos existentes (probado: huella de datos previos idéntica antes, después y tras el rollback). Los rollback 7–10 del portal son destructivos **solo** para datos del portal.
- Si la migración 6 avisa `No se pudo registrar pgrst.db_pre_request` o `ya tiene pgrst.db_pre_request`:
  ```sql
  ALTER ROLE authenticator SET pgrst.db_pre_request TO 'public.portal_pre_request';
  NOTIFY pgrst, 'reload config';
  ```
  Mientras no esté activo, el registro público y la vinculación de cuentas quedan **bloqueados** (V1). No es un error: es la falla cerrada.
- Tabla nueva del back-office creada después: `SELECT public.portal_apply_isolation_guard();` (el diagnóstico la cuenta en `tablas_sin_cerco` y bloquea hasta corregirlo).

## 2. Variables (Edge Functions → Secrets; `.env` no se toca)

| Variable | Obligatoria | Nota |
|---|---|---|
| `PORTAL_PUBLIC_URL`, `CENTRAL_PUBLIC_URL`, `PORTAL_ALLOWED_ORIGIN` | sí | Dominios. |
| `TURNSTILE_SECRET_KEY` | **sí** | Sin ella registro, recuperación y reenvío se **cierran**. |
| `VITE_TURNSTILE_SITE_KEY` (build del portal) | **sí** | Sin ella esas pantallas se muestran cerradas. |
| `PORTAL_CSD_KEY_SECRET` | para CSD | ≥32. Cifra `.cer`/`.key`. **Distinto** de `MOFFIN_FIEL_SECRET` y de `PORTAL_CSD_SECRET` (la Edge lo exige y cierra si se repiten). |
| `PORTAL_CSD_SECRET` | para CSD | ≥32. Cifra la contraseña de la llave. |
| `PORTAL_RL_IP_PER_WINDOW` (10), `PORTAL_RL_EMAIL_PER_WINDOW` (3), `PORTAL_RL_WINDOW_SECONDS` (3600), `PORTAL_RL_SALT` | no | Límites de las operaciones públicas. |
| `PORTAL_EMISOR`, `PORTAL_SLACK_CHANNEL_ID`, `PORTAL_EMAIL_SENDER`, `PORTAL_DROPBOX_*`, `OPENCLAW_*` | según función | Igual que antes (ver `.env.example`). |

**Llaves de prueba de Cloudflare Turnstile** (para previews, staging y pruebas; nunca en producción):

| Uso | Llave de sitio (`VITE_TURNSTILE_SITE_KEY`) | Llave secreta (`TURNSTILE_SECRET_KEY`) |
|---|---|---|
| Siempre pasa | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| Siempre bloquea | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` |
| Fuerza reto interactivo | `3x00000000000000000000FF` | — |
| Token «ya usado» | — | `3x0000000000000000000000000000000AA` |

## 3. Orden de despliegue

1. **Ensayo en una rama de Supabase** (§4). No se salta.
2. Secretos en producción (§2), con `PORTAL_CSD_KEY_SECRET` y `PORTAL_CSD_SECRET` nuevos y distintos.
3. Integrar a `main` → el workflow aplica migraciones y despliega `portal-api`, `portal-notify` y `portal-dropbox-sync`.
4. **Verificación posterior obligatoria** (§5). Si falla, el portal queda cerrado solo (registro y vinculación bloqueados) y se corrige antes de seguir.
5. Auth → URL Configuration → Redirect URLs: `PORTAL_PUBLIC_URL/ingresar` y `/restablecer`. **No** habilitar el registro público de Auth (hallazgo preexistente: `handle_new_user` da rol de staff a cualquier alta sin la marca del portal).
6. Cron de `portal-notify` y `portal-dropbox-sync` (§6). La purga de conservación ya queda programada por la migración 9.
7. Build y publicación del portal (`npm run build:portal` con `VITE_TURNSTILE_SITE_KEY` y `VITE_PORTAL_PUBLIC_URL`).

## 4. Ensayo en una rama de Supabase (pasos para Polo)

Requisitos: Supabase CLI instalado y sesión iniciada (`supabase login`); el proyecto con *Branching* habilitado (Dashboard → Project Settings → Branching; requiere plan con ramas) o, si no está disponible, un proyecto de staging aparte.

1. En el Dashboard: **Branches → Create branch** con el nombre `portal-ensayo` (o `supabase branches create portal-ensayo --project-ref qppfampapbxdgednkofc`). La rama nace **vacía de datos** y aplica todas las migraciones del repo: sirve como prueba de base vacía real.
2. Tomar de la rama su URL, `anon key`, `service_role key` y contraseña de base (Branches → `portal-ensayo` → Settings / API).
3. En la rama, **Edge Functions → Secrets**: cargar las variables de §2 con las **llaves de prueba** de Turnstile y secretos de CSD de prueba (≥32, distintos).
4. Desplegar las funciones a la rama:
   `supabase functions deploy portal-api portal-notify portal-dropbox-sync --project-ref <ref-de-la-rama>`
5. En el SQL editor de la rama, crear una cuenta **sintética** del portal y vincularla a un cliente sintético (o usar «Invitar» desde central apuntando a la rama).
6. Correr la verificación del cerco (§5) contra la rama. Debe terminar en «Cerco de rutas verificado».
7. Probar a mano: registro con Turnstile (llave que pasa y llave que bloquea), recuperación, carga de CSD rechazada sin aviso aceptado, eliminación de una cuenta básica sintética (revisar el desglose en pantalla).
8. Si todo pasa, borrar la rama (**Branches → portal-ensayo → Delete**). Nada de esto toca producción.

## 5. Verificación posterior al despliegue (obligatoria, cada vez)

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<llave pública> \
PORTAL_TEST_EMAIL=<cuenta sintética del portal> PORTAL_TEST_PASSWORD=<…> \
npm run portal:verificar-cerco
```
Consulta como cuenta del portal `/rest/v1/profiles`, `/clients`, `/tasks`, `/lead_tasks`, `/leads`, `/slack_user_profiles`, `/client_sat_certificates`, `/documents`, `/fis_tax_profiles`, `/portal_csd_secrets`, dos RPC del back-office, el bucket `documents` y el diagnóstico. Todo debe responder 403 (o vacío en storage) y el diagnóstico `ok: true`. Código de salida ≠ 0 = **no abrir el portal**.
Diagnóstico sin sesión: `POST /functions/v1/portal-api/v1/diagnostico.cerco`.

## 6. Cron (apagado hasta configurar)
```sql
SELECT cron.schedule('portal-notify', '*/2 * * * *', $$SELECT public.invoke_portal_edge_cron('portal-notify')$$);
SELECT cron.schedule('portal-dropbox-sync', '17 */6 * * *', $$SELECT public.invoke_portal_edge_cron('portal-dropbox-sync')$$);
```
`portal-notify` también vacía la cola de borrado de archivos de la eliminación de cuentas y de la purga. La purga en sí (`portal-retention-purge`, diaria 09:17 UTC) ya la programa la migración 9.

## 7. Rotación de secretos del CSD

Secretos: `PORTAL_CSD_KEY_SECRET` (`.cer`/`.key`), `PORTAL_CSD_SECRET` (contraseña). `MOFFIN_FIEL_SECRET` es de la e.firma y **no** se usa para el CSD del portal.

1. Generar secretos nuevos (≥32, distintos entre sí y de `MOFFIN_FIEL_SECRET`).
2. Simular (no escribe nada, no imprime material):
   ```bash
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
   OLD_KEY_SECRET=… NEW_KEY_SECRET=… OLD_PASSWORD_SECRET=… NEW_PASSWORD_SECRET=… \
   node tools/portal/rotate-csd-secrets.mjs
   ```
3. Aplicar con `--aplicar`. Re-cifra fila por fila y sube `key_secret_version` / `password_secret_version`. Si una fila no abre con el secreto viejo, se detiene sin tocar nada.
4. Cambiar inmediatamente los secretos en Supabase y volver a desplegar `portal-api`.
5. Ante sospecha de filtración: revocar los CSD afectados desde central (Emisión → Revocar), rotar, y pedir al cliente que tramite un CSD nuevo en el SAT si la llave pudo quedar expuesta.

## 8. Pruebas

```bash
npm run test                                                  # Vitest (incluye src/test/portal)
PGHOST=… PGPORT=… PGUSER=postgres npm run test:portal-db      # base vacía, con datos, rollback, idempotencia (165 verificaciones)
PGHOST=… PGPORT=… PGUSER=postgres npm run test:portal-api     # PostgREST en Docker: aislamiento, regresión del equipo, cerco (y su negativo)
DENO=… npm run test:portal-edge                               # funciones con verify_jwt=false sin credencial
```
En GitHub: `.github/workflows/portal-tests.yml` corre las cuatro en cada PR.

Pendiente de confirmar con material real en el ensayo: la distinción CSD / e.firma se basa en el uso de llave del certificado (`csdValidate.ts`); validarla con un CSD y una e.firma reales **en la rama de ensayo**, nunca en el repo.

## 9. Dropbox
1. App de Dropbox propia del portal con acceso **limitado** a `Kawiil Mx/CLIENTES`; permisos `files.metadata.read` y `files.content.read`, sin escritura.
2. Refresh token (OAuth offline) → `PORTAL_DROPBOX_APP_KEY/SECRET/REFRESH_TOKEN`.
3. Central → Portal de clientes → Dropbox: «Buscar carpetas» y vincular cada carpeta con su cliente **a mano** (137 carpetas con duplicados: «Ignorar (duplicado)»).
4. «Sincronizar ahora». Todo entra **pendiente**; se publica en «Publicación».

## 10. Encendido gradual
1. Ensayo (§4) → producción (§3) → verificación (§5).
2. Sustituir los textos marcadores (Catálogos → Textos legales) y los de la pantalla de eliminación.
3. Polo confirma la política de conservación (`docs/portal/CONSERVACION.md`; `portal_retention_policy.confirmed`).
4. Clientes piloto; emisión en modo prueba hasta que exista PAC.
