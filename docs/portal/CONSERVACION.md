# Política de baja, resguardo y eliminación de datos del portal del cliente

**Estado:** criterios fijados por Polo como Oficial de Cumplimiento de Kawiil el 28 de septiembre de 2026: plazos de resguardo, qué se elimina siempre, cómo se resguarda y cómo se cifra. Solo lo marcado *pendiente de confirmación de Polo* sigue abierto. El sistema aplica estos criterios como parámetros; cambiarlos no requiere programar.

**Marco:** Ley Federal de Protección de Datos Personales en Posesión de los Particulares (derechos de cancelación y oposición; principios de finalidad y proporcionalidad) y obligación de conservar la contabilidad y sus comprobantes fiscales (Código Fiscal de la Federación, art. 30).

## 1. Qué se resguarda y por cuánto tiempo

| Plazo | Cuándo aplica |
|---|---|
| **Cinco años** | Valor por omisión, siempre que nadie elija otra cosa. |
| **Diez años** | Única alternativa, solo por elección expresa. No hay otros plazos. |

**Quién elige:**

- **Cliente del nivel básico:** la persona titular elige al darse de baja. La pantalla muestra las dos opciones con cinco años preseleccionado. Para cada una dice qué se resguarda, para qué y hasta qué fecha exacta.
- **Cliente de Kawiil (premier):** Kawiil fija el plazo por cliente, a solicitud del cliente. Son cinco años salvo que el cliente pida diez. Solo lo cambian las personas del equipo con nivel G3 o G4, y deben anotar el motivo.
- **Empresa básica que se queda sin personas activas** (ver §3): no hay quien elija, así que corren cinco años.

**Registro de la elección:** cada elección queda registrada con la fecha, quién la hizo y la fecha de fin del resguardo que resulta. Si la hizo la titular, se registra con su seudónimo. Si la hizo Kawiil, con la persona del equipo y el motivo. Ese registro no se puede modificar.

**Qué se resguarda:**

- Facturas (CFDI) emitidas y recibidas.
- Tickets ya facturados, con su factura.
- Constancias de aceptación del aviso de privacidad, de los términos y del contrato de uso, con la identidad **seudonimizada**.

**Para qué:** cumplir la obligación de conservar los comprobantes fiscales y la contabilidad, y acreditar el consentimiento otorgado.

**Lo que nunca entra al resguardo:** certificados, llaves, contraseñas, accesos ni mensajes.

**Al vencer el plazo:** una tarea programada diaria elimina lo resguardado, archivos incluidos. Cada resguardo vence en **su propia fecha**, la que resultó de su elección.

**Un plazo ya en curso no cambia** aunque se modifique el valor por omisión. Solo lo modifica una nueva elección expresa: en premier, un cambio de G3/G4 a solicitud del cliente, contado desde el inicio del resguardo.

**Si la empresa vuelve a tener una persona activa**, deja de estar dada de baja y su resguardo se cancela, porque la información vuelve a ser de un cliente en servicio. La tarea de purga comprueba esto antes de eliminar.

## 2. Qué se elimina siempre al darse de baja

Esto aplica cuando una persona se da de baja o cuando una empresa queda dada de baja (§3 y §4). Se elimina **de inmediato y sin excepción**:

| Dato | Detalle |
|---|---|
| Acceso de la persona | Usuario y contraseña de acceso, sesiones abiertas en todos sus dispositivos, tokens, enlaces de recuperación e invitaciones pendientes. |
| Certificados de la empresa dada de baja | Certificado de sello digital (CSD), llave privada y contraseña de la llave. La emisión de facturas queda apagada y revocada. |
| Datos de contacto que no se necesitan para el resguardo | Correo y nombre de la persona. En la empresa básica, además, su correo, teléfono, dirección y persona de contacto. La razón social y el RFC sí se resguardan porque son datos fiscales. |
| Mensajes y adjuntos | De la empresa dada de baja. |
| Tickets aún no facturados | Foto y datos capturados. |
| Documentos publicados en el portal | Se retiran del portal y se detiene su sincronización. El archivo propio de Kawiil no se toca. |

**No se conservan certificados ni contraseñas «por si acaso».** Una vez ejecutada la baja, no existen.

**Comprobación:** después de cada baja, el sistema busca en la base de datos y en el almacenamiento de archivos y registra el resultado en la solicitud. Debe confirmar que no queda ningún certificado de sello digital, ninguna contraseña de llave, ninguna cuenta ni sesión de acceso y ningún adjunto de la empresa dada de baja. También confirma que lo resguardado ya no identifica a ninguna persona.

## 3. Situaciones al darse de baja una persona

| Situación | Qué pasa |
|---|---|
| **Titular de una empresa básica sin nadie más con acceso** | La empresa se da de baja (§2). La titular elige cinco o diez años. |
| **Titular de una empresa básica donde solo quedan personas suspendidas** | La empresa se trata como dada de baja (§2), con resguardo de cinco años. Las personas suspendidas conservan su ficha, pero ya no hay certificados a los que acceder. Si se reactivan, deben cargar el CSD de nuevo, con toda la validación y la autorización previa de siempre. |
| **Empresa (básica o premier) donde queda al menos otra persona activa** | Solo se retira el acceso de quien se da de baja. **No se destruye nada**: la información, el CSD y las conversaciones son de la empresa, que sigue activa. En los mensajes que escribió, su nombre se sustituye por «Usuario eliminado». |
| **Única administradora de un cliente premier** | La baja **se detiene**. La persona debe designar a otra administradora o comunicarse con Kawiil. |

«Persona activa» significa que tiene su acceso a la empresa y su cuenta vigentes, sin suspensión.

Si el cierre del acceso falla después de procesar los datos, la solicitud queda registrada como fallida y la persona puede repetirla. El segundo intento ya no encuentra nada que destruir, aplica el mismo seudónimo y cierra el acceso.

## 4. Baja de un cliente premier (fin del servicio)

Kawiil la realiza desde central en una sola acción registrada:

- Solo pueden hacerla personas del equipo con nivel G3 o G4 de la organización del cliente.
- Antes de confirmar, la pantalla muestra qué se eliminará, qué personas pierden su acceso, qué se resguardará y con qué plazo y fecha de fin.
- Exige **doble confirmación**: escribir «DAR DE BAJA» y el RFC del cliente. El sistema vuelve a comprobar las dos confirmaciones y el nivel de quien la pide, y registra cada intento rechazado.
- Se eliminan los accesos de todas las personas del cliente y su CSD, llave y contraseña (§2). Quien además tenga acceso a otra empresa conserva su cuenta y pierde solo el acceso a esta.
- La solicitud y la ejecución quedan registradas, sin datos personales en la solicitud. Si el cierre de alguna cuenta falla, la solicitud queda como fallida y se puede reintentar desde la misma pantalla.

## 5. Cómo se guarda lo sensible mientras dure el servicio

- Los certificados, las llaves y las contraseñas de las llaves se guardan **siempre cifrados** del lado de Kawiil.
- Los secretos que descifran se guardan fuera de la base de datos, en la configuración de las funciones del servidor. La base guarda solo el **nombre** del secreto con que se cifró cada certificado, nunca su valor.
- La llave y el certificado usan un secreto. La contraseña de la llave usa otro. Los dos son distintos del que protege la e.firma.
- Nada sensible queda en claro en la base de datos, en el almacenamiento de archivos, en los registros del servidor, en la bitácora, en los mensajes de error ni en las respuestas del sistema. Las pruebas lo comprueban buscando el contenido de un certificado, una llave y una contraseña de prueba.
- Ninguna persona del portal ni del equipo puede leer las columnas cifradas, ni por la aplicación ni por consulta directa con sus permisos.
- **Respaldos:** la herramienta de respaldo del repositorio no incluye los certificados, las contraseñas ni la sal de los seudónimos.
- **Respaldos automáticos de Supabase:** durante su ventana de retención conservan también filas ya eliminadas, pero cifradas. Sin los secretos no sirven para nada.
- **Si se sospecha una filtración, o si se pierde un secreto:** ver el RUNBOOK (custodia y rotación). Un certificado que ya no se puede descifrar no se recupera: se pide al cliente que lo cargue otra vez.

## 6. La bitácora no se puede editar

La bitácora no se puede modificar ni borrar, ni siquiera por la administración técnica. La única excepción es un procedimiento controlado, dentro de una baja, que **solo** reemplaza datos personales por seudónimos. El sistema verifica, registro por registro, que el hecho no cambie. Cada vez que se usa, deja su propio registro en la bitácora. Cada destrucción de certificados y cada baja de empresa también quedan registradas (qué, cuándo, sobre qué empresa) sin datos personales.

## 7. Cómo se informa a la persona

Antes de confirmar, la pantalla de «Cuenta» muestra **exactamente** qué se eliminará y qué se resguardará, con cantidades y fechas. Todo se calcula en ese momento a partir de los datos reales y de esta política. Los textos introductorios son **marcadores** que Polo sustituye; el desglose no es texto fijo.

## 8. Parámetros

| Parámetro | Valor | Estado |
|---|---|---|
| Plazo de resguardo por omisión | 5 años | Fijado por Polo |
| Plazo alternativo | 10 años | Fijado por Polo |
| Purga automática al vencer el plazo | Activada | Fijado por Polo (el plazo «elimina lo resguardado») |

## 9. Pendiente de confirmación de Polo

1. Los textos de las pantallas de baja del portal y de central (hoy marcadores), incluido el que explica cuándo conviene elegir diez años.
2. Si las constancias de aceptación bastan seudonimizadas durante el resguardo o si se requiere identidad plena por el plazo de prescripción.
3. Qué pasa con la ficha del cliente básico en el CRM (razón social y RFC) cuando vence el resguardo. Hoy se conserva la ficha, sin datos de contacto, y se eliminan sus datos fiscales del portal.
4. En la baja de un cliente premier, qué hacer con los datos de contacto del cliente en el CRM de central y con la e.firma que usa Moffin. Esta política cubre el portal; esos datos son de la relación de servicio de Kawiil y de Moffin, y no se tocan.
