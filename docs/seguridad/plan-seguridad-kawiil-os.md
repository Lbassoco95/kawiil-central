# Plan de seguridad de Kawiil OS y conexión con MATI / Kit-to-Drive

**Fecha:** 2026-10-11 · **Estado:** propuesta para revisión. No se ha cambiado código ni configuración.

## 1. Qué encontré

### Cómo está armado hoy lo que vamos a conectar

| Pieza | Repo | Rol |
|---|---|---|
| Kit-to-Drive (front) | `kit-to-drive` | ERP de Dazon (remisiones, almacén, clientes, producción). En producción habla solo con `kit-to-drive-api`. |
| Kit-to-Drive (back) | `kit-to-drive-web` (no entregado) | Migraciones, Edge Functions, RLS. Única fuente de verdad de `supabase/`. |
| Kit-to-Drive (middle) | `kit-to-drive-api` (no entregado) y `mati-api` | Compuerta con lista blanca de tablas/funciones. |
| MATI | `mati-app` | `mati-api` (Express) + `mati-app` + `mati-admin`. |
| **Ya conectado** | | `mati-admin → mati-api /admin/kit-to-drive → Edge Function mati-admin-bridge` (usuarios, config, módulos, tickets, bitácora). Secreto estático en servidor. |
| Kawiil OS | este repo | **Hoy no tiene ninguna integración con MATI ni Kit-to-Drive.** |

Modelo de tres capas de Kit-to-Drive que adoptamos: **Back** = datos, RLS, RPC, Edge Functions · **Middle** = única compuerta, lista blanca, validación · **Front** = solo interfaz, sin llaves.

### Estado de seguridad de Kawiil OS (verificado en el repo y con los avisos de Supabase, solo lectura)

| # | Sev | Hallazgo |
|---|---|---|
| K1 | **Crítico** | `supabase/functions/backup-data` tiene `verify_jwt = false` (`supabase/config.toml`), **no valida ninguna identidad** en su código, usa `SERVICE_ROLE` y, si el cuerpo trae `include_data: true`, **devuelve los datos completos** de las tablas de respaldo, que incluyen `microsoft_tokens`, `savio_webhook_events` y comunicados internos. Cualquiera que conozca la URL podría pedirlos. **No lo probé** (no ejecuté la función). Si la configuración desplegada coincide con el repo, hay que tratarlo como exposición. |
| K2 | Alta | 47 funciones con `verify_jwt = false` (de 108). Algunas son legítimas (webhooks, callbacks OAuth, formulario público), pero otras no muestran validación propia en una búsqueda rápida (`process-document`, `dropbox-browse`, `backup-data`). Requiere revisión una por una. |
| K3 | Alta | 98 funciones `SECURITY DEFINER` ejecutables por el rol `anon` (y por `authenticated`) vía `/rest/v1/rpc/...` (aviso de Supabase). Algunas sirven de helpers de RLS y deberían ser internas. |
| K4 | Media | 177 tablas visibles en el esquema GraphQL para `anon` y para `authenticated` (revela estructura; los datos dependen de RLS). Dos tablas con RLS activo y sin políticas (`client_sat_certificates`, y otra). |
| K5 | Media | CORS `Access-Control-Allow-Origin: *` en ~100 funciones. |
| K6 | Media | Front sin cabeceras de seguridad: `vercel.json` solo trae `Cache-Control` (sin CSP, HSTS, X-Frame-Options, Referrer-Policy). |
| K7 | Media | Autenticación: protección contra contraseñas filtradas desactivada y expiración de OTP mayor a 1 hora. 23 funciones con `search_path` mutable. |

Datos sensibles que Kawiil OS ya maneja y que elevan el riesgo: certificados y claves SAT/FIEL, RFC, finanzas, RH, tokens OAuth de Microsoft/Google/Slack/Dropbox.

## 2. Principios

1. **El navegador nunca habla con MATI ni con Kit-to-Drive.** Solo con Kawiil.
2. **Cero confianza en el front:** cada permiso se decide en servidor; el front solo oculta botones.
3. **Mínimo dato:** el servidor devuelve solo los campos que la pantalla necesita, ya enmascarados.
4. **Todo acceso a datos de otros sistemas deja huella** (quién, qué, cuándo, resultado).
5. **Secretos solo en variables de Edge Functions**, rotables, nunca en el repo ni en el front.

## 3. Arquitectura de conexión propuesta

```
Navegador (Kawiil OS, sesión Supabase)
   │  JWT de usuario
   ▼
Edge Function `integraciones-gateway`        ← MIDDLE de Kawiil
   1. verify_jwt = true + rol permitido (RPC con search_path fijo)
   2. rate limit por usuario
   3. valida entrada (zod) y acción de una lista cerrada (no proxy abierto)
   4. firma la petición (HMAC-SHA256 + timestamp + nonce)
   5. llama a MATI (`mati-api`) / puente de Kit-to-Drive
   6. filtra y enmascara la respuesta (lista de campos permitida)
   7. escribe bitácora `integration_audit`
   ▼
mati-api  →  mati-admin-bridge  →  Kit-to-Drive (BD propia, RLS)
```

Por qué una Edge Function y no un servidor nuevo: es lo que recomienda la propia guía de Kit-to-Drive (`docs/arquitectura-capas.md`: «empezar por Edge Functions»), y evita otro despliegue.

**Credencial entre sistemas:** una credencial de servicio **dedicada a Kawiil**, distinta de la del panel MATI Admin, con alcance mínimo (solo lectura al inicio) y rotación. Nunca se reutiliza el token de superadmin de MATI.

**Dependencia con el proyecto MATI:** para firmar con HMAC y usar una credencial propia, MATI necesita aceptar ese esquema (hallazgo M7 de `informe-seguridad-mati.md`). Hasta entonces la conexión usaría bearer estático con las mitigaciones de abajo.

## 4. Controles por capa

### Back (Supabase de Kawiil)
- Cerrar K1: autenticar `backup-data` (solo admin o secreto de cron comparado en tiempo constante), quitar `include_data` de la respuesta HTTP y escribir solo a Storage privado.
- Revisar las 47 funciones sin JWT; las que no son webhooks pasan a `verify_jwt = true` con rol.
- `REVOKE EXECUTE ... FROM anon` en funciones `SECURITY DEFINER` que no deban ser públicas; `SET search_path` fijo.
- `REVOKE SELECT ... FROM anon` en tablas que no sirven datos públicos; políticas en las dos tablas sin ellas.
- Tabla `integration_audit` (append-only, RLS: solo admin lee; nadie edita) y `integration_secrets` solo para service role.
- Activar protección de contraseñas filtradas y bajar el OTP a ≤ 1 h.
- Respaldos: cifrados y con acceso restringido.

### Middle (Edge Functions)
- Módulo compartido `_shared/security.ts`: `requireUser`, `requireRole`, CORS con lista de orígenes (no `*`), `rateLimit`, `audit`, `maskFields`, `hmacSign`.
- `integraciones-gateway` según §3. Respuestas con `Cache-Control: no-store`; errores genéricos hacia el cliente, detalle solo en logs.
- Cifrado de tokens de terceros en reposo (hoy no verifiqué cómo se guardan `microsoft_tokens` y similares; es parte de la revisión).
- Reglas ESLint para impedir secretos y llamadas directas a MATI desde `src/`.

### Front (Kawiil OS)
- Cabeceras en `vercel.json`: CSP (sin `unsafe-eval` si es posible), HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- Los datos de MATI/Kit-to-Drive solo en memoria (React Query, sin `persist`, sin `localStorage`), con `gcTime` corto.
- Campos sensibles enmascarados por defecto (RFC, correos, teléfonos); "ver completo" pide al servidor y queda en bitácora.
- Cierre de sesión por inactividad; ocultar contenido al cambiar de pestaña en pantallas sensibles (opcional).
- Nada de contraseñas temporales visibles: solo por correo, como en Kit-to-Drive.

## 5. Fases

| Fase | Contenido | Resultado |
|---|---|---|
| **0 — Contención (días)** | K1, K2 (revisión de las 47), revisar logs de `backup-data`, rotar tokens de Microsoft si hay indicio de acceso | Sin exposición abierta |
| **1 — Base (1–2 sem)** | `_shared/security.ts`, cabeceras front, K3/K4 (revoke anon), auth (K7), CORS | Línea base segura |
| **2 — Conexión de solo lectura** | `integraciones-gateway`, `integration_audit`, pantalla de estado MATI/Kit-to-Drive en Kawiil OS | Datos visibles de forma segura |
| **3 — Escritura controlada** | Acciones (alta de usuario, módulos) con confirmación y doble registro; HMAC end-to-end cuando MATI lo soporte | Operación desde Kawiil OS |
| **4 — Sostenimiento** | Pruebas automáticas de seguridad (roles, enmascarado, funciones sin JWT), revisión trimestral de avisos de Supabase | Que no se regrese |

## 5.1 Estado de la Fase 0 (2026-10-11)

Desplegado en producción (proyecto `qppfampapbxdgednkofc`) y reflejado en la rama:

| Función | Antes | Ahora | Versión |
|---|---|---|---|
| `backup-data` | Sin JWT ni validación; con `include_data` devolvía todos los datos | `verify_jwt = true`, exige admin/gerente, ya no devuelve datos por HTTP | v63 |
| `microsoft-secret-health` | Abierta; renovaba tokens reales de `microsoft_tokens` | Solo admin/gerente o `x-cron-secret` (ahora también está en el repo) | v8 |
| `slack-notify` | Cualquiera podía publicar en el Slack de Kawiil | Exige service role o sesión válida | v67 |
| `mtg-graph-admin` | Abierta; `mock: true` insertaba filas con service role | Exige `x-cron-secret` | v4 |
| `refresh-weekday-phrases` | Aceptaba cualquier bearer de más de 16 caracteres | Solo service role exacto o cron secret | v64 |
| `travel-refresh` | Si faltaba `CRON_SECRET`, quedaba abierta | Falla cerrada | v8 |

**Pendiente de desplegar:** `process-document` (parchada en la rama, 639 líneas; se despliega con el flujo normal para no retranscribirla a mano). Hasta entonces sigue aceptando llamadas sin identidad.

**Pendiente de revisar:** `satgo-facturas` (existe en producción pero no en el repo), `moffin-webhook`, `meta-webhook-leads`, `calendly-webhook` y `email-tracking` (webhooks/públicas: confirmar firma), y el resto de las funciones sin JWT.

**Acciones fuera del código:** revisar logs de más de 24 h de `backup-data` en el panel de Supabase (la herramienta solo cubre 24 h; en ese lapso no hubo llamadas) y decidir si se rotan los tokens de Microsoft.

## 5.2 Estado de la Fase 1 (2026-10-11)

| Pieza | Estado |
|---|---|
| Cabeceras de seguridad del front (`vercel.json`): HSTS, `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy` | En la rama. Se aplican al fusionar y desplegar. |
| CSP | En modo **solo reporte** (`Content-Security-Policy-Report-Only`): no bloquea nada. Revisar la consola del navegador unos días y luego pasarlo a `Content-Security-Policy`. |
| Migración `20261011230000_fase1_endurecer_anon_y_rpc.sql` | ✅ **Aplicada en producción (2026-10-11)** desde el SQL Editor de Supabase y **verificada** con lecturas (ver abajo). Los intentos desde la sesión (`execute_sql`/`apply_migration`) caducaron a los 60 s y no aplicaron nada. |
| Contraseñas filtradas y OTP | Solo se cambian en el panel de Supabase (Authentication → Providers/Policies). |

**Qué hizo la migración:** quitó 3 políticas abiertas a cualquiera (`knowledge_insights` insert/update y `knowledge_feed` insert), dejó las funciones internas (cron, colas, `get_edge_fn_source`, `*_system`) solo para `service_role`, quitó a `anon` la ejecución de las demás funciones `SECURITY DEFINER` salvo las 5 necesarias, y retiró a `anon` los permisos de escritura sobre las tablas (también por defecto para objetos nuevos). **No tocó:** `contract_client_get/patch` (portal público por token), `get_user_org_id`, `is_admin_or_manager` y `can_edit_org_permission_settings` (las usan políticas que aplican a anon).

**Verificación posterior (solo lecturas, 2026-10-11):**

| Comprobación | Antes | Después |
|---|---|---|
| Políticas abiertas (`Service insert/update …`) | 3 | 0 |
| Funciones `SECURITY DEFINER` ejecutables por `anon` | 98 | 5 (`can_edit_org_permission_settings`, `contract_client_get`, `contract_client_patch`, `get_user_org_id`, `is_admin_or_manager`) |
| Permisos de escritura de `anon` sobre tablas | 706 | 0 |
| Funciones solo para `service_role` | 0 | 27 |
| Funciones solo para `authenticated` + `service_role` | 0 | 67 |
| Aviso Supabase «anon puede ejecutar SECURITY DEFINER» | 98 | 5 |

Comprobadas una a una: `claim_jobs`, `complete_job`, `fail_job`, `get_edge_fn_source`, `invoke_travel_refresh_cron`, `enqueue_sequence_system` y `pipeline_calendly_apply_system` ya no son ejecutables por `anon` ni `authenticated` (sí por `service_role`); `assign_lead`, `move_lead_stage`, `rh_start_jornada` y `has_role` siguen ejecutables por `authenticated`.

**Nota sobre el PR #369:** como la migración se aplicó a mano, no quedó registrada en `supabase_migrations.schema_migrations`. Al fusionar, `supabase db push` volverá a ejecutar el archivo; es idempotente, así que no cambia nada.

**Sin verificar:** que ningún flujo de la aplicación se haya visto afectado. Probar login, portal público de contratos, pipeline de leads, RH (iniciar jornada) y knowledge. Rollback puntual: devolver `EXECUTE` a `anon` solo en la función afectada.

**Pendiente en base de datos (avisos de Supabase tras la migración):** 177 tablas visibles por GraphQL para `anon` y `authenticated`, 72 funciones abiertas a `authenticated`, 23 con `search_path` mutable, 2 tablas con RLS sin políticas, y el aviso de `pg_trgm` en el esquema público.

**Decisión pendiente:** las tablas `agent_registry`, `agent_tasks` y `agent_activity_logs` son legibles por cualquiera con la clave pública (`anon_read_*`, `true`). Probablemente las lee un agente externo con la clave anon; hay que confirmarlo antes de cerrarlas.

## 5.3 Reparación del historial de migraciones (2026-10-12)

**Problema:** `Deploy Supabase` fallaba en «Push migrations» con `Remote migration versions not found in local migrations directory` (ejecuciones #136, #138, #139 y #140). Producción tenía 16 migraciones registradas que no existían en `supabase/migrations/`, porque se aplicaron a mano con otra numeración.

**Reparación (sin escribir en la base de producción):** se recrearon esas 16 migraciones en el repo con el SQL exacto que quedó guardado en `supabase_migrations.schema_migrations`, cada una con su misma versión y nombre. Cada archivo se verificó contra el `md5` que calcula la base (coinciden las 16).

| Versión | Nombre |
|---|---|
| 20260925014308 · 014354 · 020641 · 022629 | `contract_engagements_mvp`, `contract_templates_seed`, `contract_won_stage_softlanding_rfc`, `contract_rpc_schema_reload` |
| 20260930025108 · 150806 · 210647 · 224934 | `mtg_unassigned_meetings`, `satgo_monthly_cron`, `moffin_consults_buzon_types`, `mtg_bucket_file_size_limit_500mb` |
| 20261001160110 | `mtg_recording_saved_meta` |
| 20261004164053 · 164139 · 192226 | `satgo_cfdi_auto_download`, `satgo_cfdi_cron`, `kawiil_vault_secret_os_mirror` |
| 20261005164935 · 20261006024112 · 20261006215158 | `rh_start_jornada_rpc`, `satgo_cfdi_enrich_structured`, `facturapi_org_mapping` |
| 20261011225226 | `esign_simple` |

Con esto no queda ninguna versión del remoto sin archivo local (272 de 272).

**Qué pasará al fusionar:** `supabase db push --include-all` aplicará los 17 archivos locales que el remoto no tiene registrados. Se revisó que no cambie nada:
- 10 son gemelos de las migraciones recuperadas (mismo SQL; solo difieren comentarios y espacios). Producción ya tiene ese SQL aplicado a mano.
- 6 no tienen gemelo (`lead_client_referrals`, `contract_pgcrypto_search_path`, `rh_jornada_repairs`, `add_nomina_service`, `contract_client_fields_and_service_sync`, `client_sat_certificates_satgo_jwe`): sus objetos ya existen en producción (columnas, constraint, política, valor de enum y `search_path`).
- La 17.ª es `20261011230000_fase1_endurecer_anon_y_rpc.sql`, ya aplicada e idempotente.
- Ninguna re-ejecución devuelve permisos a `anon`; las únicas concesiones a `anon` son `contract_client_get/patch`, que son públicas a propósito.

El efecto neto es registrar esas versiones en el historial. **Deuda que queda:** los gemelos duplican el SQL bajo dos versiones (p. ej. `20260924120000` y `20260925014308`). En una base nueva se ejecutarían las dos veces; es inocuo porque son idempotentes, pero conviene eliminar los duplicados locales más adelante.

**Corrección tras el primer despliegue (2026-10-12):** `db push` aplicó 12 de los archivos sin registrar y se detuvo en `20260930200000_moffin_consults_buzon_types`: el gemelo recreaba un `CHECK` viejo de `moffin_consults`, que una migración posterior ya había ampliado (`satgo_cfdi_download`, 175 filas), así que fallaba. Re-ejecutar un gemelo no es siempre inocuo cuando una migración posterior cambió el mismo objeto. Se eliminaron los 4 gemelos que aún no se habían aplicado (`20260930200000`, `20260930230000`, `20261001160000`, `20261005170000`), idénticos a su versión ya registrada. Los 12 gemelos ya aplicados quedan en el repo porque ahora forman parte del historial del remoto.

**Segunda corrección (2026-10-12):** el siguiente despliegue falló en `20261011120000_esign_simple` (gemelo de `20261011225226`, ya registrado): su `CREATE POLICY` no es idempotente y la política ya existía. Se eliminó ese gemelo. `20261012010000_esign_fix_rls_recursion` se conserva: usa `CREATE OR REPLACE` y `ALTER POLICY`, y las políticas de producción ya coinciden con él. Criterio para los gemelos pendientes: quitarlos si su SQL no es idempotente o si una migración posterior cambió el mismo objeto.

**Causa de fondo:** se aplican migraciones directamente en producción (panel o conector) sin versionarlas. Regla propuesta: toda migración se escribe primero en `supabase/migrations/` y la aplica el CI.

## 5.4 Cierre de pendientes de las fases 0 y 1 (2026-10-12)

**Verificado con los registros de Supabase (ventana máxima de 24 h):**

| Pendiente | Resultado |
|---|---|
| ¿Se rompió algo al cerrar `anon`? | No hay señales: 7 812 peticiones, **0 respuestas 401/403**. Los 75 errores 500 eran `esign_requests/esign_signers` (recursión de RLS) y dejaron de aparecer a las 01:12 UTC tras el arreglo de la sesión de firmas. Esto no sustituye probar las pantallas a mano. |
| ¿`CRON_SECRET` está configurado? | Sí: `travel-refresh` respondió 200 en 96 de 96 llamadas con el control fail-closed activo. |
| Logs de `backup-data` | 0 llamadas en las últimas 24 h. La API no permite mirar más atrás, así que **no se puede descartar acceso anterior**; si se quiere certeza hay que revisar el historial en el panel de Supabase o rotar los tokens de Microsoft por precaución. |
| Lectura pública de `agent_registry`, `agent_tasks`, `agent_activity_logs` | La usa la VM de agentes (`python-httpx`, cada 30 min, con la clave `anon`). **No se cierra** hasta que la VM lea con `service_role`. El front ya las lee con sesión de usuario. |
| Avisos restantes de Supabase (9 tipos) | `anon`/`authenticated` con funciones SECURITY DEFINER ejecutables (las 5 de `anon` son intencionales), tablas visibles en GraphQL, `search_path` mutable, `pg_trgm` en `public`, una tabla con RLS sin políticas, OTP largo y contraseñas filtradas sin proteger. |

**Hallazgos nuevos:**

| # | Sev | Hallazgo | Estado |
|---|---|---|---|
| N1 | Alta | **La clave `service_role` se usa fuera de Supabase**, desde una red residencial/oficina en México (Cablevisión): 158 llamadas en 24 h de `Python-urllib` (lectura de `tasks`, `projects`, `clients`, `profiles` y sondeos de tablas que no existen: `pagos`, `facturas`, `cobranza`…) más 13 de la VM de agentes. Esa clave omite RLS. Puede ser herramienta propia, pero no lo puedo confirmar. | Pendiente: confirmar quién es; si no se reconoce, **rotar la clave**. |
| N2 | Media | El `state` de OAuth de Slack (`slack-user-callback`) y el de Microsoft (`_shared/microsoftOAuthState.ts`) **no están firmados**: es el `userId`. Un atacante que conozca el UUID de otro usuario puede vincular su propia cuenta de Slack/Microsoft a esa persona. | Pendiente: firmar el `state` con HMAC y caducidad (cambia función y front). |
| N3 | Media | `satgo-facturas`: cualquier usuario con sesión (sin rol) puede disparar la descarga SAT de **todos** los clientes de **todas** las organizaciones. Además, la función desplegada es un arranque que importa el código de `raw.githubusercontent.com` en un commit fijo (`266629df`) y esa carpeta ya no existe en `main`: el CI no la redespliega. | Pendiente: restaurar la función al repo, exigir admin/gerente y filtrar por organización. |
| N4 | Media | `mtg-graph-webhook` aceptaba notificaciones sin `clientState` o sin el secreto configurado (insertaba en `job_queue` y `mtg_unmatched_transcripts`). Sin llamadas en 24 h y sin suscripción real todavía. | **Corregido en este PR**: falla cerrado y exige `clientState` exacto. Requiere crear el secreto `MTG_GRAPH_CLIENT_STATE` antes de activar la suscripción. |
| N5 | Baja | `esign`: la IP de la firma sale de `x-forwarded-for` (suplantable; mejor `cf-connecting-ip`); los 500 devuelven `e.message`; `fetchRemotePdf` sigue redirecciones; no hay límite de intentos; `decline` no condiciona el estado. El resto está bien: token de 244 bits, validación de organización, firma atómica, orden secuencial, solo PDF/PNG con tope de tamaño. | Pendiente: avisar a la sesión de firmas. |

**Acciones solo del panel de Supabase (no se pueden hacer desde aquí):** Auth → activar protección de contraseñas filtradas; Auth → bajar la expiración de OTP a ≤ 3600 s. La CSP sigue en solo reporte porque no hay colector de reportes que diga qué rompería.

## 5.5 Estado de la Fase 2: conexión de solo lectura (2026-10-12)

**Construido (en este PR, sin secretos configurados → inactivo hasta que se activen):**

| Pieza | Qué hace |
|---|---|
| `supabase/migrations/20261012130000_integration_audit.sql` | Tabla `integration_audit` **append-only** (trigger que bloquea UPDATE/DELETE incluso a `service_role`). RLS: solo un `transformador` de la misma organización lee. `anon`/`authenticated` sin permisos de escritura. |
| `supabase/functions/_shared/security.ts` | CORS con lista de orígenes (no `*`), `authenticate`, límite de ritmo, bitácora, HMAC-SHA256, enmascarado y lista blanca de campos (`pickFields`). |
| `supabase/functions/integraciones-gateway` | `verify_jwt = true` + rol `transformador`; 30 solicitudes/60 s por usuario (falla cerrado si no puede contar); **lista cerrada** de acciones (`status`, `users`, `modules`, `tickets`) con parámetros validados; credencial de servicio propia; firma HMAC opcional; solo devuelve campos permitidos y con el correo enmascarado; errores del puente no se reenvían; cada intento a la bitácora sin cuerpos ni secretos. |
| `MatiConnectionCard` en Configuración → Integraciones | Estado de la conexión y tablas de usuarios, módulos y tickets. Datos solo en memoria (React Query sin persistencia, 60 s). Si faltan secretos, dice cuáles. |

**Probado:** tipos (Deno y `tsc`), 11 pruebas de las utilidades (incluye el vector RFC 4231 de HMAC), 31 del flujo completo del gateway con Supabase y puente simulados (sin sesión, sin rol, sin configurar, acciones fuera de lista incluido `__proto__`, parámetros inválidos, campos sensibles que no salen, firma, 502/504, CORS, límite de ritmo), 3 de la tarjeta y, del SQL, 13 comprobaciones en un Postgres real (PGlite) tras ejecutarlo dos veces: idempotencia, RLS por organización, grants y append-only. **No probado contra producción ni contra un MATI real**: el entorno no puede ejecutar DDL ni llamar a Supabase por HTTP; lo aplicará el CI.

**Para activarlo hacen falta tres secretos en Supabase → Edge Functions:** `MATI_GATEWAY_URL` (URL del puente `mati-admin-bridge`), `MATI_GATEWAY_TOKEN` (≥ 32 caracteres) y, opcional, `MATI_GATEWAY_HMAC_KEY`.

**Limitaciones que dependen de MATI / Kit-to-Drive (no del código de Kawiil):**
1. `mati-api` solo acepta sesión de admin de MATI; no existe credencial de máquina. Por eso el gateway apunta al **puente** (`mati-admin-bridge`), cuyas rutas son `/app/status`, `/users`, `/modules` y `/tickets`.
2. Ese puente hoy acepta **un solo secreto compartido** (el mismo que usa `mati-api`). Una credencial *dedicada a Kawiil* requiere que `kit-to-drive-web` (no disponible para mí) acepte un segundo secreto. **Mientras tanto, configurar `MATI_GATEWAY_TOKEN` con el secreto actual reutiliza la credencial de MATI**, lo que el plan quería evitar: es una decisión que debe tomarse a conciencia.
3. La firma HMAC solo protege cuando el puente la verifique (hallazgo M7 del informe de MATI); hasta entonces es inofensiva pero no añade seguridad.
4. Las listas de campos permitidos se basan en los esquemas que se ven en `mati-api` (`routes/admin-kit-to-drive.ts`); los nombres reales que devuelve el puente podrían diferir (una columna ausente simplemente no se muestra). Se ajustan en `ACTIONS` del gateway.

**Siguiente (Fase 3, escritura controlada):** acciones con confirmación y doble registro; solo tras tener credencial dedicada y HMAC verificado en el puente.

## 6. Decisiones que necesito de ti

1. **¿Qué roles de Kawiil pueden ver datos de Kit-to-Drive/MATI?** (propongo solo dirección y administración al inicio).
2. **¿Qué datos mostramos primero?** (propongo estado, usuarios activos, módulos y tickets: lo que el puente ya expone).
3. **¿Permito empezar por la Fase 0?** Toca configuración en producción (`config.toml` y despliegue de funciones), así que no la ejecuto sin tu confirmación.
4. **¿Acceso a `kit-to-drive-web` y `kit-to-drive-api`?** Sin ellos no puedo revisar la Edge Function del puente ni la lista blanca.
