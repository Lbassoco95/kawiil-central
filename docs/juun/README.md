# Ju'un — autofacturación de tickets de gasto

Ju'un convierte la **foto de un ticket de gasto** en el **CFDI de ese gasto** (XML + PDF),
guardado contra ese gasto en Kawiil OS.

El flujo completo, en una frase: *el usuario sube la foto del ticket en la ficha de un
cliente; el sistema lee los datos del ticket, identifica en qué comercio se hizo la compra,
y un agente automatizado entra al portal de facturación de ese comercio, llena el
formulario con los datos fiscales del cliente, descarga el XML y el PDF, y los almacena.*

## Lo que Ju'un NO hace

- No emite CFDI propios ni timbra. No usa PAC.
- **No toca la e.firma ni la CIEC de nadie.** No las necesita y no las guarda.
  (El repo sí guarda esas credenciales cifradas para el módulo Moffin, en
  `client_sat_certificates` y `moffin_client_sat_ciec`. Ju'un no las lee ni las escribe.)
- No contrata ni integra un servicio externo de autofacturación. El motor de portales es nuestro.

Lo único que Ju'un usa del cliente son **datos fiscales públicos** de su Constancia de
Situación Fiscal: RFC, razón social, código postal fiscal, régimen y uso de CFDI.

---

## Estado: Bloque 1 terminado

| Bloque | Qué es | Estado |
|---|---|---|
| 1 | Esquema, catálogo de comercios, datos fiscales en la ficha | ✅ hecho |
| 2 | Carga de la foto, extracción (QR + visión) y validación | pendiente |
| 3 | El agente que entra al portal (intérprete de recetas, captcha, cola) | pendiente |
| 4 | Pantalla de operación y modo demo | pendiente |

---

## Modelo de datos

Seis tablas, prefijo `fis_`. Migración: `supabase/migrations/20260824220000_juun_fis_schema.sql`.

| Tabla | Qué guarda |
|---|---|
| `fis_tax_profiles` | Datos fiscales del cliente (1:N — puede facturar con varias empresas) |
| `fis_merchants` | Catálogo global de comercios y su receta de portal |
| `fis_recipe_versions` | Histórico y propuestas de receta por comercio |
| `fis_receipts` | El ticket cargado, su extracción y su estado |
| `fis_attempts` | Cada intento de facturar, con screenshot y trace |
| `fis_cfdi` | El CFDI obtenido |

### Tenancy: la organización, no el cliente

El tenant de este repo es la **organización** (`get_user_org_id(auth.uid())` sobre
`profiles.organization_id`), no el cliente. Por eso cada tabla con datos lleva
`organization_id NOT NULL` para la RLS y `client_id` para la relación de negocio.
Una RLS por `client_id` no aislaría nada aquí: todo usuario de la organización ve a
todos sus clientes.

`fis_attempts` y `fis_cfdi` **no aceptan** el `organization_id` que les manden: un
trigger (`fis_inherit_receipt_org`) lo deriva del ticket padre. Así una fila no puede
quedar marcada con el tenant equivocado y escaparse de la RLS.

`fis_merchants` y `fis_recipe_versions` son catálogo global: lectura para cualquier
autenticado, escritura solo `service_role` (las recetas las escribe el worker, nunca
el navegador).

### Máquina de estados del ticket (13)

```
received → extracted → validated → queued → processing → invoiced

Salidas laterales:
  needs_data         la extracción no alcanzó: hace falta re-foto o captura manual
  unknown_merchant   el comercio no está en el catálogo
  window_expired     el plazo del comercio ya venció
  not_deductible     no vale la pena facturarlo
  duplicate          ya existe ese ticket
  portal_rejected    el portal dijo que no (folio inválido, ya facturado…)
  manual_queue       el agente se rindió; requiere intervención humana
```

La lista vive **dos veces**: como CHECK en la migración y como constante en
`src/lib/juun/receiptStatus.ts`. Una prueba compara ambas y truena si se separan.
Lo mismo con los catálogos del SAT (`src/lib/juun/satCatalogs.ts`).

---

## Almacenamiento

Bucket privado **`juun`** (`supabase/migrations/20260824221000_juun_storage_bucket.sql`).

```
{organization_id}/juun/clients/{client_id}/{yyyy}/{mm}/{tipo}/{ts}_{nombre}.{ext}
tipo ∈ receipts | cfdi | csf | evidence
```

**El primer segmento es la organización y de ahí cuelga la policy de storage.** No es
orden decorativo: es el aislamiento entre tenants. Si cambias el orden de la ruta,
rompes la seguridad, no el orden de las carpetas.

No se reusa el bucket `documents` a propósito: sus policies son `bucket_id = 'documents'`
a secas, sin scoping por path ni por organización, así que cualquier usuario autenticado
del proyecto puede leer cualquier archivo. Aquí van CSF, tickets, CFDI y evidencia de
navegación de clientes.

Los archivos se leen **siempre** por signed URL de 5 minutos (`getCsfSignedUrl`), nunca
por URL pública ni path directo en el front.

---

## Cómo agregar un comercio nuevo

Agregar un portal es **dato, no código**: por eso la receta vive en `fis_merchants.recipe`
como JSON y un intérprete genérico la ejecuta. Si las recetas estuvieran en TypeScript,
agregar el comercio 15 requeriría un despliegue.

1. **Entra tú al portal en Chrome** y documenta qué campos pide, si tiene captcha, si es
   SPA y cómo entrega los archivos. Sin ese reconocimiento no se escribe la receta:
   un selector adivinado quema la ventana de facturación de tickets reales.
2. Agrega la fila al seed (`supabase/migrations/*_juun_merchants_seed.sql` o una migración
   nueva) con `method = 'manual'`, `recipe = NULL`, sus `required_fields`, su
   `window_type` / `window_days` y sus `aliases` — las variantes del nombre **tal como se
   imprimen en el ticket**, que es de lo que depende el match automático.
3. Cuando la receta esté probada, se sube a `fis_recipe_versions` y se promueve a
   `active`; solo entonces el comercio pasa a `method = 'agent'`.

El seed es idempotente y se puede re-correr. Manda sobre lo **descriptivo**
(`name`, `aliases`, `required_fields`, ventana) y **no toca** lo **operativo**
(`recipe`, `recipe_version`, `method`, `self_heal_enabled`, `active`): re-correrlo nunca
regresa a `manual` un comercio que ya estaba funcionando.

---

## Qué hacer cuando un portal cambia

Diseño previsto para el Bloque 3, ya soportado por el esquema:

1. El paso falla porque el selector ya no existe → se reintenta dos veces con backoff
   (puede ser lentitud, no cambio de DOM).
2. Si sigue fallando y `fis_merchants.self_heal_enabled` está en `true`, se le pide al
   modelo un selector nuevo a partir del snapshot de accesibilidad de la página.
3. La receta reparada **no se promueve sola**: nace en `fis_recipe_versions` con
   `status = 'proposed'`. Solo pasa a `active` (y se copia a `fis_merchants.recipe`) si
   el reintento del ticket que la generó **termina en éxito**. Si falla, se queda en
   `proposed` y el ticket va a `manual_queue`.
4. Si el modelo propone cambiar **más de 2 pasos** en una corrida, no se aplica: eso ya
   no es un selector movido, es un portal rediseñado, y tiene que verlo una persona.

El principio: **se aprende una vez con modelo, se repite mil veces sin modelo.** El
modelo descubre y repara; la ejecución diaria es determinista y barata.

Kill switch por comercio: `fis_merchants.self_heal_enabled = false`.

---

## Cómo correr el worker en local

Pendiente: el worker de Playwright es el Bloque 3. Cuando exista, va en la VM
`kawiil-agents` y se dispara por `pg_cron` → Edge → `dispatch-to-agent`. La cola es la
propia tabla `fis_receipts`, ordenada por `expires_at` (no FIFO: un ticket de restaurante
con 20 horas de vida va antes que uno de Walmart con tres semanas) y tomada con
`FOR UPDATE SKIP LOCKED`; `lease_until` libera el job si el worker muere.

---

## Nota: la conciliación futura no necesita descarga masiva

El repo **ya consulta los CFDI del cliente ante el SAT** vía Moffin
(`supabase/functions/moffin-facturas`, con la CIEC que Moffin custodia), y guarda solo
conteos y montos por periodo en `moffin_cfdi_counts`.

Eso significa que cuando toque conciliar «qué gastos ya tienen factura», **no hace falta
descarga masiva ni tocar la e.firma jamás**: se compara contra lo que Moffin ya sabe.
No está implementado y no es parte de estos bloques; queda anotado para que nadie diseñe
algo que lo estorbe.

---

## Variables de entorno

El Bloque 1 **no agrega ninguna**. Ju'un no llama a ningún modelo todavía.

Cuando llegue el Bloque 2, la salida hacia el modelo será **un solo punto** y pasará por
`openclaw-gateway`. Ninguna llamada directa a `api.anthropic.com` desde código de Ju'un;
que otros módulos del repo lo hagan en 22 lugares es deuda de ellos, no permiso para
sumar el 23.

---

## Archivos

```
supabase/migrations/20260824220000_juun_fis_schema.sql      esquema + RLS + triggers
supabase/migrations/20260824221000_juun_storage_bucket.sql  bucket privado juun
supabase/migrations/20260824222000_juun_merchants_seed.sql  15 comercios, idempotente
migrations/2026-08-24_juun_*.rollback.sql                   reversión (a mano; ver migrations/README.md)

src/lib/juun/satCatalogs.ts        c_RegimenFiscal y c_UsoCFDI
src/lib/juun/rfc.ts                validación de RFC y CP
src/lib/juun/taxProfileSchema.ts   validación del formulario (zod)
src/lib/juun/storagePaths.ts       rutas del bucket juun
src/lib/juun/receiptStatus.ts      los 13 estados del ticket
src/lib/juun/db.ts                 tipos de las tablas fis_* mientras types.ts no se regenera
src/hooks/useClientTaxProfiles.ts  CRUD de perfiles fiscales
src/components/clients/ClientTaxProfilesSection.tsx   sección «Datos fiscales»
```
