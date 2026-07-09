# Manual de funcionalidades — Kawiil OS (kawiil-central)

> Documento maestro para revisión con el CTO y base de las capacitaciones del equipo.
> Última actualización: 2026-07-09.

Kawiil OS es la plataforma interna del despacho: un sistema operativo de trabajo (SPA web) que reúne en un solo lugar la gestión de clientes, proyectos, tareas, contabilidad/SAT, finanzas, recursos humanos, ventas (pipeline), comunicación (Correo y Slack), conocimiento y un asistente de inteligencia artificial (Kawiil AI) que atraviesa todos los módulos.

- **Tecnología:** React + Vite + TypeScript (frontend) sobre backend **Supabase** (base de datos, autenticación, almacenamiento y ~90 *edge functions*). UI con shadcn-ui + Tailwind.
- **Acceso:** aplicación web (SPA). Se entra con correo y contraseña. No requiere instalación.
- **IA:** impulsada por Claude (Anthropic), con capacidad de leer y actuar sobre los datos de la plataforma.

---

## Índice

1. [Conceptos generales](#1-conceptos-generales)
   - 1.1 Roles y grados
   - 1.2 Permisos por módulo
   - 1.3 Navegación general
   - 1.4 Kawiil AI (transversal)
   - 1.5 Accesibilidad y apariencia
2. [Módulos — Trabajo](#2-modulos--trabajo)
   - Dashboard · Tareas · Proyectos · Calendario · Clientes
3. [Módulos — Operación](#3-modulos--operacion)
   - Pipeline · Recursos Humanos · Documentos · Finanzas
4. [Módulos — Comunicación](#4-modulos--comunicacion)
   - Correo · Slack · Notificaciones
5. [Módulos — Conocimiento](#5-modulos--conocimiento)
   - Asistente IA · Base de Conocimiento · Hub · Plantillas contables
6. [Módulos — Administración](#6-modulos--administracion)
   - Configuración / Admin · Autenticación y cuenta
7. [Integraciones externas](#7-integraciones-externas)
8. [Estado de verificación técnica](#8-estado-de-verificacion-tecnica)
9. [Guion sugerido para las capacitaciones](#9-guion-sugerido-para-las-capacitaciones)
10. [Checklist de revisión con el CTO](#10-checklist-de-revision-con-el-cto)

---

## 1. Conceptos generales

### 1.1 Roles y grados

Kawiil usa una nomenclatura propia de "grados" (`app_role` en la base de datos) que define las capacidades de cada persona:

| Grado | Rol práctico | Capacidades extra |
|-------|--------------|-------------------|
| **Transformador** | Administrador (G4) | Administra todo: usuarios, permisos, células, catálogos, integraciones; ve tableros de gestión (CHRO, equipo, rendimiento) |
| **Referente** | Líder / gerente | Puede eliminar tareas de equipos/proyectos y modificar fechas límite; ve vistas de equipo |
| **Ejecutor** | Colaborador estándar | Trabaja tareas, proyectos, clientes, su expediente y cuestionarios |
| **En formación** | Colaborador en onboarding | Acceso básico, en proceso de incorporación |

Además del grado existen **permisos finos** por persona: eliminar tareas, modificar fechas límite, y acceso a finanzas (solo gastos / gastos + ingresos Savio / crear cargos y pagos).

### 1.2 Permisos por módulo

Cada usuario ve **solo los módulos que el administrador le activó**. Los módulos con control de acceso son: Kawiil AI, Conocimiento, Finanzas, Calendario, Correo, Documentos, Hub, Administración, Pipeline y Reclutamiento. Si un usuario intenta entrar a un módulo que no tiene activado, el sistema lo redirige al inicio.

> **Regla mental:** *lo que ve cada persona = módulos activados por el admin + capacidades de su grado + interruptores finos (tareas / finanzas).*

### 1.3 Navegación general

- **Barra lateral izquierda** agrupada en cinco secciones: **Trabajo** (Dashboard, Tareas, Proyectos, Calendario, Clientes), **Operación** (Pipeline, Recursos Humanos, Documentos, Finanzas), **Comunicación** (Correo, Slack, Notificaciones), **Conocimiento** (Asistente IA, Conocimiento, Hub, Plantillas contables) y **Admin** (Configuración). Se puede colapsar; en móvil se abre como menú deslizable.
- **Insignias de no leídos** en Notificaciones, Correo y Slack.
- **Búsqueda global (⌘K / Ctrl+K):** paleta de comandos para saltar a clientes, tareas, documentos, vistas, pipeline y abrir el asistente.
- **Chat flotante de IA:** botón siempre disponible (esquina inferior derecha) con la misma IA que el Asistente; se oculta automáticamente cuando ya estás en la página del Asistente.

### 1.4 Kawiil AI (transversal)

La inteligencia artificial no es un módulo aislado: aparece en casi toda la plataforma con el sello "Kawiil AI".

- **Briefings** en Dashboard, Tareas, Proyectos y Clientes (resúmenes ejecutivos del día/semana/cartera).
- **Resúmenes y triage** en Correo, Slack y Calendario.
- **Generación de contenido:** descripciones de tareas, borradores de correo, plantillas, documentos de oficina (Word/Excel/PPT) y PDFs con plantilla Kawiil.
- **Análisis:** minutas → tareas, fit de candidatos, clasificación de gastos, insights de documentos, predicción de atrasos.
- **Acciones reales:** el Asistente IA puede crear/actualizar tareas, proyectos, recordatorios y consultar todos los datos de la plataforma.

### 1.5 Accesibilidad y apariencia

- **Tema** claro/oscuro.
- **Modo daltónico** con perfiles (Deuteranopía, Protanopía, Tritanopía) y vista previa.
- Preferencias guardadas por dispositivo.

---

## 2. Módulos — Trabajo

### Dashboard (Inicio)

**Para qué sirve:** pantalla de entrada con dos vistas conmutables — **Personal** (tu día) y **Equipo** (pulso del despacho) — con copiloto de IA.

**Vista Personal:**
- Hero de IA con saludo, "briefing del día" y "frase de hoy" personalizada.
- Check-in de **estado de ánimo** (mañana/tarde, escala 1–5).
- **Sugerencias proactivas** de IA (tips del día).
- Tarjeta **"Siguiente acción"** (tarea prioritaria) y fila de **KPIs personales** (tareas de hoy, vencidas, proyectos, clientes, cartera).
- Pestañas: **Resumen · Tareas · Clientes · Recordatorios · Mi semana · Rendimiento** (con coach de IA y gráficas).
- Widget de "Progreso del día" y botones "Arma mi día / Resumen semana / ¿Qué me bloquea?".

**Vista Equipo:**
- KPIs globales (clientes, proyectos, tareas, por vencer).
- Pestañas: **Resumen · Células · Equipo · Proyectos · Clientes · Mis Tareas · Rendimiento**. La de Equipo y Rendimiento son solo para admin/manager; muestran carga por persona y portafolio del miembro.

### Tareas

**Para qué sirve:** centro de trabajo con todo lo que tienes abierto (asignadas, delegadas, compartidas con tu célula) más los pasos de proyecto asignados a ti.

- **Briefing de IA** de tareas (qué atender primero) y franja de KPIs (En curso, Vencidas, Esta semana, Hoy).
- Buscar; filtrar por píldoras (Todas / Mías / Vencidas / Sin responsable); filtrar por célula; ordenar (Fecha / Prioridad / Responsable); alternar **En curso / Historial**.
- Tabla con prioridad, banderas (Crítico/Atención), cliente/proyecto, estado, responsable, célula y vencimiento.
- Sección **"Pasos de proyecto asignados a ti"** (contabilidad, anual, juicio, gestoría).
- **Crear tarea:** título, responsable, fecha (por defecto +3 días hábiles), prioridad, célula, **recurrencia**, y en "Más opciones": descripción (con **IA**), cliente, proyecto, colaboradores y enlaces de Dropbox.
- **Detalle de tarea:** cambiar estado, completar, editar fecha (con motivo obligatorio), **subtareas**, colaboradores, semáforo y motivo de atraso, **cronómetro** de tiempo, pestañas de **Comentarios** (menciones @, adjuntos), **Enlaces** (Dropbox) y **Archivos** (con detección de duplicados).

**Integraciones:** Kawiil AI, Dropbox, Microsoft 365 (bloquear tiempo en calendario), notificaciones/menciones.

### Proyectos

**Para qué sirve:** gestión de trabajos por cliente o internos (contabilidad, PLD/cumplimiento, softlanding, constitución, gestoría, juicios, consultorías). Cada proyecto agrupa tareas, documentos, tiempo, finanzas y paneles según su área.

**Listado:**
- Estadísticas (Activos, En tiempo, En riesgo, Críticos, Completados este mes) y hero de IA de la cartera.
- Acciones: **"Desde minuta"** (IA analiza una minuta y propone tareas), **"Nuevo juicio"**, **"Nuevo proyecto"**.
- Buscar, filtrar por estado/área, ordenar; tabla con progreso % por tareas.

**Crear proyecto:** modo **Rápido** (con obligaciones fiscales para contabilidad/softlanding y plantillas incl. de IA) o **Guiado (wizard de 4 pasos)**. Para Cumplimiento exige entidad regulada y lanza el generador de tareas de cumplimiento.

**Detalle de proyecto — pestañas dinámicas según el área:**
- **General, Tareas** (por fases, con eliminación masiva), **Bitácora** (Avance/Hito/Atraso/Bloqueo/Reunión/Nota), **Comentarios**, **Firmas** (Dropbox Sign).
- **Constitución** (socios, RNIE), **Gestoría** (fases del trámite), **Contabilidad** (pasos del periodo + **consultas SAT vía Moffin con FIEL/CIEC**), **Declaración Anual**, **Juicio** (expediente, etapas procesales, términos), **Cumplimiento/PLD** (entidad regulada, obligaciones).
- Tarjeta **predictor de atraso** (IA) y **reconciliar fases**.

**Integraciones:** Kawiil AI, Moffin+SAT, Dropbox y Dropbox Sign, plantillas.

### Calendario (Microsoft 365 / Google, multicuenta)

**Para qué sirve:** agenda unificada de eventos de Outlook + Google + tareas de Kawiil con vencimiento.

- **5 vistas:** Día, 3 Días, Semana, Mes y Agenda. Línea de "hora actual" en vivo y mini-calendario mensual.
- **Eventos:** crear (asunto, hora CDMX, invitados, ubicación, **reunión de Teams** automática, categorías), editar, **arrastrar para reprogramar**, eliminar, unirse a Teams, **crear tarea desde el evento**.
- **Tareas en el calendario:** mostrar/ocultar; mapa de calor de carga por día; panel "Hoy" y "Próximos vencimientos".
- **Multicuenta:** conectar/quitar Google (solo lectura); mostrar/ocultar calendarios y elegir su color; filtrar por categorías de Outlook.
- **IA:** tarjeta "Resumen semanal/del día" con Resumen, Highlights y **Conflictos** (traslapes), y acción sugerida → crear tarea.

**Integraciones:** Microsoft 365/Outlook/Teams, Google Calendar, tareas Kawiil.

### Clientes

**Para qué sirve:** cartera completa (personas morales, físicas y prospectos) conectada con Moffin, Savio y el SAT.

**Listado:**
- Estadísticas (Activos, Al corriente, Requieren atención, Onboarding, Ingresos del mes), hero de IA, **Exportar CSV** y **Nuevo cliente**.
- Agrupar por tipo o grupo empresarial; filtrar por responsable; insignias de vinculación **Savio**.

**Crear/editar:** razón social, tipo, RFC, contacto, estatus, responsable y colaboradores, grupo empresarial, paquete y servicios, tipo de nómina, carpeta Dropbox, notas y opción **"Crear también en Savio"**.

**Detalle de cliente — pestañas:**
- **General:** Health Score, resumen **SAT/Moffin** (Lista 69-B, historial), certificados **e.firma** (.cer/.key), carpeta Dropbox y notas.
- **Cumplimiento, Proyectos, Tareas, Documentos.**
- **Cobranza (Savio):** facturas y pagos en vivo (solo con acceso a ingresos).

**Integraciones:** Moffin+SAT, Savio, Dropbox, Kawiil AI.

---

## 3. Módulos — Operación

### Pipeline (CRM de ventas / leads)

**Para qué sirve:** embudo comercial (con foco en "Softlanding" para empresas que llegan a México), con automatización de correos/tareas e IA. **7 pestañas:**

- **Dashboard:** KPIs en vivo, alertas inteligentes (leads en riesgo, oportunidad del día), embudo de conversión, velocidad por etapa, ingresos proyectados, top leads.
- **Tablero (Kanban):** tarjetas por etapa con suma en MXN, **drag & drop** entre etapas, filtros (Calientes / En riesgo / Míos).
- **Lista:** tabla con filtros avanzados (prioridad, urgencia, requiere visa) y **exportar CSV**.
- **Ficha del lead:** insight de IA, editar datos, cambiar etapa/propietario, score manual, datos de Softlanding, **registrar actividad** (llamada/email/WhatsApp/reunión/nota/tarea), panel de correo (hilos, sincronizar con M365), y tarjeta **Savio** para crear cliente y cargo al cerrar.
- **Actividades:** tareas por Vencidas/Hoy/7 días; **"Redactar con IA"** seguimientos; **follow-up masivo con IA** para leads inactivos.
- **Secuencias:** cadencias de correo automatizadas por etapa disparadora, con métricas de apertura/respuesta.
- **Plantillas:** plantillas de correo reutilizables con variables, **generar con IA** y adjuntar PDF de Softlanding.
- **Ajustes:** webhook de **Meta (Lead Ads)**, **importar CSV**, reordenar etapas, activar automatizaciones de IA (enfriar, avanzar, subir score).

**Integraciones:** Microsoft 365 (correo), Kawiil AI, Meta Lead Ads, Savio, CSV.

### Recursos Humanos

**Para qué sirve:** portal integral de RH: jornada con geolocalización, expedientes, reclutamiento (ATS), cuestionarios (NOM-035/clima) y tablero de gestión (CHRO). El contenido depende del rol.

**Pestañas personales (todos):**
- **Mi jornada:** check-in eligiendo modalidad (Oficina/Home Office/Comisión) con geolocalización; contadores en vivo; comida, descansos, "en trayecto", terminar jornada; validación de geocerca; declarar salida pendiente.
- **Solicitudes:** ausencias con flujo de aprobación (incl. día de burnout autoaprobado, 2/año).
- **Mi expediente:** datos fiscales/personales, subir/reemplazar los 8 documentos, lista de bienvenida (onboarding).
- **Cuestionarios:** responder los abiertos (confidencial).

**Reclutamiento (reclutadores y G4):**
- Vacantes con fases/estados/rúbrica/plantillas/entrevistadores; tablero Kanban de candidatos con **drag & drop**; publicar vacante con **link público**.
- Ficha del candidato: Perfil, Evaluación (rúbrica 1–5), **Fit IA** (analiza CV/psicométrico vs Perfil Kawiil), Seguimiento (correos desde `rh@kawiil.mx`).
- **Contratar (G4):** crea cuenta `@kawiil.mx`, asigna grado/célula y siembra la bienvenida.

**Pestañas de gestión (solo G4):**
- **Tablero (CHRO):** KPIs, pendientes del equipo, recordatorios por correo, exportar a Excel.
- **Equipo:** presencia en vivo, aprobación de salidas, calendario de ausencias, tablero de asistencia.
- **Turnos:** asignar turnos y gestionar **oficinas/geocercas** (lat/lng + radio).
- **Expedientes:** verificar documentos, editar plantilla de bienvenida.
- **Resultados:** activar/editar cuestionarios y ver resultados **agregados** (nunca individuales).

**Portal público (`/postular/:token`):** página sin login donde el candidato ve la vacante y envía su postulación con CV (con honeypot anti-spam).

**Integraciones:** geolocalización, Slack ("en trayecto"), Microsoft 365, Resend, Kawiil AI (fit), XLSX, Supabase Storage.

### Documentos

**Para qué sirve:** explorador unificado que combina Dropbox en vivo, archivos subidos en Kawiil, organización por cliente/proyecto, búsqueda semántica con IA y firma electrónica. **5 vistas:**

- **Dropbox:** navegar la estructura real, buscar, abrir, crear/renombrar carpetas, **subir** (arrastrar, con .zip que se expande y resolución de duplicados).
- **Aplicación:** carpetas virtuales por **Cliente → Proyecto**.
- **Recientes** y **Favoritos.**
- **Buscar con IA:** lenguaje natural → documentos con score de relevancia y razón.
- **Acciones:** Nuevo documento (sube a Dropbox + respaldo local), **Insights con IA** (resumen, tipo, etiquetas), **Enviar a firma (Dropbox Sign)** con varios firmantes, vista previa.

**Integraciones:** Dropbox, Dropbox Sign, Kawiil AI, Supabase Storage.

### Finanzas

**Para qué sirve:** control financiero: solicitudes de gasto internas con aprobación, y (con acceso Savio) ingresos facturados en vivo y tableros de inteligencia. La vista depende del rol.

- **Gastos internos:** crear solicitud (categoría, monto/moneda, cliente/proyecto, comprobantes; **sugerir categoría con IA**); KPIs; **flujo de aprobación** (Solicitado → En revisión → Aprobado/Rechazado → Pagado).
- **Resumen:** alertas de flujo de caja y resumen ejecutivo (gastos + ingresos).
- **Ingresos facturados (Savio):** facturas y pagos en vivo, clientes, notificaciones (webhooks); alineación Kawiil↔Savio; **acciones de escritura** (registrar pago, nuevo cargo, nuevo cliente) con permiso.
- **Tableros:** periodos comparables, KPIs, márgenes, concentración de clientes, cobros vencidos con recordatorios, **"Briefing con Kawiil AI"** (con clientes anonimizados).

**Integraciones:** Savio (API en vivo + escritura), Kawiil AI, Supabase Storage.
*Nota:* la integración **Moffin/SAT** vive en Clientes/Proyectos/Admin, no en Finanzas (aquí los ingresos son vía Savio).

---

## 4. Módulos — Comunicación

### Correo (Outlook / Microsoft 365, con IA)

**Para qué sirve:** cliente de correo completo sobre el buzón de Outlook, con IA para clasificar, redactar, mejorar, sugerir asunto y traducir.

- **Navegación:** Bandeja, Destacados, y categorías automáticas (Clientes/SAT/Facturas/Interno), Enviados, Borradores; carpetas de Outlook y **etiquetas propias** de Kawiil.
- **Acciones:** filtros (sin leer/leídos/todos), buscar, sincronizar, lector seguro, **Responder/Reenviar/Mover/Etiquetar/Archivar/Eliminar/Crear tarea/Enviar a Slack**, atajos de teclado, adjuntos (incl. .zip), **crear regla**, firma de Outlook.
- **Redacción:** editor enriquecido, CC/BCC, autocompletado de destinatarios, **acuses**, **programar envío**, **plantillas contables** (ligadas a pasos de proyecto).
- **IA:** **triaje del inbox** (Necesita respuesta/Acción/Agenda/Esperando/Conocimiento), asistente de redacción (profesional/breve/formal, resumir hilos), mejorar borrador (más formal/corto/amigable), **sugerir asunto**, **traducir** (8 idiomas, tonos).

**Integraciones:** Microsoft 365/Outlook, Slack, Kawiil, Dropbox.

### Slack / Comunicación

**Para qué sirve:** cliente de Slack integrado (canales, DMs, hilos, reacciones, archivos) con panel de contexto Kawiil e IA por canal, sin salir de la plataforma.

- **Mensajería:** enviar con formato y **@menciones**, emojis, **adjuntar archivos**; responder en hilo; **reacciones**; guardar para más tarde; crear tarea desde el mensaje; borradores por canal; nuevo DM.
- **Organización:** destacar/reordenar/silenciar conversaciones, grupos personalizados, **estado en Slack** (presets), reautorizar permisos, marcado de leído bidireccional.
- **Paneles de productividad:** **Actividad** (Todo/Menciones/Hilos/DMs/Reacciones), **Más tarde** (guardados), **Archivos del canal** (con "Sync a Kawiil" y "Guardar en Dropbox").
- **IA del canal:** Resumen/Pendientes/Decisiones, triage automático, respuesta rápida por tono, crear tarea desde mensaje.

**Integraciones:** Slack, Kawiil (tareas, conocimiento, notificaciones), Dropbox.

### Notificaciones y Recordatorios

**Para qué sirve:** centro único de avisos con recordatorios personales y configuración de entrega.

- **Pestañas:** Menciones (Kawiil + Slack), Recordatorios, Actividad (equipo), Sistema (IA/agentes/push), Vencimientos (tareas y pasos contables).
- **Acciones:** CTAs contextuales por tipo, **respuesta rápida de Slack** desde la notificación, marcar leídas, navegar al recurso.
- **Recordatorios personales:** crear (título, fecha/hora, frecuencia: solo lista / resumen cada hora / aviso diario), completar/reabrir.
- **Configuración de entrega:** toasts en app, avisos del navegador, pitido, sonido de Slack, **Web Push** (pestaña cerrada), preferencias de Slack, y **resumen diario matutino** de IA.

**Integraciones:** Slack, Microsoft/tareas/finanzas/conocimiento, Web Push, agentes de IA.

---

## 5. Módulos — Conocimiento

### Asistente IA (`/asistente`) — "Kawiil AI"

**Para qué sirve:** espacio de trabajo completo de la IA: chat conversacional en español (Claude) que consulta y actúa sobre la plataforma, genera documentos, recuerda contexto y delega a agentes. Diseño de tres columnas (proyectos/chats · chat · conocimiento/artefactos).

- **Chat:** preguntas en lenguaje natural (respuestas en Markdown), adjuntar archivos/carpetas (indexa PDFs con progreso), panel de procesamiento en vivo, feedback por mensaje, prefills por URL (prompt/conversación/proyecto/**resumen de grupo de Slack**), sugerencias de arranque con datos reales.
- **Herramientas reales:** consultar/crear/actualizar tareas y comentarios, buscar clientes, listar/crear proyectos (incl. desde minuta) y sugerir plantillas, obtener Kawiilers y células, buscar en Hub, ver/crear recordatorios, búsqueda unificada y **semántica**, consultar **documentos extraídos** (CFDIs/declaraciones), buscar en chats anteriores, **memoria persistente** (personal `/memories/` y de equipo `/team/`).
- **Documentos/artefactos:** generar manuales, reportes, **Word/Excel/PowerPoint** y **PDFs con plantilla Kawiil**; visor lateral, editar, promover a memoria.
- **Proyectos de IA:** con instrucciones personalizadas, compartibles con el equipo; cada uno con su hilo y panel de conocimiento (Docs / Memoria / Artefactos).
- **Delegación a agentes:** enviar tareas a agentes especializados (`agent_registry`/`client_agents`) con contexto y documentos; tarjetas de seguimiento con reintento/continuación.

### Base de Conocimiento (`/conocimiento`)

**Para qué sirve:** dashboard de lo que el sistema está aprendiendo (de Dropbox, tareas y proyectos) y operación de los agentes de aprendizaje. **7 pestañas:**

- **Por Cliente / Por Proyecto / Por Célula:** conocimiento e insights acumulados.
- **Agentes:** operar **Archivista** (escanea Dropbox e indexa), **Integrador** (perfiles de conocimiento) y **Nutritor** (novedades/briefings); ejecutar individualmente o "Ejecutar todos"; historial de sincronización, progreso y feed de novedades.
- **Estadísticas:** embeddings/fragmentos por fuente, cobertura por cliente/área.
- **Sugerencias:** mejoras generadas por IA con cambio de estado.
- **SAT:** cobertura fiscal vía Moffin (con/sin CIEC, CSF y 32D del mes, % de cobertura) y solicitud de consulta.

### Hub (`/hub`)

**Para qué sirve:** repositorio interno de manuales, procedimientos y comunicados, más directorio de equipo y RH.

- **Procedimientos:** consultar; admin/manager suben y eliminan. Detalle con **Vista previa**, **Versiones** (historial + subir nueva versión) y **Comentarios**.
- **Comunicados:** avisos internos (fijables) publicados por admin/manager.
- **Mi biblioteca:** buscador de procedimientos.
- **Equipo:** directorio con perfiles públicos (lo que cada quien eligió compartir).
- **Recursos Humanos:** panel de RH embebido.
- **Admin:** conteos y atajos (solo admin/manager).

### Plantillas contables (`/contabilidad/plantillas`)

**Para qué sirve:** administrar las plantillas de correo del área contable (ISN/IMSS, provisionales, etc.) que aparecen en el compositor de correo.

- Crear/editar (nombre, categoría, asunto, cuerpo con editor enriquecido).
- Panel de **variables por categoría** (`{{razon_social}}`, `{{monto_isn}}`…), con negritas automáticas, modos (pago/favor/pérdida) y líneas condicionales.
- Listado en tarjetas; editar y desactivar.

---

## 6. Módulos — Administración

### Configuración / Admin (`/configuracion`)

**Para qué sirve:** centro de administración de la organización. Pestañas (Integraciones solo para Transformadores):

- **Kawiilers (Usuarios):** lista con grado y estado de onboarding; **sincronizar fotos** desde M365; **agregar** (invitar por email o crear con contraseña); por usuario: editar, cambiar correo, reenviar invitación, enviar recuperación, desactivar/reactivar. **Editar usuario:** grado, células, **módulos activos**, permisos de tareas y de finanzas.
- **Células:** crear/editar (nombre, slug, color, responsable); aprobador de ausencias por defecto.
- **Catálogos:** tipos de documento, etiquetas y obligaciones fiscales.
- **Adopción:** usuarios activos (7 días) y uso por sección (30 días).
- **Integraciones:** estado de **Moffin (SAT)**, hosts de API, webhook, notas de credenciales.
- **Apariencia:** tema y accesibilidad.

### Autenticación y cuenta

- **Login (`/login`):** correo + contraseña, con mensajes de error contextualizados en español.
- **Cambiar contraseña (`/cambiar-contrasena`):** flujos de activación de enlace, recuperación y sesión directa; marca onboarding y `must_change_password`.
- **Accesibilidad (`/accesibilidad`):** tema, modo daltónico.

---

## 7. Integraciones externas

| Integración | Uso en Kawiil |
|-------------|---------------|
| **Microsoft 365** | Correo (Outlook), Calendario, Teams, contactos, fotos de perfil, envío programado |
| **Google** | Google Calendar (multicuenta, solo lectura) |
| **Slack** | Mensajería completa, resúmenes IA, compartir correos, estado/presencia, "en trayecto" |
| **Dropbox** | Navegación y almacenamiento de archivos por cliente/proyecto |
| **Dropbox Sign** | Firma electrónica de documentos y contratos |
| **Moffin (SAT)** | Consultas fiscales: e.firma/FIEL, CIEC, CSF, 32D, Lista 69-B, CFDIs |
| **Savio** | Facturación, cobranza (CXC), alta de clientes y cargos |
| **Meta Lead Ads** | Captura automática de leads de Facebook/Instagram (webhook) |
| **Resend** | Correos de reclutamiento (`rh@kawiil.mx`) |
| **Web Push (VAPID)** | Notificaciones con la pestaña cerrada |
| **Claude (Anthropic)** | Motor de toda la IA (Kawiil AI) |

El backend cuenta con ~90 *edge functions* de Supabase que orquestan estas integraciones (autenticación OAuth, sincronización de correos, procesamiento de documentos, embeddings, notificaciones, webhooks, etc.).

---

## 8. Estado de verificación técnica

Verificación realizada el 2026-07-09 sobre la rama de trabajo:

| Comprobación | Resultado | Nota |
|--------------|-----------|------|
| **Build de producción** (`bun run build`) | ✅ **Compila limpio** | 4 597 módulos transformados, sin errores. Advertencias menores de tamaño de chunk (esperadas en una app de este tamaño). |
| **Lint** (`bun run lint`) | ⚠️ **Errores conocidos** | Errores pre-existentes de `@typescript-eslint/no-explicit-any` y `react-hooks/exhaustive-deps`, documentados en `AGENTS.md` como esperados. No rompen la aplicación. |
| **Pruebas unitarias** (`bun run test`) | ⛔ **No ejecutables en este entorno** | Vitest usa `jsdom`, que requiere el binario nativo `canvas` (cairo/pango); no se pudo compilar en el sandbox. Es una limitación del entorno, **no un defecto del código**. Deben correrse en un entorno con las librerías del sistema instaladas. |

**Observaciones para el CTO:**
- La aplicación **compila y empaqueta correctamente**, lo que confirma que no hay errores de tipo ni de importación en todo el árbol de código.
- La verificación funcional pantalla-por-pantalla requiere un **usuario de prueba real** en el proyecto Supabase (`qppfampapbxdgednkofc`), ya que casi todo depende de datos y sesiones autenticadas. Se recomienda hacer un recorrido guiado con una cuenta demo antes de las capacitaciones.
- Se detectó una carpeta de componentes alternativa (`src/components/tareas/`: Kanban, Timeline, SmartGroups) que **no está referenciada** por la página de Tareas actual (usa una vista de tabla propia). Conviene confirmar si son vistas futuras/legadas y limpiarlas o integrarlas.
- El *bundle* principal es grande (~4.6 MB / 1.27 MB gzip); a futuro conviene *code-splitting* para mejorar el tiempo de carga inicial.

---

## 9. Guion sugerido para las capacitaciones

Propuesta de sesiones por audiencia. Cada sesión ~45–60 min con demo en vivo.

### Sesión 0 — Inducción (todo el equipo)
1. Qué es Kawiil OS y cómo entrar (login, cambio de contraseña).
2. Navegación: barra lateral, búsqueda ⌘K, chat flotante de IA, tema/accesibilidad.
3. Roles/grados y por qué cada quien ve cosas distintas.
4. Dashboard personal: briefing, ánimo, "arma mi día".

### Sesión 1 — Trabajo diario (todos)
1. **Tareas:** crear, filtrar, detalle (subtareas, cronómetro, comentarios, archivos).
2. **Proyectos:** listado, crear proyecto, detalle por área.
3. **Calendario:** vistas, crear evento con Teams, tareas en el calendario.
4. **Notificaciones y recordatorios.**

### Sesión 2 — Clientes y contabilidad/SAT (contabilidad y operación)
1. **Clientes:** ficha, Health Score, e.firma, cobranza Savio.
2. **Proyectos de contabilidad:** pasos del periodo, consultas SAT (Moffin/CIEC/FIEL).
3. **Plantillas contables** y su uso desde el Correo.
4. **Conocimiento → SAT:** cobertura fiscal.

### Sesión 3 — Comunicación (todos)
1. **Correo:** triaje IA, redacción con IA, traducir, plantillas, enviar a Slack.
2. **Slack:** mensajería, hilos, actividad, "más tarde", IA del canal.

### Sesión 4 — Ventas (equipo comercial)
1. **Pipeline:** tablero, ficha de lead, actividades, secuencias, plantillas, ajustes (Meta, CSV, automatizaciones).
2. Cierre → Savio.

### Sesión 5 — RH / People (G4 y colaboradores)
1. **Colaborador:** jornada, solicitudes, expediente, cuestionarios.
2. **G4:** reclutamiento (ATS + Fit IA), tablero CHRO, equipo, turnos/geocercas, resultados.
> Apoyo: `docs/guia-rh.md`, `docs/guia-rh-colaborador.md`, `docs/guia-rh-g4.md`.

### Sesión 6 — Inteligencia artificial (todos, con avanzado para power-users)
1. **Asistente IA:** chat, herramientas, generación de documentos, proyectos de IA, memoria, delegación a agentes.
2. **Base de Conocimiento:** agentes Archivista/Integrador/Nutritor.
3. **Documentos:** búsqueda con IA, insights, firma electrónica.

### Sesión 7 — Administración (solo Transformadores)
1. **Configuración:** usuarios, permisos por módulo, células, catálogos, integraciones, adopción.
2. **Finanzas:** aprobación de gastos, tableros, briefing financiero.

---

## 10. Checklist de revisión con el CTO

- [ ] Confirmar que la lista de módulos y permisos refleja la operación real del despacho.
- [ ] Validar la matriz de roles/grados y los interruptores finos (tareas/finanzas).
- [ ] Revisar el estado de cada integración externa (credenciales, cuentas conectadas): Microsoft 365, Google, Slack, Dropbox/Sign, Moffin/SAT, Savio, Meta.
- [ ] Definir qué integraciones están 100% productivas vs. en configuración (p. ej. Google Calendar requiere credenciales; IMAP/SMTP está pendiente — ver `docs/multi-cuenta-calendario-correo.md`).
- [ ] Acordar el plan de capacitaciones (sesiones, audiencias, calendario).
- [ ] Preparar una **cuenta demo** con datos de ejemplo para las demos en vivo.
- [ ] Decidir sobre los pendientes técnicos: componentes `tareas/` sin usar, code-splitting del bundle, ejecución de pruebas en CI con `canvas`.
- [ ] Validar la NOM-035 sembrada contra el DOF antes de aplicarla formalmente (ver `docs/guia-rh.md`).

---

### Documentos relacionados en el repositorio
- `docs/guia-rh.md`, `docs/guia-rh-colaborador.md`, `docs/guia-rh-g4.md` — guías de RH por rol.
- `docs/integraciones-reclutamiento.md`, `docs/informe-reclutamiento.md` — reclutamiento.
- `docs/multi-cuenta-calendario-correo.md` — arquitectura multicuenta de calendario/correo.
- `docs/slack-archivos-comunicacion.md`, `docs/slack-comunicacion-diagnostico.md` — Slack.
- `docs/supabase-ia-colaboracion-y-adjuntos.md` — IA colaborativa y adjuntos.
- `docs/compliance/` — cumplimiento/PLD.
