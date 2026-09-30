# Crear el proyecto separado de Kawiil OS

Este procedimiento no toca producción hasta que Polo ejecute expresamente cada paso. Use proyectos nuevos y datos sintéticos durante el ensayo.

## 0. Separación de migraciones (confirmación)

- El despliegue de **central a `main`** (workflow `deploy-supabase.yml`) aplica **solo** `supabase/migrations/**` del proyecto de central. **No** aplica `kawiil-os/supabase/migrations/`.
- Las migraciones de **Kawiil OS** viven únicamente en `kawiil-os/supabase/migrations/` y **solo** llegan a un proyecto OS enlazado con `--workdir kawiil-os` (`npm run kawiil-os:db-push` o los bootstrap de §2b).
- Mezclar ambas cadenas haría que central intentara crear tablas del portal y que OS heredara la cadena de central: por eso están separadas a propósito.
- La suite `npm run test:kawiil-os-db` vigila que el árbol `kawiil-os/` no embuta el project ref ni JWT de central (**denylist intacta**, sin excepciones para demo).

Guía corta para Polo: [ARRANQUE-POLO.md](ARRANQUE-POLO.md).

## 1. Crear el proyecto

1. Entre a Supabase y seleccione **New project**.
2. Nombres exactos: `kawiil-os-ensayo` (ensayo) y `kawiil-os-demo` (demostración).
3. Genere una contraseña nueva y guárdela en el administrador de secretos; no la copie al repositorio.
4. Seleccione la misma región que central para reducir latencia, sin enlazar las bases.
5. En **Authentication → Providers → Email**, mantenga desactivado el registro público.
6. En **Authentication → URL Configuration**, configure únicamente el dominio del portal y sus redirects de acceso.

## 2. Aplicar la base de Kawiil OS

Desde una copia limpia del repositorio (manual):

```bash
npx supabase login
npx supabase link --workdir kawiil-os --project-ref <REF_KAWIIL_OS>
npm run kawiil-os:db-push
# equivalente: npx supabase db push --workdir kawiil-os
```

Antes del `db push`, confirme que `<REF_KAWIIL_OS>` no sea el project ref de central (`qppfampapbxdgednkofc`). El conjunto aplicado es exclusivamente `kawiil-os/supabase/migrations/`.

El baseline vive en `kawiil-os/supabase/` (ruta estable del repo; salió de `.devin/`) y **no** en `supabase/migrations/` porque ese directorio es la cadena de migraciones del proyecto de central. Con `--workdir kawiil-os`, el CLI trata esa carpeta como un proyecto Supabase independiente con su propio `config.toml`, `migrations/` y `rollbacks/`.

La prueba automática de separación es `npm run test:kawiil-os-db` (también en CI, job `base-y-api`).

## 2b. Bootstrap de un comando (ensayo / demo)

Variables **solo en el entorno local** (nunca en el repositorio). Los scripts se niegan a correr si el ref es el de central o si `KAWIIL_OS_TARGET` no coincide con el destino.

```bash
# Ensayo: solo baseline (+ espejo)
KAWIIL_OS_TARGET=kawiil-os-ensayo \
KAWIIL_OS_PROJECT_REF=<ref-ensayo> \
npm run kawiil-os:bootstrap-ensayo

# Demo: baseline (+ espejo) + datos sintéticos
KAWIIL_OS_TARGET=kawiil-os-demo \
KAWIIL_OS_PROJECT_REF=<ref-demo> \
KAWIIL_OS_DB_URL='postgresql://…' \
npm run kawiil-os:bootstrap-demo
```

Cruce de llaves (cuando existan ambos proyectos):

```bash
CENTRAL_SUPABASE_URL=… CENTRAL_ANON_KEY=… \
KAWIIL_OS_SUPABASE_URL=… KAWIIL_OS_ANON_KEY=… \
npm run kawiil-os:verify-cross
```

Sin esas variables el verificador responde **NO VERIFICABLE** (no inventa llaves).

Comprobación en SQL Editor del proyecto nuevo:

```sql
select tablename from pg_tables
where schemaname = 'public'
  and tablename in ('profiles','user_roles','clients','rh_attendance','client_sat_certificates','linked_accounts');
```

Debe devolver cero filas.

## 3. Desplegar las funciones de Kawiil OS

Copie al proyecto nuevo estas funciones y sus dependencias compartidas:

- `portal-api`
- `portal-system-api`
- `portal-system-dispatch`
- `portal-notify`

Use siempre el project ref de Kawiil OS. No despliegue allí funciones de Microsoft, Slack, Dropbox, Moffin de central ni `central-portal-api`.

## 4. Crear secretos independientes

En Kawiil OS configure:

- `CENTRAL_TO_OS_SIGNING_SECRET`: valida publicaciones de central.
- `OS_TO_CENTRAL_SIGNING_SECRET`: firma entregas a central; debe ser distinto al anterior.
- `CENTRAL_SYSTEM_API_URL`: URL HTTPS de `central-portal-api`, no una URL de base ni PostgREST.
- `CRON_SECRET`: invocación del despachador.
- `PORTAL_ALLOWED_ORIGIN`, `PORTAL_PUBLIC_URL` y secretos de cifrado propios.
- Proveedor de correo propio del portal, Turnstile y, cuando corresponda, PAC sandbox.

No configure en Kawiil OS:

- URL o `service_role` de central.
- Tokens de Microsoft, Dropbox, Slack o Moffin de central.
- Certificados o credenciales reales durante el ensayo.

En central configure solamente:

- `OS_TO_CENTRAL_SIGNING_SECRET` para validar entregas.
- `CENTRAL_TO_OS_SIGNING_SECRET` para firmar publicaciones.
- La URL HTTPS de `portal-system-api` para el productor de la cola.

Rote cada secreto generando uno nuevo, aceptando temporalmente versión actual y siguiente durante una ventana controlada y retirando después el anterior. La implementación inicial requiere despliegue coordinado porque acepta una versión.

## 5. Configurar Vercel

Cree un proyecto Vercel independiente para el build del portal:

- Build: `npm run build:portal`
- Output: `dist-portal`
- `VITE_PORTAL_SUPABASE_URL`: URL del proyecto Kawiil OS.
- `VITE_PORTAL_SUPABASE_PUBLISHABLE_KEY`: llave pública del proyecto Kawiil OS.
- `VITE_PORTAL_PUBLIC_URL`: dominio del portal.
- `VITE_TURNSTILE_SITE_KEY`: llave del sitio correspondiente al dominio.

Conserve `VITE_SUPABASE_URL` de central únicamente en el despliegue de central. El portal se niega a iniciar si ambas URLs coinciden.

## 6. Configurar correo, captcha y dominio

1. Use un subdominio dedicado, por ejemplo `portal.<dominio>`.
2. Registre ese dominio en Supabase Auth y Vercel.
3. Cree un sitio Turnstile propio. Para demo use exclusivamente las llaves públicas de prueba indicadas por Cloudflare.
4. Configure un remitente dedicado para avisos del portal. En demo, sustituya el transporte por la bandeja de pruebas y no permita salida a Internet.
5. Mantenga apagado el registro público. Las altas las realizan operaciones administrativas auditadas.

## 7. Programar reintentos

Programe `portal-system-dispatch` cada cinco minutos enviando `x-cron-secret`. La función procesa hasta 50 eventos, conserva fallos y reintenta con espera exponencial. Configure una alerta cuando un evento supere cinco intentos o lleve más de una hora pendiente.

## 8. Traslado de datos existentes

No se consultó producción ni se ejecutó traslado. La rama contiene estructuras del portal, pero desde el repositorio no es posible afirmar si el proyecto actual tiene filas reales; queda **no verificable sin una consulta autorizada de solo conteos**.

Si existen datos:

1. Detenga temporalmente nuevas escrituras del portal compartido.
2. Exporte solo tablas `portal_*` y archivos de buckets `portal`/`juun` asociados a empresas autorizadas.
3. Transforme referencias `clients` a `portal_companies.external_ref` y `fis_*` a las tablas propias.
4. No exporte tablas de central, tokens ni secretos.
5. Importe primero empresas y cuentas, luego membresías y finalmente datos dependientes.
6. Copie archivos servidor a servidor con hashes; nunca vuelva público un bucket.
7. Compare conteos y hashes por empresa.
8. Pruebe acceso de cada papel y empresa.
9. Cambie el portal al nuevo proyecto.
10. Mantenga el origen en solo lectura durante la ventana aprobada y elimínelo únicamente mediante una solicitud destructiva separada.

## 9. Validación previa a apertura

- `PORTAL_STATIC_ONLY=1 npm run portal:verificar-cerco`
- `npm run build:portal`
- `npx vitest run src/test/portal/systemBoundary.test.ts`
- En CI: `bash supabase/tests/portal/run_kawiil_os_db_tests.sh`
- Confirmar cruce de llaves: `npm run kawiil-os:verify-cross` (con env locales; sin env → NO VERIFICABLE).
- Alterar cuerpo, operación, nonce y timestamp de una llamada firmada y comprobar rechazo.
- Apagar temporalmente el receptor, crear un evento y comprobar que queda pendiente y se entrega una sola vez al restaurarlo.

No abra el portal si cualquiera de estas comprobaciones falla.
