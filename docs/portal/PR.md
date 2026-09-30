# Portal del cliente (Kawiil OS) — NO FUSIONAR hasta completar la lista

> Al fusionar a `main`, el pipeline aplica en **producción** las 14 migraciones del portal. Antes de fusionar hay que completar la lista del final.

## Qué hace el portal

Es una aplicación nueva para los **clientes** de Kawiil, separada de central y construida aparte, instalable en el teléfono. Usa los mismos datos de central, pero cada cliente ve solo lo suyo. Contiene:

- **Tablero de gasto** del mes, con sus facturas emitidas y recibidas.
- **Facturas:** consulta y carga de XML. También permite crear facturas de ingreso; por ahora solo con un emisor **de prueba**, sin validez fiscal, porque no hay un PAC conectado ni se timbra nada.
- **Documentos:** llegan desde las carpetas FISCAL y CONTABILIDAD de Dropbox, nunca de ADMINISTRATIVO. Ninguno se publica solo: una persona del equipo lo aprueba.
- **Tickets de gastos**, sobre Ju'un, con los plazos de cada comercio para facturar.
- **Mensajes con el equipo.** En central aparecen en Comunicación → «Clientes». No se usa Slack para guardarlos.
- **Cuenta:** carga del certificado de sello digital (CSD) y eliminación de la cuenta.

Hay dos niveles: **premier** (cliente de Kawiil, vinculado por el equipo) y **básico** (se registra desde la tienda y activa su propia empresa).

En central se agrega «Portal de clientes», con cuentas, publicación, Dropbox, facturación de gastos, facturas, emisión, catálogos y baja y resguardo.

## Cómo se aísla del resto de central

- **Cuentas separadas.** Una cuenta del portal nunca es del equipo: no tiene perfil ni rol, y la base lo impide.
- **Cada cliente ve solo lo suyo.** Lo aplica la base de datos en cada consulta, no la pantalla. Se probó cambiando identificadores en direcciones, filtros y funciones: nunca se obtuvo un dato de otro cliente.
- **Cerco de rutas.** Cualquier consulta de una cuenta del portal a tablas de central responde «prohibido». La base comprueba en cada petición que el cerco está activo. Si no lo está, bloquea el registro y la vinculación de cuentas, y un script de verificación lo detecta después de cada despliegue.
- **Código separado.** La aplicación del portal no incluye código de central, y una prueba lo vigila.
- **Permisos mínimos.** Solo cuatro funciones del portal se pueden usar sin iniciar sesión, y cada una tiene su razón: la revisión de cada petición, el diagnóstico del cerco, la regla del cerco y el texto legal del registro.
- **Registro protegido.** El registro, la recuperación y el reenvío llevan captcha (Cloudflare Turnstile) y límites por IP y por correo. Si falta la configuración, se cierran.
- **Bitácora que no se puede editar** de accesos, cargas, emisiones y cambios.

## Certificados

- **Validación antes de guardar.** La contraseña debe abrir la llave, la llave debe corresponder al certificado, debe ser un CSD (no una e.firma), el RFC debe ser el del cliente y debe estar vigente. Si algo falla, no se guarda nada.
- **Autorización previa.** Para recibirlo: aviso de privacidad aceptado (y contrato de uso en básico) o, desde central, una carta de instrucción vigente.
- **Cifrado siempre.** Se guarda cifrado con secretos que viven fuera de la base, y nunca se vuelve a mostrar ni descargar. Una prueba busca el contenido en claro en la base, los archivos, los registros y las respuestas, y no lo encuentra.
- El portal nunca pide ni guarda la e.firma ni la CIEC.

## Qué pasa al darse de baja

**Se elimina siempre y de inmediato:**

- el acceso de la persona: usuario, contraseña, sesiones, enlaces e invitaciones pendientes;
- el CSD, la llave y la contraseña de la empresa que queda dada de baja, con la emisión apagada;
- sus mensajes, adjuntos, tickets sin facturar y documentos publicados;
- sus datos de contacto.

**Se resguarda:**

- facturas emitidas y recibidas, tickets ya facturados con su factura, y las constancias de aceptación de los textos legales, con la identidad seudonimizada;
- el plazo es de **cinco años**, o **diez** si se elige. En básico elige la titular al darse de baja; en premier lo fija Kawiil por cliente, a solicitud del cliente;
- al vencer, una tarea diaria elimina lo resguardado.

**Casos especiales:**

- Si una empresa básica se queda sin personas activas, se trata como dada de baja, con resguardo de cinco años.
- Si queda otra persona activa, no se destruye nada.
- La única administradora de un cliente premier no puede darse de baja sin designar a otra.
- La baja de un cliente premier (fin del servicio) se hace desde central, solo por G3 o G4, con doble confirmación: escribir «DAR DE BAJA» y el RFC.

**Verificación.** Después de cada baja, el sistema comprueba que no quedan certificados, contraseñas, accesos ni adjuntos, y lo registra.

La política completa está en `docs/portal/CONSERVACION.md`.

## Cómo se probó

- **Base de datos:** 217 verificaciones en base vacía, en base con datos previos, con rollback total y parcial, y aplicando dos veces. Los datos previos quedan idénticos.
- **Por HTTP, con el servidor real de la API:**
  - aislamiento entre clientes (58 pruebas);
  - el equipo trabaja igual que sin el portal (29 pruebas);
  - el cerco y su caso negativo;
  - la búsqueda de contenido en claro.
- **Funciones abiertas:** las que no verifican la sesión en la puerta rechazan sin credencial.
- **Pruebas unitarias:** 338.
- Todo corre en CI (`Pruebas del portal del cliente`), con datos sintéticos.

## Notas para quien revise

- **Migraciones renumeradas.** Van de 20260929110000 a 20260929120700 porque `main` agregó una migración con la misma versión que la primera del portal. Ninguna se había aplicado en ningún entorno.
- **Relación con backup-data.** Es un PR aparte y urgente (Lbassoco95/kawiil-central#329). Cuando llegue a `main`, la prueba de funciones abiertas de este PR la incluye sola.
- **Hallazgos previos, fuera del portal:**
  - 12 migraciones de `main` ya fallan en una base vacía (tablas creadas fuera del repositorio y una extensión).
  - Si se prende el registro público de Supabase, cualquier alta sin la marca del portal recibiría un rol del equipo.
  - Las rutas directas de Supabase para recuperar contraseña y reenviar confirmación no pasan por el captcha. Ponerles captcha afecta también el inicio de sesión de central.

## Pasos de Polo antes de fusionar

- [ ] Ensayo en una rama de Supabase (`RUNBOOK.md` §4), con una baja básica eligiendo diez años y una baja premier, y validación de la distinción CSD / e.firma con muestras de prueba.
- [ ] Alta de Turnstile y de los tres secretos distintos.
- [ ] Confirmación de que el registro público de Supabase está apagado.
- [ ] `npm run portal:verificar-cerco` después del despliegue.
- [ ] Textos legales de la pantalla de baja.
- [ ] Pendientes de `CONSERVACION.md` §9.
- [ ] Custodia de los secretos y suplente (`RUNBOOK.md` §8).
