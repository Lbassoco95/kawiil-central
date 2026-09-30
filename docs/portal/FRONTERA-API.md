# Frontera de API de Kawiil OS

## Decisión

Kawiil OS usa un proyecto de Supabase distinto de `kawiil-central`. La separación física es el control principal; RLS, autorización por empresa y el catálogo cerrado de operaciones son capas adicionales. La rama parte de `claude/elegant-gates-ha1ika` porque los PR #329 y #330 seguían abiertos el 29 de septiembre de 2026.

## Inventario del navegador

El navegador conserva exclusivamente la sesión de Supabase Auth del proyecto Kawiil OS y llama `portal-api/v1/<operación>`. `src/portal/lib/supabase.ts` se niega a iniciar si la URL del portal coincide con `VITE_SUPABASE_URL` de central. La verificación `npm run portal:verificar-cerco`, ejecutada por CI, falla ante cualquier uso nuevo de `.from`, `.rpc`, Storage o Functions fuera del único cliente de API.

Los 29 accesos directos encontrados en la base original se agruparon así:

| Pantalla | Accesos anteriores | Operaciones API |
|---|---:|---|
| Sesión y acceso | 2 RPC | `sesion.actual`, `sesion.registrar_acceso` |
| Textos legales y activación | 4 RPC | `legal.actual`, `legal.aceptar`, `cuenta.activar_basico` |
| Tablero | 1 RPC | `tablero.consultar` |
| Facturas | vista + RPC | `facturas.listar`, `facturas.cargar`, `facturas.solicitar_cancelacion` |
| Tickets | 2 tablas, Storage y 2 RPC | `tickets.listar`, `tickets.registrar` |
| Documentos | tabla y RPC | `documentos.listar`, `documentos.descargar` |
| Mensajes | 3 tablas, Storage y 5 RPC | `mensajes.listar`, `mensajes.leer`, `mensajes.enviar` |
| Cuenta | 1 RPC | `cuenta.plan_baja`, `cuenta.eliminar`, `csd.*` |

Supabase Auth (`getSession`, renovación y cierre de sesión) es la única comunicación directa permitida desde el navegador. No es acceso a datos de negocio.

## Datos de cada proyecto

### Solo Kawiil OS

- Cuentas del portal, empresas y membresías.
- CFDI, detalle fiscal, tickets y documentos ya publicados.
- Conversaciones copiadas por contrato API.
- Empleados de clientes, asistencia, ausencias, expedientes, incidencias y campañas.
- Respuestas de clima y NOM-035 cifradas.
- CSD cifrado, bitácora, baja, resguardo, nonces y cola saliente.

### Solo central

- Personas y RH del equipo de Kawiil.
- Nómina interna, gastos, finanzas y mensajes internos.
- Clientes de otras organizaciones y operación interna.
- Tokens de Microsoft, Slack, Dropbox, Moffin y otros proveedores.
- Credenciales de servicio de central.

La credencial `service_role` de Kawiil OS pertenece al proyecto Kawiil OS y, por construcción, no es aceptada por el proyecto central. Ninguna Edge Function de Kawiil OS recibe URL de base, llave anónima o llave de servicio de central.

## API navegador → Kawiil OS

`portal-api` tiene un mapa estático de operaciones. Una operación ausente responde `404 operacion_desconocida`; sin JWT responde `401`; empresa o papel incorrectos responden `403`. Cada respuesta se arma para la pantalla y no expone cifrados, secretos ni filas administrativas.

## API central → Kawiil OS

Endpoint: `portal-system-api`.

| Operación | Emisor | Datos mínimos | Efecto |
|---|---|---|---|
| `company.upsert` | central G3/G4 | referencia, nombre, nivel y RFC cuando corresponda | alta o actualización de empresa |
| `company.modules` | central G3/G4 | referencia y banderas | activa fiscal, tickets o RH |
| `company.delete` | central G3/G4 | referencia | revoca acceso y comienza baja |
| `document.publish` | central | metadatos y ruta del objeto ya copiado | publica un documento autorizado |
| `sat_document.publish` | central | solo constancia u opinión | publicación automática controlada |
| `message.reply` | central | referencia de hilo y respuesta | copia la respuesta al cliente |

## API Kawiil OS → central

Endpoint central: `central-portal-api`.

| Operación | Emisor | Datos mínimos | Destino |
|---|---|---|---|
| `ticket.submitted` | Kawiil OS | empresa, ticket y referencia segura | bandeja de facturación |
| `cancellation.requested` | Kawiil OS | empresa, CFDI y motivo | revisión de cancelación |
| `payroll.incidents` | Kawiil OS | periodo cerrado y agregados autorizados | proceso de nómina |
| `message.sent` | Kawiil OS | empresa, hilo y mensaje | bandeja Clientes |

Cada petición incluye timestamp, nonce, operación, hash del cuerpo y HMAC-SHA256. El receptor acepta cinco minutos de desviación, guarda nonce e idempotency key y rechaza alteraciones. Las colas conservan eventos pendientes y reintentan con espera exponencial. Un error remoto no detiene la operación local.

## Datos que no cruzan

Nunca salen de Kawiil OS:

- Respuestas individuales de clima o NOM-035.
- RFC, CURP, NSS, CLABE, banco o ubicación de empleados.
- Documentos de expedientes laborales.
- CSD, llaves, contraseñas o texto cifrado.

Central recibe únicamente incidencias agregadas y autorizadas para nómina. El acceso excepcional del equipo a expedientes o resultados agregados se implementa como autorización temporal en Kawiil OS y queda auditado; no concede acceso de base.

## Pruebas

- `run_kawiil_os_db_tests.sh`: crea una base vacía, aplica solo el baseline, verifica ausencia de tablas de central, prueba aislamiento entre dos empresas y ejecuta rollback.
- `systemBoundary.test.ts`: firma válida, secreto de sentido incorrecto, alteración, expiración y operación alterada.
- `portal:verificar-cerco`: búsqueda estática obligatoria de accesos directos.
- La suite HTTP existente mantiene pruebas de papel, empresa y operación desconocida.

## Riesgo residual

### Qué protege cada capa

| Capa | Protege | No protege |
|---|---|---|
| Proyectos separados | Una credencial de Kawiil OS no es aceptada por central ni viceversa | Nada si se comparte el mismo secreto entre proyectos |
| `service_role` por proyecto | Cada función administrativa solo alcanza su propia base | Una `service_role` filtrada sigue leyendo todo su propio proyecto |
| RLS por empresa | Una cuenta del portal no ve otras empresas aunque consulte la API | No restringe al backend con `service_role` |
| Catálogo cerrado | Rechaza operaciones fuera de lista y consultas libres | No valida que el contenido publicado sea correcto |
| Firma HMAC + nonce + timestamp | Rechaza alteración, repetición y mensajes viejos | Si el secreto se pierde, un atacante firma llamadas válidas |
| Idempotency key + outbox | Repetición no duplica efectos; caída no pierde eventos | No impide que un evento legítimo sea semánticamente erróneo |
| Bitácora | Deja rastro de cada operación administrativa y de sistema | No bloquea; solo evidencia |

### Si se pierde un secreto entre sistemas

- **`CENTRAL_TO_OS_SIGNING_SECRET`**: un atacante puede publicar documentos, activar módulos y dar de baja empresas en Kawiil OS. No obtiene lectura de base ni respuestas de clima; todo queda en bitácora y el nonce impide reutilizar una llamada capturada. Respuesta: rotar el secreto en ambos lados y revisar `portal_audit_log`.
- **`OS_TO_CENTRAL_SIGNING_SECRET`**: un atacante puede inyectar tickets, solicitudes de cancelación, incidencias y mensajes falsos en central. Respuesta idéntica, más revisión de la bandeja durante la ventana de exposición.
- **`service_role` de Kawiil OS**: compromete solo Kawiil OS; central permanece inalcanzable. Rotar desde el panel de Supabase y revisar la bitácora.
- **`service_role` de central**: no compromete Kawiil OS, pero es riesgo interno de central, fuera del alcance de esta frontera.

### Riesgos abiertos

- Una publicación legítimamente firmada puede contener datos incorrectos por un error de central; se reduce con listas de tipos, payload mínimo e idempotencia.
- La disponibilidad depende de dos proyectos; las colas desacoplan caídas pero no eliminan la dependencia operativa.
- La rotación actual acepta una sola versión de secreto, así que requiere despliegue coordinado; soportar versión siguiente durante una ventana queda como mejora pendiente.
- Polo debe rotar ambos secretos de manera coordinada y supervisar eventos fallidos del despachador.
