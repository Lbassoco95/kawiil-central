# Informe de seguridad — MATI (mati-api, mati-admin, puente Kit-to-Drive)

**Fecha:** 2026-10-11 · **Alcance:** repo `Lbassoco95/mati-app` (commit `9e62020`), lectura de código. **No se modificó nada.**
**Para:** el equipo/proyecto responsable de MATI. Documento autocontenido.

## Cómo leerlo

- **Verificado** = lo leí en el código y cito archivo.
- **Por confirmar** = depende de configuración desplegada (Vercel, Supabase) que no vi.
- No revisé: la Edge Function `mati-admin-bridge` (vive en `kit-to-drive-web`), `mati-app` (frontend cliente), ni las 43 migraciones una por una. Es una revisión dirigida, no una auditoría completa.

## Lo que ya está bien (conservar)

- Contraseñas con bcrypt; cifrado en reposo AES-256-GCM con salt por registro (`utils/crypto.ts`).
- `helmet`, CORS con lista blanca, rate limit en login/registro/recuperación (`app.ts`).
- Validación con `zod` estricta (`.strict()`) en las rutas del puente; ninguna contraseña llega al navegador y respuestas con `Cache-Control: no-store` (`routes/admin-kit-to-drive.ts`).
- El puente usa rutas fijas, no es proxy abierto; secreto solo en servidor; diagnóstico de configuración sin revelar valores (`services/kitToDriveBridge.ts`).
- `adminAuthMiddleware` revalida en BD que el admin siga activo en cada petición.
- Webhook de Stripe rechaza en producción si no hay firma verificable; webhook de Savio usa `timingSafeEqual`.
- Tokens de reset de un solo uso (huella del hash).

## Hallazgos

Severidad: **A** alta · **M** media · **B** baja.

### Back (datos)

| # | Sev | Hallazgo | Evidencia | Recomendación |
|---|---|---|---|---|
| B1 | A | **Aislamiento multi-tenant solo en la aplicación.** El API usa `service_role` (omite RLS) y cada consulta debe acordarse de filtrar `tenant_id`. Un solo filtro olvidado filtra datos entre clientes. RLS está documentado como "endurecimiento futuro". | `docs/OVERVIEW.md` §3; solo 3 migraciones mencionan RLS | Activar RLS con política por `tenant_id` en todas las tablas de datos y, donde sea viable, usar un cliente con JWT de usuario en vez de `service_role`. Mínimo: helper único `scoped(tenantId)` y prueba automática que falle si una ruta consulta sin filtro. |
| B2 | M | `authMiddleware` hace `select('*')` de `workspace_users` y lo deja en `req.user`, incluido `password_hash`. Cualquier ruta que devuelva `req.user` lo filtra. | `middleware/auth.ts` | Seleccionar solo columnas necesarias. |
| B3 | M | Dos consultas a BD por petición autenticada (usuario + tenant) y otra en `tenantMiddleware`: costo y superficie. | `middleware/auth.ts`, `tenant.ts` | Fusionar y cachear corto (30–60 s). |
| B4 | B | `.env.example` trae `ENCRYPTION_KEY=mati_secret_key_32chars_minimo_aqui` (35 caracteres): **pasa la validación** de longitud, así que si alguien copia el ejemplo a producción arranca con una clave pública. | `.env.example`, `config/env.ts` | Dejar vacío en el ejemplo y rechazar en producción cualquier valor que empiece con `mati_secret`/`changeme`. Planear rotación (ya existe `scripts/reencrypt-secrets.ts`). |

### Middle (API)

| # | Sev | Hallazgo | Evidencia | Recomendación |
|---|---|---|---|---|
| M1 | A | **Un solo `JWT_SECRET` firma todo**: sesión de usuario, sesión superadmin, reset, verificación de correo y `state` OAuth. Se distinguen por un claim (`purpose`/`role`) y `authMiddleware` **no valida `purpose`**. | `routes/auth.ts`, `admin.ts`, `comunicacion.ts`, `middleware/auth.ts` | Secretos separados por tipo (o `aud` + `iss` obligatorios y verificados) y `algorithms: ['HS256']` fijo en `jwt.verify`. |
| M2 | A | **Superadmin sin segundo factor.** Un token admin da control de tenants, billing y, vía puente, de usuarios de Kit-to-Drive. Duración 8 h, sin revocación (solo `activo` en BD). | `routes/admin.ts` (login) | MFA (TOTP) para `admin_users`; sesión más corta con refresh; lista de revocación o `jti`; bloqueo por cuenta tras N intentos. |
| M3 | M | **Rate limit en memoria.** `express-rate-limit` sin `store` externo; en Vercel serverless cada instancia cuenta aparte, así que el límite real es mucho mayor. Además solo por IP. | `app.ts` | Store compartido (Redis/Upstash o tabla Supabase) y límite adicional por cuenta/correo. |
| M4 | M | **Contraseñas débiles permitidas en admin:** `userCreateSchema`/`staffCreateSchema` aceptan `password: z.string().min(1)`; la política fuerte solo aplica al alta self-service. El admin además **elige** la contraseña (en Kit-to-Drive la regla es que nadie las escribe). | `routes/admin.ts` | Aplicar `strongPassword` siempre; mejor generar temporal en servidor y enviar por correo, como ya hace el puente. |
| M5 | M | **Subida de archivos:** extensión tomada de `originalname`, `contentType` del cliente, sin lista de tipos permitidos; devuelve `getPublicUrl` (URL pública permanente). Nombre aleatorio con `Math.random`. Riesgo de HTML/SVG servido desde el dominio de Supabase y de exposición de documentos por URL filtrada. | `routes/workspace/upload.ts` | Lista blanca de MIME + extensión; verificar firma del archivo; bucket **privado** con URL firmadas de corta vida; nombre con `crypto.randomUUID()`; `Content-Disposition: attachment`. |
| M6 | M | **CORS:** `http://localhost:5174` está fijo en la lista de producción; se acepta cualquier petición sin `Origin`; `credentials: true` aunque la auth es Bearer. | `app.ts` | Lista según `NODE_ENV`; quitar `credentials` si no se usan cookies. |
| M7 | M | **Puente con Kit-to-Drive autenticado solo con bearer estático.** Sin firma del cuerpo, sin marca de tiempo ni nonce (repetible si se captura), sin lista de IP. `x-mati-actor` lo declara el propio llamador. La bitácora local es `console.info` (efímera en Vercel). | `services/kitToDriveBridge.ts`, `routes/admin-kit-to-drive.ts` | HMAC-SHA256 de `método + ruta + timestamp + sha256(cuerpo)`, ventana ±5 min, nonce de un solo uso; rotación del secreto con dos vigentes; bitácora persistente (quién, qué, resultado) en tabla propia. |
| M8 | B | El webhook de Stripe acepta eventos sin firma si `NODE_ENV !== 'production'`; depende de que la variable esté bien puesta. | `routes/billing.ts` | Exigir firma siempre; usar secreto de prueba en dev. |
| M9 | B | `registrar()` solo escribe método y ruta, sin resultado ni IP; GET (lecturas de datos de usuarios) no se registra. | `admin-kit-to-drive.ts` | Registrar también lecturas sensibles y el código de respuesta. |

### Front (mati-admin)

| # | Sev | Hallazgo | Evidencia | Recomendación |
|---|---|---|---|---|
| F1 | A | **Token superadmin en `localStorage`**: cualquier XSS lo roba y da control total. | `hooks/useAdminAuth.ts`, `api/adminClient.ts` | Cookie `HttpOnly; Secure; SameSite=Strict` (o memoria + refresh en cookie) y, de nuevo, MFA. |
| F2 | M | **Sin cabeceras de seguridad** en `mati-admin/vercel.json` (sin CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy). | `mati-admin/vercel.json` | Añadirlas (puede copiarse la política de `kit-to-drive/vercel.json` y endurecerla: sin `unsafe-eval`, `connect-src` solo al API). |
| F3 | B | No revisé `mati-app` (cliente final) ni `netlify.toml`; mismo punto de token y cabeceras aplica. | — | Revisar igual. |

## Orden sugerido

1. **Ya:** F1+M2 (token fuera de localStorage y MFA), M1 (secretos/`aud` por tipo), B4 (clave de ejemplo).
2. **Siguiente:** M7 (HMAC en el puente), M3 (rate limit compartido), M4, M5, M6, F2.
3. **Planeado:** B1 (RLS por tenant) — es el de mayor impacto estructural y el más largo; empezar por las tablas con datos fiscales y de cobranza.

## Lo que no pude confirmar

- Si Vercel tiene `NODE_ENV=production` y los secretos con la longitud correcta (`GET /admin/kit-to-drive/status` ya lo diagnostica).
- Qué valida la Edge Function `mati-admin-bridge` de su lado (repo `kit-to-drive-web`, no entregado).
- Si el bucket `documentos` es público en el proyecto Supabase de MATI.
