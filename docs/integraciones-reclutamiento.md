# Integraciones del Módulo de Reclutamiento — qué necesitamos (para CTO)

Documento de apoyo para decidir qué integraciones externas conectar, qué
datos requerimos de cada una y qué accesos/credenciales hace falta gestionar.
Estado a junio 2026.

---

## 0. ¿Qué es "Tally / examen"? (lo que ya quedó en la ficha)
En la ficha del candidato hay un campo **"Liga de examen / psicométrico"**.
Es simplemente un **enlace** (URL) que pegas ahí y se abre con un clic. Sirve
como **solución fase 0, sin integración ni costo**:

- **Tally** (tally.so) es un creador de formularios **gratuito**. Armas un
  formulario (examen técnico, preguntas tipo Cleaver/DISC adaptadas, Excel,
  etc.), le pasas el link al candidato, y sus respuestas te llegan por correo
  o las exportas. Tú pegas en Kawiil el **link del formulario/resultado**.
- Igual aplica para **TypeForm**, Google Forms o un **PDF**.

> O sea: hoy ya puedes operar el examen/psicométrico **manualmente** con un
> formulario gratuito. Lo que NO hace todavía es traer el **resultado/score
> automáticamente** a la tarjeta — eso requiere una integración real (abajo).

---

## 1. Captación (bolsas de trabajo y redes)
Lo que **queremos** de estas fuentes: dar de alta candidatos en el pipeline de
forma automática, con estos datos:

| Dato | Uso en Kawiil |
|---|---|
| Nombre, correo, teléfono | Alta del candidato |
| CV (archivo o URL) | Adjuntar al expediente del candidato |
| Canal de origen | Métrica "por canal" del panel CHRO |
| Puesto/vacante al que aplicó | Vincular a la vacante |
| Fecha de postulación | Antigüedad / SLA 48 h |
| Link al perfil (LinkedIn) | Referencia del reclutador |

### Realidad de cada fuente (importante para no asumir de más)
| Fuente | ¿API pública para empleadores? | Qué haría falta | Factibilidad |
|---|---|---|---|
| **Computrabajo** | No abierta de forma general. La cuenta básica manda los datos por **correo** (a veces censurado). | Confirmar con su ejecutivo de ventas si dan API/feed en plan pagado; si no, **parsear el correo** de aviso de postulación. | 🟡 Media (probable vía correo, no API) |
| **Indeed** | Restringida/por convenio (Indeed Apply / Disposition Sync API). Publicar vacantes sí (feed XML). | Aplicar como partner; credenciales de empleador; endpoint webhook nuestro. | 🟠 Difícil (gated por Indeed) |
| **LinkedIn** | Solo vía **Talent Solutions / Recruiter System Connect**, partner-gated y de pago alto. | Contrato LinkedIn, OAuth de aplicación aprobada. | 🔴 Poco viable para nuestro tamaño |
| **OCC Mundial** | Sin API pública conocida. | Igual que Computrabajo: correo/manual. | 🟡 Media |
| **Formulario propio** (Tally/Web) | N/A (lo controlamos nosotros) | Un webhook a Supabase. | 🟢 Inmediato |

### Recomendación de captación
1. **Fase 0 (ya):** captura manual + **importación CSV/Excel** (ya existe) del
   tracker. El canal de origen se registra a mano.
2. **Fase 1 (rápida):** **formulario propio de postulación** (Tally o web) con
   **webhook → Supabase** que crea el candidato automáticamente. Cero costo,
   100% bajo nuestro control. *(Esto sí lo podemos construir.)*
3. **Fase 2 (según convenga):** parsear el **correo de Computrabajo** para alta
   automática; evaluar Indeed solo si el volumen lo justifica. LinkedIn API
   queda descartada por costo/acceso.

---

## 2. Psicométrico / examen (resultado automático en la tarjeta)
| Proveedor | Pruebas | API | Costo aprox. | Qué necesitamos |
|---|---|---|---|---|
| **Evalart** (MX) | DISC/Cleaver, razonamiento, contable, Excel, servicio | **REST + webhook** documentada | ~$1,200–2,500 MXN/mes | Cuenta + **API key**; URL de webhook nuestra para recibir el resultado |
| **TestGorilla** | Big Five, técnicas contables, razonamiento | API + embebible | desde ~$399 USD/año | Cuenta + API key |
| **Tally / TypeForm** (fase 0) | Lo que armes (Cleaver adaptado, Excel) | Webhook simple / manual | **Gratis** | Solo el link (ya soportado) |

**Para traer el score automático a la tarjeta** (no solo el link), necesitamos del proveedor:
- **API key / token** de la cuenta de la empresa.
- **Webhook**: les damos una URL (edge function) y ellos nos mandan el resultado cuando el candidato termina la prueba.
- El **mapa de campos** del resultado (qué devuelve: dimensiones DISC, score, PDF).

---

## 3. Qué pedirle/decirle al CTO
Para cada integración que decidamos activar, se necesita:
1. **Credenciales**: API key/secret o acceso OAuth de la **cuenta de la empresa** en ese proveedor (no personal).
2. **Identificador de empleador** (employer/account id) donde aplique.
3. **Aprobación de partner** (Indeed/LinkedIn) — trámite con el proveedor, semanas.
4. **URL de webhook** (la generamos nosotros como edge function en Supabase) para recibir postulaciones/resultados.
5. **Presupuesto** del proveedor (Evalart/TestGorilla) y volumen estimado de candidatos/mes.

### Propuesta de priorización
- 🟢 **Ya**: examen/psicométrico con **liga (Tally)** + importación CSV. Operativo sin costo ni APIs.
- 🟢 **Construible pronto (interno)**: **formulario de postulación propio → webhook → alta automática** en el pipeline (incluye canal de origen).
- 🟡 **Evaluar**: **Evalart** (API + webhook) para score automático — requiere cuenta/API key y presupuesto.
- 🟠 **Solo si el volumen lo justifica**: Computrabajo (vía correo) e Indeed (partner).
- 🔴 **Descartado por costo/acceso**: LinkedIn API.

> Nota clave: el módulo **no depende** de estas APIs para operar — hoy ya funciona
> el ciclo completo (pipeline, comunicación, evaluación con rúbrica, panel CHRO,
> onboarding). Las integraciones **automatizan la captación y el psicométrico**,
> pero son aceleradores, no bloqueantes.
