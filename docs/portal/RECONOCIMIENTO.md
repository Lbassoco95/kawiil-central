# Portal del cliente — Reconocimiento del repo

Fecha: 28 de septiembre de 2026. Escrito antes de construir; las decisiones de aquí rigen el resto.
Si algo del prompt chocó con el repo, **ganó el repo** y queda anotado en la sección «Choques».

## 1. Lo que hay (verificado)

| Tema | Hallazgo | Dónde |
|---|---|---|
| Stack | React 18 + Vite 5 + TS + Tailwind/shadcn, Supabase (`qppfampapbxdgednkofc`). Pruebas con Vitest (24 archivos, 235 pruebas, todas pasan antes del cambio). | `package.json`, `vitest.config.ts` |
| Tenencia | El tenant es la **organización** (`get_user_org_id(auth.uid())` sobre `profiles.organization_id`). Todo usuario con `profiles` ve **todos** los clientes de la organización. No existe aislamiento por cliente hoy. | `supabase/migrations/20260225202434_*.sql` |
| Alta de usuarios | El trigger `handle_new_user` crea **siempre** un `profiles` en la organización Kawiil (`a0000000-…-0001`) y el rol `en_formacion` para cualquier `auth.users` nuevo. | `20260308200900_*.sql` |
| Política peligrosa | `profiles` tiene la policy `"Users insert own profile"` con `WITH CHECK (user_id = auth.uid())`: cualquier usuario autenticado sin perfil puede insertarse uno **con la organización que quiera**. | idem |
| Clientes | `clients` (con `rfc`, `responsible_user_id`, `status` incluye `prospecto`), `client_collaborators`, `profiles.has_global_client_access`. | `20260729175000_client_team_assignment.sql` |
| Datos fiscales | `fis_tax_profiles` (Ju'un): RFC, razón social, CP, régimen, uso CFDI, `csf_verified_at`. | `20260825034512_juun_fis_schema.sql` |
| Tickets | **Ju'un ya modela tickets**: `fis_receipts` (hash anti-duplicado, `expires_at`, 13 estados), `fis_merchants` con ventanas **idénticas** a las del prompt (OXXO 7, Walmart fin de mes, Uber 60, casetas no aplica…), `fis_cfdi`, bucket privado `juun` con ruta `{org}/juun/clients/{client}/…`. | idem + `docs/juun/README.md` |
| Moffin | `moffin-facturas` consulta CFDI (detalle normalizado) pero **solo persiste conteos** (`moffin_cfdi_counts`). Requiere `projectId`. | `supabase/functions/moffin-facturas` |
| Certificados | `client_sat_certificates` ya admite `cert_type = 'csd_sello'`, cifra `.cer`/`.key` con AES-GCM (`MOFFIN_FIEL_SECRET`), RLS sin policies (solo service_role). **No guarda la contraseña de la llave**, que el sellado necesita. `cert-expiry-notifier` ya alerta vencimientos de FIEL y CSD. | `20260505120000_client_sat_certificates.sql`, `client-sat-certificates`, `cert-expiry-notifier` |
| Comunicación | `src/pages/Comunicacion.tsx` es cliente de Slack (2 413 líneas). Sin tablas de conversación con clientes. | — |
| Correo | Las plantillas de Auth pasan por `auth-email-hook` (Lovable Email, `notify.kawiil.mx`). Los correos de negocio salen por Microsoft Graph con credenciales de app (`process-email-queue`). | — |
| Dropbox | `dropbox-browse`, `index-dropbox`, `dropbox-upload` usan la integración del equipo (token amplio). No hay mapeo carpeta→cliente. | `supabase/functions/dropbox-*` |
| Modelo (IA) | **`openclaw-gateway` no está en el repo**: es un servicio systemd en la VM `kawiil-agents` (lo dice `docs/juun/README.md`). No hay cliente ni variable para él. | — |
| Catálogos SAT | `src/lib/juun/catalogs/*.json` están marcados `"provisional"`. La **matriz régimen × uso de CFDI no existe** (TODO en `satCatalogs.ts`). El script `scripts/juun/build-sat-catalogs.mjs` que cita el README de Ju'un **no existe** en el repo. | — |
| Juntas (Múuch', `mtg_`) | No está en esta rama. No se toca. | — |
| Migraciones | `supabase/migrations/YYYYMMDDHHMMSS_slug.sql` (forward-only con `db push --include-all`); los rollback van a mano en `migrations/YYYY-MM-DD_slug.rollback.sql`. Hay prueba que detecta versiones repetidas. | `migrations/README.md`, `src/test/migrationVersions.test.ts` |
| Migraciones en base vacía | Con un stub de Supabase, **10 migraciones existentes ya fallan** en base vacía (antes de este cambio): 6 por `agent_tasks`/`agent_registry`, tablas creadas fuera del repo; 4 de contratos porque `digest()` no resuelve con `search_path = public`. | ver RUNBOOK §6 |
| PWA | Central ya trae `public/site.webmanifest` y `public/sw.js` (push). | — |
| Lint | 1 294 errores y 125 avisos preexistentes. | — |

## 2. Decisiones (el «cómo»)

1. **Build separado.** `portal/index.html` + `vite.config.portal.ts` + `src/portal/**`. Salida en `dist-portal/`. Una prueba falla si el portal importa páginas, layouts o contextos del back-office. Dominio en `VITE_PORTAL_PUBLIC_URL` / `PORTAL_PUBLIC_URL`.
2. **Una cuenta de portal nunca es staff.** `handle_new_user` se extiende: si `raw_user_meta_data.kawiil_portal = true` crea `portal_accounts` (pendiente) y **no** crea `profiles` ni rol. Un trigger en `profiles` rechaza cualquier perfil para una cuenta de portal (cierra el agujero de `"Users insert own profile"` para ellas). El alta del portal pasa por la Edge `portal-signup` (service role), no por el registro público de Auth.
3. **Aislamiento en la base.** Toda tabla del portal lleva `organization_id` + `client_id`. Funciones `portal_my_client_ids()` y `portal_has_client_role()` (SECURITY DEFINER, leen membresías activas de cuentas activas). El staff se reconoce por tener `profiles` y no ser cuenta de portal.
4. **Tickets = Ju'un.** El portal escribe en `fis_receipts` (misma tabla, misma ventana de `fis_merchants`, mismo bucket `juun` y misma convención de ruta). Se agregan **policies nuevas** para portal; no se cambian las existentes. Estados visibles: mapeo de los 13 de Ju'un a 5 (recibido, en proceso, facturado, con problema, vencido).
5. **Facturas del portal en tabla propia** `portal_cfdi` (única por `client_id + uuid`), alimentada por carga manual (Edge `portal-cfdi-upload`, valida XML y RFC en servidor), por importación del detalle que ya devuelve `moffin-facturas` (sin tocar la función) y por el emisor.
6. **CSD.** Se reúsa `client_sat_certificates` (`csd_sello`) y el mismo cifrado (`moffinFielCrypto.ts`) desde una Edge nueva `portal-csd`. La contraseña de la llave va a `portal_csd_secrets` (tabla sin policies, cifrada con `PORTAL_CSD_SECRET`). Revocación y bitácora de uso en `portal_csd_registry`. Ninguna respuesta de API incluye cifrados; `authenticated` no tiene privilegios sobre esas tablas.
7. **Emisión** detrás de `EmisorCfdi { validar, emitir, consultarEstado }` con `EmisorPrueba` (no timbra) y `EmisorPacPlantilla` (lanza «no configurado»). Interruptor por cliente en `portal_client_settings.emission_enabled`; un trigger **en la base** impide prenderlo si el expediente está incompleto.
8. **Matriz régimen × uso**: catálogo tipado vacío + generador desde el `catCFDI_V_4_*.xls` oficial. El sandbox no llega a `sat.gob.mx` (403 del proxy), así que **no se cargó**; mientras esté vacío la validación **bloquea** la emisión (falla cerrada). No se inventó.
9. **Mensajería propia** (`portal_threads`, `portal_messages`, `portal_message_attachments`, `portal_message_reads`). Bandeja en `/comunicacion/clientes`, con entrada propia en el menú «Comunicación». `Comunicacion.tsx` **no se modifica**. Aviso a Slack y correo por una bandeja de salida (`portal_outbox`) que despacha `portal-notify`.
10. **Documentos**: bucket privado `portal`; `portal_dropbox_folders` (mapeo por **id de Dropbox**, tolera renombres), `portal_documents` (nace `pendiente`). El motor de sincronización es puro (`_shared/portal/dropboxSync.ts`) y se prueba contra una carpeta local.
11. **Archivos**: el portal nunca lee Storage directo; pide a `portal-files` un enlace firmado de 120 s, que valida permiso y deja bitácora de descarga.
12. **Bitácora** `portal_audit_log`: sin UPDATE/DELETE (trigger), sin FK al usuario para sobrevivir a la eliminación de cuenta.
13. **Modelo**: `_shared/portal/openclaw.ts` es el único punto de salida; si `OPENCLAW_GATEWAY_URL` no está, la sugerencia se apaga. Nada queda definitivo sin confirmación de staff.
14. **Nivel básico**: al activarlo, la cuenta crea su propio cliente (`status = prospecto`) y queda como administrador. Ve tablero de lo que él carga, factura con límite (`basic_invoice_limit`), no ve documentos, tickets apagados, mensajería solo «contratación» → bandeja «Prospectos».

## 3. Choques con el prompt (ganó el repo)

| Prompt | Repo | Qué hice |
|---|---|---|
| «Multi-tenant por cliente» | El tenant es la organización | El portal aísla por cliente en su propia capa de RLS; el staff sigue por organización. |
| «Catálogo de comercios editable» | `fis_merchants` solo lo escribe `service_role` | RPC `portal_merchant_update_window` para G3/G4, solo campos de ventana. |
| «Rama `feat/kawiil-os-portal`» | La sesión obliga a `claude/elegant-gates-ha1ika` | Se trabaja en esa rama; commits separados por módulo. |
| «Corre en la Mac» | Corrió en un agente en la nube | Sin acceso a Dropbox real, SAT ni Supabase remoto: todo se probó en Postgres 16 local con stub de Supabase. |
| Matriz régimen–uso «de la fuente oficial» | No existe en el repo y no hay red al SAT | Catálogo vacío + generador; emisión bloqueada hasta cargarla. |
