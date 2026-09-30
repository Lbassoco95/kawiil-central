# Arranque de Kawiil OS — guía para Polo (≤10 pasos)

Nombres exactos. No usa producción. Las llaves y project refs van **solo** en variables de su máquina, nunca en el repositorio.

## Pasos

1. En Supabase, cree dos proyectos nuevos llamados exactamente **`kawiil-os-ensayo`** y **`kawiil-os-demo`**. Apague el registro público de Auth en ambos. Anote de cada uno: project ref, URL, llave anon y cadena Postgres (Settings → Database).

2. En su terminal, en la carpeta del repo y en la rama del PR de Corte 4, inicie sesión de Supabase CLI: `npx supabase login`.

3. Arranque el **ensayo** (solo base, sin datos demo):
   ```bash
   KAWIIL_OS_TARGET=kawiil-os-ensayo \
   KAWIIL_OS_PROJECT_REF=<ref-de-kawiil-os-ensayo> \
   npm run kawiil-os:bootstrap-ensayo
   ```
   Si el ref es el de central o el nombre no coincide, el comando se detiene a propósito.

4. Arranque el **demo** (base + datos sintéticos del espejo):
   ```bash
   KAWIIL_OS_TARGET=kawiil-os-demo \
   KAWIIL_OS_PROJECT_REF=<ref-de-kawiil-os-demo> \
   KAWIIL_OS_DB_URL='<cadena-postgres-del-demo>' \
   npm run kawiil-os:bootstrap-demo
   ```

5. En el proyecto **`kawiil-os-demo`**, cree el usuario Auth `demo.cliente@kawiil-demo.invalid` (contraseña solo en su administrador de secretos). Si el UUID no es el de la semilla, ajuste la membresía en SQL Editor según `docs/portal/DEMO.md`.

6. Despliegue en el proyecto demo solo estas funciones: `portal-api`, `portal-system-api`, `portal-system-dispatch`, `portal-notify`. Secretos de prueba (Turnstile always-pass). `PORTAL_MIRROR_READ_ONLY=true`.

7. Publique el front del portal apuntando **solo** al demo:
   ```bash
   VITE_PORTAL_DEMO_MODE=true \
   VITE_PORTAL_SUPABASE_URL=https://<ref-demo>.supabase.co \
   VITE_PORTAL_SUPABASE_PUBLISHABLE_KEY=<anon-demo> \
   VITE_PORTAL_PUBLIC_URL=<url-publica-demo> \
   VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
   npm run build:portal
   ```

8. Compruebe el cruce de llaves (central ↔ OS):
   ```bash
   CENTRAL_SUPABASE_URL=<url-central> CENTRAL_ANON_KEY=<anon-central> \
   KAWIIL_OS_SUPABASE_URL=<url-demo-u-ensayo> KAWIIL_OS_ANON_KEY=<anon-os> \
   npm run kawiil-os:verify-cross
   ```
   Debe decir **cumplido**. Sin variables: **NO VERIFICABLE**.

9. Recorra el guion `docs/portal/DEMO-GUION.md` (tablero → facturas → documentos → alertas). Sin RH ni «Crear factura». Tras la sesión: `PORTAL_DEMO_ALLOW_RESET=1 KAWIIL_OS_DB_URL=… npm run portal:demo-reset`.

10. No fusione los PR de Corte 0 / 3 / 4 hasta marcar las casillas de cada lista. El despliegue a `main` de central **no** aplica migraciones de Kawiil OS.

## Comandos de referencia

| Qué | Comando |
|---|---|
| Bootstrap ensayo | `npm run kawiil-os:bootstrap-ensayo` |
| Bootstrap demo | `npm run kawiil-os:bootstrap-demo` |
| Reinicio datos demo | `npm run portal:demo-reset` |
| Cruce de llaves | `npm run kawiil-os:verify-cross` |
| Cerco del árbol OS | `npm run test:kawiil-os-db` |

Detalle técnico: `docs/portal/PROYECTO-SEPARADO.md`, `docs/portal/DEMO.md`.
