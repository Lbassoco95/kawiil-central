# API del portal del cliente — v1

Una sola API versionada entre el portal (web/PWA hoy, Capacitor después) y `kawiil-central`.
Tiene dos puertas, las dos con el JWT de Supabase Auth del usuario y **nunca** con credenciales de administración:

| Puerta | Qué va ahí | Quién decide el permiso |
|---|---|---|
| **Edge `portal-api`** — `POST /functions/v1/portal-api/v1/<operación>` | Lo que necesita Storage, Auth admin, cifrado, el emisor o el lector de XML | La Edge valida el JWT y pregunta a la base (RPC con el JWT del usuario). Solo escribe con service_role. |
| **PostgREST** — `/rest/v1/<tabla\|vista>` y `/rest/v1/rpc/portal_*` | Lecturas y operaciones que la base puede validar sola | RLS + funciones `SECURITY DEFINER` que verifican rol y cliente |

Versión: el prefijo `v1/` es obligatorio en `portal-api` (otra versión → `404 version_no_soportada`). En PostgREST la versión la dan los nombres `portal_*`; un cambio incompatible se publica con un nombre nuevo (`portal_*_v2`) y el anterior se retira cuando ninguna app instalada lo use.

**Cerco para cuentas del portal.** `portal_pre_request()` (db_pre_request de PostgREST) solo deja pasar a una cuenta del portal hacia `/portal_*`, `/rpc/portal_*`, `/fis_receipts`, `/fis_cfdi` y `/fis_merchants`. Cualquier otra ruta → `403`. Además, cada tabla del back-office tiene la policy restrictiva `portal_deny_portal_accounts`.

Respuesta de `portal-api`: `{ "version": "v1", "data": … }`. Error: `{ "error": "<código>", "message": "<texto para mostrar>", "details"?: … }` con estado HTTP 4xx/5xx.

---

## 1. App → central

### Cuenta
| Operación | Puerta | Cuerpo | Notas |
|---|---|---|---|
| `v1/cuenta.registrar` | portal-api (pública) | `{ email, password (≥10), full_name, acepta_aviso: true, acepta_terminos: true }` | Crea la cuenta **pendiente** (marca `kawiil_portal`), guarda la aceptación del aviso y de los términos con versión y fecha, y pide a Auth el correo de confirmación. Responde igual exista o no el correo. |
| `rpc/portal_me` | PostgREST | `{}` | Cuenta, nivel, clientes (con rol, emisión, tickets) y textos pendientes de aceptar. |
| `rpc/portal_accept_legal` | PostgREST | `{ _kind: "aviso_privacidad"\|"terminos"\|"contrato_uso", _client_id?, _user_agent? }` | Acepta la versión vigente. Deja bitácora. |
| `rpc/portal_log_access` | PostgREST | `{ _client_id? }` | Bitácora de acceso (la llama el portal al iniciar sesión). |
| `rpc/portal_activate_basic` | PostgREST | `{ _razon_social, _rfc }` | Cuenta pendiente → nivel básico con su propio cliente (prospecto). |
| `v1/cuenta.eliminar` | portal-api | `{ confirmacion: "ELIMINAR" }` | Bitácora `cuenta_eliminada` y borrado del usuario de Auth (cascada a cuenta y membresías). |
| Recuperar contraseña / cerrar sesión en todos los dispositivos | Supabase Auth | `resetPasswordForEmail`, `signOut({ scope: "global" })` | — |

### Facturas
| Operación | Puerta | Cuerpo | Notas |
|---|---|---|---|
| Lista | PostgREST `GET /portal_cfdi_v?client_id=eq.<id>&direction=eq.recibida` | filtros PostgREST (`fecha`, `rfc_*`, `total`, `sat_status`) | Trae `flags` (marcas de no deducibilidad) y categoría. |
| `v1/facturas.cargar` | portal-api | `{ client_id, files: [{ name, base64 }] }` (XML o ZIP, ≤20 archivos, ≤10 MB c/u) | Valida estructura CFDI 3.3/4.0 y timbre, que el RFC del cliente sea emisor o receptor, y duplicados por UUID. Respuesta por archivo: `cargada \| duplicada \| rechazada` + motivo. Roles: administrador, operativo. |
| `v1/facturas.validar` | portal-api | `{ client_id, borrador }` | Validaciones de emisión + expediente + uso del nivel básico. No emite. |
| `v1/facturas.crear` | portal-api | `{ client_id, borrador: { receptor: { rfc, nombre, regimen, cp, uso }, formaPago, metodoPago, conceptos: [...] } }` | Solo **ingreso**. El emisor sale del perfil fiscal verificado, no del cuerpo. Exige emisión activada, expediente completo, CSD vigente y (básico) límite no alcanzado → `402 limite_basico`. Con `PORTAL_EMISOR=prueba` devuelve un XML marcado «SIN VALIDEZ FISCAL». |
| `rpc/portal_cancel_request` | PostgREST | `{ _cfdi_id, _motivo: "01".."04", _folio_sustitucion?, _comment? }` | Solo la **solicita**; Kawiil revisa y ejecuta. |
| `rpc/portal_dashboard` | PostgREST | `{ _client_id, _year, _month }` | Tablero: por categoría, mes, proveedor, comparación, ingresos contra gastos, IVA estimado, marcas. Lleva `leyenda`. Roles: administrador, consulta. |
| `rpc/portal_emission_dossier` · `rpc/portal_basic_usage` | PostgREST | `{ _client_id }` | Expediente y uso. |

### CSD
| Operación | Puerta | Cuerpo | Notas |
|---|---|---|---|
| `v1/csd.cargar` | portal-api | `{ client_id, cer_base64, key_base64, password }` | Verifica que el certificado sea del RFC del cliente y esté vigente; cifra en la Edge. Responde **solo metadatos**. |
| `v1/csd.estado` | portal-api (o `rpc/portal_csd_status`) | `{ client_id }` | Serie, vigencia, días para vencer, revocado, último uso. |
| `v1/csd.revocar` | portal-api | `{ registry_id }` | Revoca y apaga la emisión del cliente. |

Ninguna respuesta incluye `.cer`, `.key`, contraseña ni cifrados. `publicCsdView()` (lista blanca de campos) filtra toda salida.

### Tickets
| Operación | Puerta | Cuerpo | Notas |
|---|---|---|---|
| Subir ticket | Storage `juun` → `{org}/juun/clients/{client}/{yyyy}/{mm}/receipts/{archivo}` y luego `rpc/portal_ticket_register` | `{ _client_id, _file_path, _file_hash (sha256), _merchant_id?, _merchant_name?, _receipt_date?, _folio?, _total? }` | Respuesta **inmediata** con `expired`, `visible_status`, `expires_at` y `message` (aviso si ya venció). Duplicado por hash o por folio. HEIC se convierte a JPEG en el navegador. |
| Lista | PostgREST `GET /portal_tickets_v?client_id=eq.<id>` | — | Estados visibles: recibido, en_proceso, facturado, con_problema, vencido. |

### Mensajes
| Operación | Puerta | Cuerpo |
|---|---|---|
| Abrir hilo | `rpc/portal_thread_create` | `{ _client_id, _subject, _body }` (básico → siempre «contratación») |
| Enviar | `rpc/portal_message_send` | `{ _thread_id, _body, _attachments?: [{ storage_path, file_name, mime_type, size_bytes }] }` — adjuntos subidos antes a `portal/{org}/{client}/mensajes/{thread}/` |
| Leído | `rpc/portal_thread_mark_read` · `rpc/portal_thread_read_state` | `{ _thread_id }` |
| Lista | `GET /portal_threads`, `/portal_messages`, `/portal_message_attachments` | — |

### Documentos
| Operación | Puerta | Cuerpo |
|---|---|---|
| Lista (solo publicados, solo premier) | `GET /portal_documents?client_id=eq.<id>` | — |
| Marcar como leído | `rpc/portal_document_mark_read` | `{ _document_id }` (bitácora `documento_consulta`) |

### Archivos
`v1/archivos.enlace` — `{ kind: "documento"|"cfdi_xml"|"cfdi_pdf"|"ticket"|"ticket_cfdi_xml"|"ticket_cfdi_pdf"|"adjunto", id }` → `{ url, expires_in: 120 }`. El permiso se decide leyendo la fila con el JWT del usuario (RLS). Bitácora `documento_descarga` / `archivo_descarga`. Nunca hay URL pública.

---

## 2. Central → app

Lo hace el equipo desde central; el portal lo ve en su siguiente lectura y recibe aviso por correo (bandeja de salida `portal_outbox` → Edge `portal-notify`). Push llega en la fase de app.

| Operación | Puerta | Efecto en la app |
|---|---|---|
| Publicar documento | `rpc/portal_staff_publish_document { _document_id, _title, _doc_type, _period_year, _period_month? }` | Aparece en «Documentos» + correo `documento_nuevo`. |
| Despublicar | `rpc/portal_staff_unpublish_document { _document_id }` | Desaparece. |
| Publicar facturas | `v1/facturas.cargar` (el equipo también puede) o `rpc/portal_staff_import_moffin_cfdi { _client_id, _cfdis }` con el detalle de `moffin-facturas` | Aparecen en «Facturas». |
| Cambiar estado de ticket | `rpc/portal_staff_ticket_update { _receipt_id, _merchant_id?, _receipt_date?, _folio?, _total?, _status?, _note? }` | Cambia el estado visible; problemas → correo. |
| Facturar ticket | `v1/central/tickets.facturar { receipt_id, xml_base64, pdf_base64 }` | Ticket → «facturado» con XML y PDF; la factura entra al tablero. |
| Responder mensaje | `rpc/portal_message_send` (el lado lo decide la base) | Respuesta visible + correo `respuesta_equipo`. |
| Avisar | `v1/central/avisar { client_id, asunto, mensaje }` | Correo a los usuarios del cliente. |
| Invitar | `v1/central/invitar { email, full_name, client_id, role, tier }` | Cuenta ya vinculada + correo para crear contraseña. |
| Vincular / roles / suspender | `rpc/portal_staff_link_account`, `portal_staff_set_membership`, `portal_staff_set_account` | Cambia lo que ve. |
| Emisión | `rpc/portal_staff_set_emission`, `portal_staff_register_instruction_letter`, `portal_staff_resolve_cancel` | Activa/desactiva «Crear factura». |
| Categorías | `rpc/portal_staff_confirm_category`, `v1/central/categorias.sugerir` | Tablero con categorías confirmadas. |

---

## 3. Códigos de error de `portal-api`

`no_autorizado` 401 · `sin_permiso` 403 · `emision_apagada` 403 · `expediente_incompleto` 403 · `limite_basico` 402 · `validacion` 422 (con `details` = lista de `{ campo, mensaje }`) · `cfdi_invalido` 422 · `pac_no_configurado` 503 · `no_configurado` 503 · `dato_faltante`/`dato_invalido` 400 · `no_encontrado` 404 · `ya_cargado` 409 · `interno` 500.

## 4. Lo que la API nunca hace

- Devolver e.firma, CIEC, CSD, contraseñas o cifrados.
- Aceptar el `organization_id`, el autor de un mensaje o el emisor de una factura desde el navegador: los deriva la base o el perfil fiscal verificado.
- Publicar un documento sin una persona, confirmar una categoría con el modelo, o timbrar con un PAC real.
- Llamar a un modelo fuera de `openclaw-gateway`.
