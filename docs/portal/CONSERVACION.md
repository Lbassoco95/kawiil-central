# Política de conservación y eliminación de datos del portal del cliente

**Estado:** propuesta técnica. Todo valor marcado *pendiente de confirmación de Polo* lo decide el Oficial de Cumplimiento de Kawiil. El sistema ya aplica estos valores como parámetros modificables; confirmarlos o cambiarlos no requiere programar.

**Marco:** Ley Federal de Protección de Datos Personales en Posesión de los Particulares (derechos de cancelación y oposición) y obligación de conservar la contabilidad y sus comprobantes fiscales por el plazo que marcan las disposiciones fiscales (Código Fiscal de la Federación, art. 30). El plazo concreto aplicable a cada caso lo confirma Polo.

## 1. A quién aplica

A la **persona** que tiene una cuenta en el portal y pide eliminarla. Se distinguen tres situaciones:

| Situación | Ejemplo |
|---|---|
| **Cliente de nivel básico creado por la persona**, sin otras personas activas | Un emprendedor que se registró desde la tienda y activó el nivel básico. |
| **Persona de un cliente de Kawiil (premier)** | La contadora de una empresa cliente con acceso al portal. |
| **Única administradora de un cliente premier** | La eliminación **se detiene**: la persona debe designar a otra administradora o comunicarse con Kawiil. |

## 2. Qué pasa con cada dato

| Dato | Qué pasa al eliminar la cuenta | Motivo |
|---|---|---|
| Acceso y perfil de la persona (nombre, correo, contraseña) | **Se elimina.** Se cierra la sesión en todos los dispositivos. | Ya no hay finalidad para tratarlos. |
| Certificado de sello digital (CSD), llave privada y su contraseña de un cliente de nivel básico creado por la persona | **Se destruyen de inmediato**, siempre, y se apaga la emisión de facturas. | Son credenciales para facturar a nombre de la persona; Kawiil no debe conservarlas sin relación vigente. |
| CSD de un cliente premier | **No se toca.** Solo se retira el acceso de la persona. | Pertenece a la empresa, no a la persona. |
| Mensajes y archivos adjuntos del nivel básico | **Se eliminan.** | Sin finalidad posterior. |
| Mensajes que la persona escribió en conversaciones de un cliente premier | Se conservan con la empresa; el nombre de la autora se sustituye por «Usuario eliminado». | La conversación es de la empresa con Kawiil. |
| Tickets aún no facturados | **Se eliminan** (foto y datos). | Sin comprobante fiscal que conservar. |
| Facturas (CFDI) emitidas o recibidas y tickets ya facturados | **Se conservan** por el plazo de conservación fiscal: **cinco años** — *propuesta, pendiente de confirmación de Polo*. Al vencer, una tarea programada diaria los purga, archivos incluidos. | Obligación de conservar comprobantes fiscales. |
| Bitácora de actividad | Se conservan **los hechos** (qué ocurrió, cuándo, sobre qué empresa). El nombre, el correo y el identificador de la persona se sustituyen por un **seudónimo** irreversible. | La bitácora es evidencia de cumplimiento; los datos personales no son necesarios para ella. |
| Constancia de aceptación del aviso de privacidad, términos y contrato de uso | Se conserva la versión y la fecha; la identidad se seudonimiza. *Pendiente de confirmación de Polo* (podría requerirse identidad plena por el plazo de prescripción). | Evidencia del consentimiento otorgado. |
| Registro de la solicitud de eliminación | Se guarda fecha, alcance y resultado, sin identificar a la persona. | Rendición de cuentas. |

## 3. Cómo se informa a la persona

Antes de confirmar, la pantalla de «Cuenta» muestra **exactamente** qué se eliminará y qué se conservará, con cantidades y fechas, calculadas en ese momento a partir de sus datos reales y de esta política. Los textos introductorios de esa pantalla son **marcadores** que Polo sustituye; el desglose no es texto fijo.

## 4. La bitácora no se puede editar

La bitácora sigue sin poder modificarse ni borrarse, ni siquiera por el administrador técnico. La única excepción es un procedimiento controlado que **solo** puede reemplazar datos personales por seudónimos, dentro de la eliminación de una cuenta; el sistema verifica, registro por registro, que el hecho no cambie. Cada vez que se usa, queda su propio registro en la bitácora.

## 5. Parámetros (modificables sin programar)

| Parámetro | Valor | Estado |
|---|---|---|
| Plazo de conservación de CFDI y tickets facturados del nivel básico | 5 años | *Pendiente de confirmación de Polo* |
| Purga automática al vencer el plazo | Activada | *Pendiente de confirmación de Polo* |

## 6. Decisiones que toma Polo

1. Confirmar o ajustar el plazo de conservación fiscal.
2. Confirmar si las constancias de aceptación se conservan seudonimizadas o con identidad plena.
3. Redactar los textos de la pantalla de eliminación (hoy marcadores).
4. Definir qué pasa con el registro del cliente de nivel básico (ficha de prospecto en el CRM) cuando termina el plazo: hoy se conserva la ficha y se purgan sus datos fiscales.
