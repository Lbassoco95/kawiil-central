# Kawiil Central — Design system (fase 1, glass + minimal)

Fuente de verdad para UI en Dashboard, Clientes, Proyectos, Tareas y Pipeline (solo presentación). No sustituye lógica ni rutas.

## Principios

- **Minimal**: pocas sombras, poco movimiento vertical en hover; jerarquía por tipografía y espacio (múltiplos de 4px).
- **Glass moderado**: `backdrop-blur` y bordes suaves en **cabeceras de página**, **barras de filtros**, **tabs** y **contenedores de herramientas**. Listas densas y tarjetas Kanban mantienen fondo más opaco para legibilidad.
- **No glass**: celdas de tabla muy compactas, texto largo sobre fondo muy variable.

## Pantallas alineadas (fase 2)

Dashboard, Clientes, Proyectos, Tareas, Pipeline; además **Calendario** (`Microsoft365Calendario`), **Correo** (`Microsoft365Correo`), **Slack** (`Comunicacion`, `SlackChannelHeader`, `SlackConnectHero`, `SlackWorkspaceLayout`), **Notificaciones**, **Finanzas** (`Finanzas`, `SavioFinanceDashboard`).

## Pantallas alineadas (fase v2.4)

Actualizadas al estilo "Kawiil OS v2.4" con superficies AI en azul Kawiil unificado:

- **Dashboard** (`Dashboard.tsx`, `AiHeroGrid`, `DashboardOverview`, `TeamDashboard`, `AISummaryCard`) — hero `iconAccent={KAWIIL_AI_GRADIENT}`, badge "v2.4" en `actions`, chip "KAWIIL AI · v2.4" en el briefing, burbuja `Sparkles` con gradiente azul. **`AISummaryCard` v2.4**: ahora se renderiza como tarjeta cerrada con header `KAWIIL_AI_HEADER_BG`, icono `Sparkles` en gradiente, badge "v2.4", subtítulo "Analizado con tus datos en vivo", botón refresh en el header y CTA "Generar resumen" con gradiente azul. Como `AISummaryCard` se usa en Personal/Team Dashboard, AccountingDashboard, TasksAIPanorama y ProjectGeneralTab, este cambio homologa todos los resúmenes IA del producto. **Stat cards v2.4**: `DashboardOverview` y `TeamDashboard` repaletean tonos a `sky/emerald/amber/rose` (con icon-bubble redonda) y el overlay sutil del card pasa a `from-sky-500 to-indigo-500`.
- **Hub** (`Hub.tsx`) — hero con icono en gradiente azul, badge "v2.4", dialogs (Subir procedimiento / Nuevo comunicado) con **header azul Kawiil** (icono blanco sobre `KAWIIL_AI_HEADER_BG`) y CTA primario con gradiente azul.
- **Base de Conocimiento** (`BaseConocimiento.tsx`, `KnowledgeKawiilCard`) — hero v2.4 con `iconAccent={KAWIIL_AI_GRADIENT}` + badge "v2.4". Debajo del hero, tarjeta **"KAWIIL AI · Conocimiento"** (`KnowledgeKawiilCard`) con header azul, badge "v2.4", subtítulo "Qué está aprendiendo Kawiil y qué te conviene revisar después", mensaje contextual según el tab activo (clientes/proyectos/células/agentes/estadísticas/sugerencias), CTA "siguiente vista sugerida" en el header y chips inferiores para saltar entre tabs (chip activo en azul Kawiil).
- **Configuración / Admin** (`Admin.tsx`, `AdminKawiilCard`) — hero v2.4 con `iconAccent={KAWIIL_AI_GRADIENT}` + badge "v2.4". Debajo, tarjeta **"KAWIIL AI · Configuración"** (`AdminKawiilCard`) con header azul, badge "v2.4", CTA "N pendientes" cuando hay invitaciones sin aceptar (gradiente azul), banda de **mini-stats** sobre `KAWIIL_AI_SOFT_BG` (Kawiilers activos, por aceptar invitación, células, adopción) — clicables para saltar a su tab — y chips inferiores con todos los tabs (incluyendo Microsoft 365 como acceso rápido a `/microsoft365`). El subpanel **Apariencia** ahora se renderiza dentro de un card v2.4 con header azul (`KAWIIL_AI_HEADER_BG` + ícono `Palette` blanco) y un toggle Tema (Claro/Oscuro) tipo segmented control redondeado en lugar del bloque `surface-toolbar` plano. El subpanel **Integraciones** estrena el mismo header azul (ícono `Plug`) con copy explicativo y `MoffinIntegrationCard` debajo.
- **Asistente IA / Kawiil AI** (`AsistenteIA.tsx`) — el módulo se rediseñó manteniendo intacta la lógica/back (`useChat`, `useAiProjects`, `useAiArtifacts`, `index-dropbox`, `process-document`, etc.). Cambios visuales v2.4:
  - **Header del chat** ahora usa `KAWIIL_AI_HEADER_BG` (sustituye el `surface-toolbar` neutro): toggle sidebar, ícono Kawiil en gradiente azul (`Sparkles` o `BrainCircuit` según haya proyecto), título "Kawiil AI" con badge **v2.4**, chip de proyecto activo / "Asistente interno" y botón de Conocimiento con estilo blue-on-soft.
  - **Burbujas de usuario** pasan de `bg-primary` a `KAWIIL_AI_GRADIENT` con sombra azul; las del asistente conservan `bg-secondary/40` con borde sutil.
  - **Input area** estrena tint suave `KAWIIL_AI_SOFT_BG`, textarea con borde sky-200 y focus ring sky-400, botón Send con sombra `shadow-sky-500/30`.
  - **Banner indexación PDF** (`pdfIndexingStatus`) repaletizado a sky-50/sky-600 (antes `primary/5`).
  - **Dialog "Nuevo Proyecto IA"** usa header azul Kawiil (`BrainCircuit` blanco sobre `KAWIIL_AI_HEADER_BG`) con badge "v2.4" y CTA primario en gradiente; mismas labels y handlers que antes.
  - Constante local `KAWIIL_AI_GRADIENT` eliminada — ahora consume los tokens canónicos de `src/lib/kawiilAi.ts` para mantener consistencia con el resto de superficies AI.
- **Correo** (`EmailView`, `EmailKawiilCard`, `ComposeEmailDialog`, `CreateTaskFromEmailDialog`, `SendEmailToSlackDialog`) — resumen AI, enviar a Slack, crear tarea con prefill AI, todos con header azul y botones "Mejorar con AI". **Redacción de correos nuevos v2.4**: header con badge "v2.4" + subtítulo dinámico (asunto o "N destinatarios · sin asunto"); botón **"Asistente"** en el header que toggle el panel IA; botón **"Sugerir asunto"** junto al input de asunto que usa `ai-email-draft` para generar un asunto breve; **plantillas rápidas Kawiil** ("Confirmar reunión", "Pedir información", "Enviar reporte semanal", "Seguimiento de pago") visibles tanto en el panel IA como como pills bajo el editor cuando el cuerpo está vacío.
- **Tableros financieros / FinanceIntelligenceBoards v2.4** (`FinanceIntelligenceBoards`) — banner header **KAWIIL AI** con `KAWIIL_AI_HEADER_BG` (icono `BarChart3` en gradiente Kawiil + título "Tableros financieros · KAWIIL AI" + badge `v2.4` + subtitulo dinámico con periodo y comparación) y CTA **"Briefing con Kawiil AI"** (gradiente Kawiil) que lanza `invokeAiFinanceInsights`. Debajo, fila de **mini-stats** (`MiniHeaderStat`) sobre `KAWIIL_AI_SOFT_BG` con accent vertical de color por métrica: Cobrado (sky), Gastos (rose), Facturado (indigo), Cartera (sky-700). Paleta unificada de **gráficos Recharts** vía constante `FINANCE_CHART_COLORS` (cobrado `#0ea5e9`, facturado `#6366f1`, gastos `#f43f5e`); reemplaza los teal/violet anteriores. Los `Kpi` tiles ahora llevan barra lateral de gradiente Kawiil. Se eliminó el botón duplicado "Briefing con IA (Claude)" inferior (queda solo el CTA del header).

- **Slack** (`Comunicacion`, `SlackWorkspaceLayout`, `SlackAiPanel`, `SlackActivityPanel`, `SlackLaterPanel`, `SlackSaveForLaterButton`, `SlackComposer`, `SlackChannelHeader`, `SlackChannelInlineSummary`, `SlackConversationList`, `SlackMessageList`, `SlackQuickReplyBar`, `SlackChannelFilesPanel`, `SlackAttachmentPreviewDialog`) — **layout v2.4 estilo Slack-nativo full-screen**: se eliminó el `PageHeader` hero "Slack workspace" (ocupaba media pantalla y rompía el feeling de chat); ahora el `SlackWorkspaceLayout` muestra un **mini rail vertical oscuro** (60 px) con avatar del workspace `Kawiil` (gradiente azul, badge rojo de no leídos, botón "+" para nuevo DM, **botón Actividad** (icono `Activity`, badge rojo con menciones Slack no leídas) y **botón Más tarde** (icono `Bookmark`, badge azul con saved in-progress), indicador de conexión OAuth) y un **sidebar oscuro** (300 px) con header workspace + nombre + stats compactas + botón `MessageSquarePlus`; el subárbol del sidebar usa `dark` scoping para que tokens (`text-foreground`, `text-muted-foreground`, hover) den buen contraste sobre el fondo `slate-900`. Panel AI lateral y composer con "Mejorar con AI" en azul Kawiil; botón prominente **"Resumir con Kawiil"** en el header que abre el banner inline **KAWIIL · RESUMEN DEL CANAL** (tabs Hoy/Esta semana/Sin leer + chips "Crear N tareas", "Agendar llamada", "Ver hilo completo"); **drag & drop cross-zone** para asignar cualquier canal/DM a un grupo personalizado del sidebar (feedback visual con ring azul + `DragOverlay`); chip **"Sync a Kawiil"** con gradiente azul en adjuntos no-imagen; **barra "Kawiil sugiere"** sobre el composer con 3 chips de respuesta rápida (insertan al draft); panel **"Archivos del canal"** dentro del SlackAiPanel con preview por tipo y acciones **Sync a Kawiil** + **Guardar en Dropbox** (subida vía `dropbox-upload` al path `/Slack/<canal>/<archivo>`). **Paneles "Actividad" y "Más tarde" v2.4** (`SlackActivityPanel`, `SlackLaterPanel`): paneles laterales derechos (380–400 px) estilo Slack-nativo, mutuamente excluyentes con `SlackAiPanel`, con header `KAWIIL_AI_HEADER_BG` (icono blanco sobre gradiente) y close button; **Actividad** lee de `notifications (entity_type='slack')` con tabs Todo · Menciones · Hilos · DMs · Reacciones, click en item deep-linkea al mensaje original (`?channel=…&ts=…`) y CTA "Marcar todo leído"; **Más tarde** persiste en nueva tabla Supabase `slack_saved_messages` (RLS org-scoped, estados `in_progress`/`archived`/`completed`) con tabs En curso · Archivado · Completados y acciones inline Completar/Archivar/Reabrir/Quitar. **Hover de mensaje v2.4** (`SlackSaveForLaterButton`): botón icono `Bookmark`/`BookmarkCheck` añadido en la fila de acciones de `SlackMessageList` junto a "Responder en hilo" y "Crear tarea"; toggle guardar/quitar con estado optimista leyendo `useSlackSavedKeySet('in_progress')`. La tab "Menciones" de `/notificaciones` muestra un chip "Abrir en Slack · Actividad" cuando hay `slack_mention` sin leer (`?activity=mentions`). **Preview inline de adjuntos v2.4** (`SlackAttachmentPreviewDialog`): al hacer click en una imagen/documento del chat (o en el botón "Abrir" del panel "Archivos del canal") se abre un `Dialog` grande (`sm:max-w-5xl · sm:h-[90vh]`) que resuelve el archivo privado de Slack vía `fetchSlackPrivateFileBlob` y lo renderiza inline según tipo (imagen con `<img>`, PDF en `<iframe>`, video/audio con controles, texto/XML/CSV en `<pre>`, fallback Office/desconocido con CTA Descargar). Header con icono por tipo, nombre, badge de tipo y tamaño, más CTAs **Descargar** y **Abrir en Slack** (si hay `permalink`); cerrar con la X del dialog o tecla ESC devuelve al usuario al chat sin perder contexto. Reemplaza el `window.open` anterior que abría los adjuntos en una pestaña nueva del navegador.
- **Calendario** (`Microsoft365Calendario`, `CalendarKawiilCard`) — ficha AI diaria con `KAWIIL_AI_GRADIENT`.
- **Notificaciones** (`Notificaciones.tsx`, `NotificationsKawiilCard`) — hero con icono en gradiente azul + badge "v2.4"; tarjeta **"KAWIIL AI · Tu día"** con resumen automático del estado de la bandeja, mini-stats coloreados (Menciones / Actividad / Vencidas / Sistema) que navegan a su tab y CTA "Atender lo prioritario" en gradiente azul; iconos de tipo (`slack_*`, `knowledge_*`, `ai_proactive_tip`) homologados a `text-sky-*` (eliminado el morado/violeta). **Reorden v2.4**: las pestañas y la lista (Menciones / Actividad / Sistema / Vencimientos) se renderizan inmediatamente después de la tarjeta IA y las **preferencias de notificaciones** (entrega, IA proactiva) bajan al final bajo un divider con encabezado "Preferencias de notificaciones".
- **Pipeline** (`PipelineLayout`, `PipelineDashboard`, `LeadDetailPage`, `EmailSequences`, `EmailTemplates`, modales `AddNoteModal`/`CreateTaskModal`/`LogCallModal`/`LogWhatsAppModal`/`ScheduleMeetingModal`/`SendEmailModal`) — `PipelineLayout` usa `PageHeader` hero v2.4 con `iconAccent={KAWIIL_AI_GRADIENT}` y badge "v2.4"; el hero ejecutivo "Sala de control comercial" pasó del morado/violeta al azul Kawiil + badge "v2.4"; `LeadDetailPage` estrena header gradiente azul con avatar `Sparkles` + ficha **"KAWIIL AI · Insights del lead"** que sugiere próxima acción según prioridad/score. Todos los modales del pipeline usan el helper compartido `PipelineModalHeader` (gradiente azul Kawiil + icono blanco + subtítulo) para dar consistencia visual y reemplazar los `DialogHeader` simples.
- **Finanzas** (`Finanzas.tsx`, `FinanceKawiilCard`, `ExpenseFormDialog`, `ExpenseReviewDialog`) — hero v2.4 con `iconAccent={KAWIIL_AI_GRADIENT}` + breadcrumb "Kawiil OS · Operación · Finanzas" + badge "v2.4" junto al CTA "Nueva solicitud"; tarjeta **"KAWIIL AI · Finanzas en un vistazo"** debajo del hero con resumen automático del periodo (pendientes, aprobados, pagados y, si Savio está activo, cartera por cobrar) más mini-stats coloreados que navegan a la tab correspondiente y CTAs "Atender lo prioritario" / "Ver tableros" en gradiente azul; los dialogs `ExpenseFormDialog` (Nueva solicitud) y `ExpenseReviewDialog` (Detalle de gasto) ahora usan **header azul Kawiil** (icono blanco sobre `KAWIIL_AI_HEADER_BG` + subtítulo + cierre custom), homologando la experiencia con Pipeline y Correo.

## Pantallas alineadas (fase v2.5 — Tareas y Proyectos)

Re-skin operativo de Tareas y Proyectos para acercarlos al feeling de los nuevos mockups (sticky headers, layout 2-col, sidebars con secciones colapsables, mini-IA heurística). Toda la lógica/back se conserva (`useTasks`, `useTaskDetail`, `useProjects`, `useProjectDetail`, `useUpdateTask`, `task_assignees`, `task_comments`, `documents`, `dropbox_links`, `activity_log`, `PhaseManager`, dashboards de servicio).

### Migración de base de datos

Archivo: [`supabase/migrations/20260420120000_tasks_projects_v25.sql`](../supabase/migrations/20260420120000_tasks_projects_v25.sql) (idempotente).

| Cambio | Tabla | Notas |
|--------|-------|-------|
| `estimated_hours numeric(6,2)` | `tasks` | Horas estimadas. Se compara contra `time_spent_seconds` en la sidebar Tiempo del detalle de tarea. |
| `task_dependencies` | nueva | `task_id` depende de `depends_on_task_id` (`kind` `blocks` por defecto). RLS org-scoped. |
| `project_team` | nueva | Miembros explícitos de un proyecto con `role` (`lead`/`senior`/`revision`/`junior`/`colaborador`). RLS org-scoped. |

### Hooks nuevos

- `useTaskDependencies(taskId)` → `{ dependsOn, blocks }` + `useAddTaskDependency`, `useRemoveTaskDependency`. Carga las dos direcciones (qué bloquea esta tarea / a quién bloquea) con `related_task` joined manual.
- `useProjectTeam(projectId)` → lista ordenada por rol + perfiles. `useAddProjectTeamMember`, `useUpdateProjectTeamMember`, `useRemoveProjectTeamMember` con toasts.

### TaskDetailDialog v2.5 (`src/components/tasks/TaskDetailDialog.tsx`)

Conserva el `Dialog` (no se cambió a página), pero el contenido pasa a:

- **Width** `min(1180px,96vw)` × **height** `92vh`, sin scroll exterior.
- **Header sticky** con breadcrumb (`cliente › proyecto › Sub de «...»`), pill de prioridad (P1·URGENTE / P2·ALTA / P3·MEDIA / P4·BAJA), título inline editable, fecha de vencimiento con badge "Vencida" en rojo cuando aplica, selector de estado, botón **Completar** (CTA azul) y atajo de eliminación.
- **Body 2-col** `[minmax(0,1fr)_340px]`:
  - **Columna principal**: descripción, **Subtareas** (checklist + creación rápida con responsable y fecha), **Colaboradores** (`task_assignees`), bloque colapsable **Semáforo y atraso** (`criticality_level`, `delay_category`, `delay_notes`) y `Tabs` `Comentarios` / `Enlaces` (Dropbox) / `Archivos` con `MentionTextarea`, `FileDropzone`, `DropboxFilePicker`, `DropboxUploadDialog` (escanear), `DocumentPreviewDialog`, etc. — todo el plumbing existente reutilizado.
  - **Sidebar (lg+)** con cards: **Asignación** (responsable, área/célula, prioridad, avatares de colaboradores), **Tiempo** (timer Start/Pause + `time_spent_seconds` vs `estimated_hours` con barra y color, atajo a `BlockTimeDialog`, edición de fecha límite), **Dependencias** (`TaskDependenciesPanel`: depende de / bloquea a, click navega a la tarea con `setSelectedSubtaskId`), **Kawiil IA** (`TaskKawiilAiCard`, heurístico, sin LLM) y **Actividad reciente** (`activity_log` filtrado por `entity_type=task`).

### TaskDependenciesPanel y TaskKawiilAiCard

- `src/components/tasks/TaskDependenciesPanel.tsx`: chips por tarea con icono según estado, `+` agrega buscando candidatos del **mismo proyecto** (o globales si no hay proyecto), excluye la tarea actual y dependencias ya creadas. `kind=blocks` por defecto.
- `src/components/tasks/TaskKawiilAiCard.tsx`: header con `KAWIIL_AI_GRADIENT`, deriva 1-3 frases (vencida, semáforo, subtareas pendientes, dependencias bloqueantes abiertas, sobre presupuesto de horas) y cierra con stats `Subtareas N/M · Bloquean K · Horas X/Y`. **No** consume tokens de LLM.

### ProjectGeneralTab v2.5 (`src/components/projects/ProjectGeneralTab.tsx`)

Sobre la pestaña General se añade una fila superior `lg:grid-cols-3`:

- **Col 1-2**: `AISummaryCard` (LLM existente, sin cambios) — sigue como vista principal de "Resumen del proyecto".
- **Col 3**: `ProjectKawiilAiCard` (heurístico, lee `tasks` del proyecto) + `ProjectTeamCard` (CRUD de `project_team` con selector de rol inline).

El resto de la pestaña (Detalles del proyecto, Descripción, Notas de atraso, Guardar plantilla, Minutas) queda intacto.

### ProjectTeamCard y ProjectKawiilAiCard

- `src/components/projects/ProjectTeamCard.tsx`: variantes `compact` (sidebar) y `full` (Card). Lista ordenada por `lead → senior → revision → junior → colaborador` con badge de rol coloreado e inline-edit. Filtro de candidatos vía `useProfiles` excluyendo a quienes ya son miembros.
- `src/components/projects/ProjectKawiilAiCard.tsx`: header gradient azul Kawiil + frases priorizadas (proyecto vencido, tareas vencidas, semáforo crítico/atención, urgentes, avance) y stats `Total / Cerradas / Vencidas`. Recordatorio explícito de que el análisis con LLM completo vive en el card "Resumen del proyecto".

### Reglas v2.5

- **Reusar** componentes y hooks existentes antes de crear (Dropbox, comments, attachments, time tracking, AI cards LLM, PhaseManager, dashboards de servicio).
- **Nuevas tablas siempre con RLS** `organization_id = get_user_org_id(auth.uid())` (mismo patrón que `task_assignees` / `client_collaborators`).
- **Heurística vs. LLM**: las mini-cards "Kawiil IA" del detalle de tarea/proyecto son **heurísticas** (sin invocar Edge Functions ni Anthropic). Para análisis profundo seguir usando `AISummaryCard`.
- **Tipografía**: títulos de sección en sidebar usan `text-[11px] font-semibold uppercase tracking-wider text-muted-foreground`; cards de sidebar usan `rounded-lg border bg-background p-3 space-y-2.5`.

## Pantallas alineadas (fase v2.5 — Pipeline comercial)

El módulo Pipeline fue rediseñado como **sala de control comercial** para alinear con la visión v2.5 del producto. Siete vistas (`Dashboard`, `Tablero`, `Lista`, `Actividades`, `Secuencias`, `Plantillas`, `Ajustes`) usan el mismo vocabulario visual: pills de filtro, pastillas de etapa coloreadas, insights IA en fondo `KAWIIL_AI_SOFT_BG` y CTAs IA con gradient `KAWIIL_AI_GRADIENT`.

### Migración de base de datos

Archivo: [`supabase/migrations/20260420140000_pipeline_v25_vision.sql`](../supabase/migrations/20260420140000_pipeline_v25_vision.sql) — idempotente.

- `leads.estimated_value numeric(12,2)` nullable (MXN). Alimenta el totalizador **PIPELINE MXN** en el hero, las pastillas de `$` en el tablero, la columna **Monto** de la lista y el KPI **Ingresos proyectados**.
- `UPDATE pipeline_stages.name` para rename conversacional: `registrado→Nuevo`, `contactado→Saludé`, `calificado→Entendí qué busca`, `propuesta→Le mandé propuesta`, `negociacion→Negociando`, `convertido→Cerrado`. **Los slugs no cambian** — son el contrato para integraciones (webhooks, secuencias, automatizaciones).
- Tabla `pipeline_automations (organization_id, key, enabled, config jsonb)` con RLS org-scoped (mismo patrón que `pipeline_stages`) y seed por organización para 3 claves: `auto_cool_down_14d` (on por defecto, 14 días), `auto_advance_on_reply` (off), `auto_score_boost_on_open` (off). Trigger `trg_seed_pipeline_automations` inicializa las claves al crear una nueva organización.

### Utilidades compartidas

[`src/lib/pipelineFormat.ts`](../src/lib/pipelineFormat.ts) concentra los formateadores del módulo: `formatMxn`, `formatMxnShort` (compactos $45K / $1.2M), `flagForCountry` (emoji por ISO-2 o fallback a regional indicators), `relativeTime` ("Hace 2h", "Ayer 17:45", "Hace 4d"), `stageBadgeStyle` (pill con bg en 14% opacidad + borderColor al 40%), `scoreDotColor` (rojo ≥80, naranja ≥60, amarillo ≥40, gris), `initialsFromName` y `avatarBgFromName` (hash determinístico a paleta de 8 colores) y `stageCta` (CTA contextual según slug del stage).

### Hooks nuevos en `usePipeline`

- `useLeadActivitiesFeed(limit)` — feed org-wide para el card **Actividad reciente** del dashboard.
- `aggregateStageValues(leads) → Map<stage_id, { count, sumMxn }>` (más `usePipelineStageValues`) — derivado de `usePipelineLeads`, sin query extra; alimenta tablero, dashboard y hero.
- `usePipelineAutomations` + `useUpdatePipelineAutomation` — toggle persistente por org.
- `useTemplateUsage` — `Map<template_id, count>` desde `email_log`; pinta el chip **Usada N×** en la grid de plantillas.
- `downloadLeadsCsv(leads, stageName)` — export CSV client-side con BOM UTF-8.

### Layout

[`PipelineLayout.tsx`](../src/pages/pipeline/PipelineLayout.tsx) ya **no incluye** el tab "Métricas" (el dashboard absorbe esos KPIs). El tab **Actividades** muestra un badge rojo con el conteo de tareas vencidas (`useAllTasks("overdue")`). Se elimina `PipelineAnalytics.tsx` y su ruta `/pipeline/analytics`.

### Dashboard

[`PipelineDashboard.tsx`](../src/pages/pipeline/PipelineDashboard.tsx) aterriza como sala de control comercial:

- **Hero** gradient azul con 4 stats: Leads activos · **PIPELINE MXN** · Calientes · Salud del embudo.
- **5 KPI tiles**: Leads nuevos, Tasa de respuesta, Tasa de cierre, **Ciclo promedio** (días entre `created_at` y `updated_at` en cerrados) y **Ingresos proyectados** (suma `estimated_value × probabilidad_por_etapa` con `registrado=10% → negociacion=70%`).
- **Funnel** con % de pass-through consecutivo (`count_{n+1} / count_n`) en vez de % vs etapa inicial.
- **Velocity** con pares consecutivos ("Saludé → Entendí"), más tile inferior **Ciclo total promedio** = suma de días.
- **Fila inferior v2.5**: `Top5HotLeadsCard` · `LeadsByCountryCard` (barras con bandera) · `RecentActivityCard` (iconos por `type`, tiempo relativo).

### Tablero

[`PipelineBoard.tsx`](../src/pages/pipeline/PipelineBoard.tsx) gana filtros pill (`Todos · Calientes · En riesgo · Míos · Más filtros`), y reescribe `StageColumn` + `LeadCard` v2.5:

- `StageColumn`: header con `$XXK MXN` (de `aggregateStageValues`), contador y botón `+` que pre-selecciona el `stage_id` en el modal de nuevo lead.
- `LeadCard`: borde izquierdo con color de la etapa, avatar iniciales, chip de score + flame en calientes, insight IA (primera línea de `notes`) en fondo `KAWIIL_AI_SOFT_BG`, pastillas `campaña` + `$ monto`, CTA contextual según slug (`stageCta`), iconos `mailto:` / `tel:`.

### Lista

[`PipelineList.tsx`](../src/pages/pipeline/PipelineList.tsx) adopta los mismos pills, más selectores de etapa y país con bandera, popover **Más filtros** (prioridad / urgencia / visa) y botón **Exportar CSV** (`downloadLeadsCsv`). Columnas: **Lead** (avatar + nombre) · **Empresa** · **Score** (punto coloreado) · **Etapa** (pastilla `stageBadgeStyle`) · **Monto** · **País** (bandera + nombre) · **Última actividad** (`relativeTime`) · **Campaña**.

### Actividades

[`PipelineActivities.tsx`](../src/pages/pipeline/PipelineActivities.tsx) pasa a layout 2-col `Vencidas | Hoy`, con una sección **Próximos 7 días** debajo. `TaskCard` renderiza CTAs contextuales por `task_type`:
- `call` → **Ir a llamada** (`tel:${lead.phone}`)
- `email` → **Enviar** (abre `SendEmailModal`)
- otros → **Redactar con IA** (invoca `ai-email-draft`, copia al portapapeles, abre el compositor)

El bloque **Leads sin actividad 7+ días** añade un CTA masivo **Enviar Follow-up masivo IA** con gradient `KAWIIL_AI_GRADIENT` que inserta una `lead_task` tipo `follow_up` por cada lead inactivo (due +1h, alta prioridad).

### Secuencias

[`EmailSequences.tsx`](../src/pages/pipeline/EmailSequences.tsx) muestra un header con stats (`Total · Activas · Leads en secuencia`) y cada secuencia como un **diagrama horizontal**: chips `DÍA N · delay` con `template.subject`, conectados por chevrons. Botones `Probar` / `Editar` / `Activar-Pausar`, más métricas agregadas (`% apertura`, `% respuesta`) calculadas desde `email_log.sequence_step_id`.

### Plantillas

[`EmailTemplates.tsx`](../src/pages/pipeline/EmailTemplates.tsx) rediseña el grid como cards con borde superior por categoría (colores: primer contacto azul, follow_up violeta, propuesta ámbar, reactivación rosa), chip de slug, contador **Usada N×** y CTA **Generar con IA** (gradient `KAWIIL_AI_GRADIENT`) que invoca `ai-email-draft` y precarga `name / subject / body_html` en el form de edición.

### Ajustes

[`PipelineSettings.tsx`](../src/pages/pipeline/PipelineSettings.tsx) añade:

- Botón **Copiar** para la URL del webhook Meta (navigator.clipboard + toast + estado ✓).
- **Dropzone visual** para CSV (estado drag-over con borde primary, ícono `Upload`).
- **Etapas** del pipeline como pastillas coloreadas reordenables con `dnd-kit` (horizontal); guarda `position` masivamente y preserva slugs.
- Sección nueva **Automatizaciones IA** con header `KAWIIL_AI_SOFT_BG`, íconos por clave y `Switch` ligado a `usePipelineAutomations`.

### Reglas v2.5 · Pipeline

- **Nunca** cambiar `pipeline_stages.slug` (el rename de v2.5 toca solo `name`). El slug es el contrato con Meta, secuencias e integraciones.
- Toda cifra monetaria en MXN debe pasar por `formatMxn` o `formatMxnShort` para mantener consistencia (MXN, compactos con K / M, fallback `—`).
- Toda pastilla de etapa reutiliza `stageBadgeStyle(stage)` para respetar el color editorial.
- Todo CTA IA (redacción, follow-up masivo, generación de plantilla) usa `KAWIIL_AI_GRADIENT` en el botón; los bloques contextuales (insights, headers de sección AI) usan `KAWIIL_AI_SOFT_BG`.
- Las automatizaciones IA **solo persisten preferencia** en v2.5; los triggers/cron que las ejecuten se entregan en un PR separado.

## Tokens de Kawiil AI (v2.4)

Ubicación canónica: [`src/lib/kawiilAi.ts`](../src/lib/kawiilAi.ts).

| Token                         | Uso principal |
|-------------------------------|-------------------------------------------------------------------|
| `KAWIIL_AI_GRADIENT`          | Fondos inline de burbujas/avatares/iconos AI, CTA primarios AI.   |
| `KAWIIL_AI_HEADER_BG`         | Alias para headers de dialogs/cards AI (mismo gradiente 135°).    |
| `KAWIIL_AI_SOFT_BG`           | Banners suaves / highlights secundarios con tint azul Kawiil.     |
| `KAWIIL_AI_TEXT_GRADIENT_CLASS` | Clase Tailwind para texto con gradiente `from-sky-500 to-blue-600`. |

**Regla:** cualquier superficie que represente una acción o salida de la IA
Kawiil (resumen, mejora de texto, "crear tarea con AI", "enviar a Slack con AI",
ficha de briefing, etc.) debe consumir estos tokens en lugar de definir
gradientes `violet/purple/fuchsia` locales.

## Lienzo (modo claro)

`--background` es un gris muy suave (`220 14% 96%`); las tarjetas y `.surface-toolbar` usan `--card` (blanco) para que el diseño se perciba frente a Lovable/preview y no “desaparezca” el glass.

## Tokens CSS (ver `src/index.css`)

| Utilidad / token        | Uso |
|-------------------------|-----|
| `.surface-toolbar`      | Cabeceras de módulo, bloques de búsqueda/filtros. |
| `.surface-glass-subtle` | Contenedor secundario con blur ligero. |
| `Card variant="glass"`  | Bloques destacados; preferir opacidad alta en modo claro. |
| `.page-list-card`       | Filas/tarjetas de lista con hover suave. |
| `.gradient-text`        | Títulos de módulo: degradado horizontal `primary` → `accent` (`bg-clip-text`). |

## Componentes

- **PageHeader**: título `text-2xl sm:text-3xl font-bold` + clase **`.gradient-text`** (gradiente horizontal `--primary` → `--accent`); icono `text-primary`. Prop `variant` se mantiene por compatibilidad; el estilo del título es el mismo.
- **TabsList**: fondo semitransparente + borde alineado con toolbar.
- **Progress**: altura 6px (`h-1.5`), indicador con transición suave.

## Accesibilidad

- Contraste texto/fondo ≥ 4.5:1 en cuerpo; foco visible (`ring-2`).
- `@media (prefers-reduced-motion: reduce)` ya acorta animaciones globales; no añadir animaciones decorativas largas fuera de eso.

### Modo daltónico (eje `data-cvd`)

Eje independiente de `data-theme` (claro/oscuro). Controlado por `AccessibilityProvider` en [`src/contexts/AccessibilityContext.tsx`](../src/contexts/AccessibilityContext.tsx); persiste en `localStorage` con clave `kawiil-cvd-mode` y se aplica como atributo `data-cvd` en `<html>`. Un script inline en [`index.html`](../index.html) lo aplica antes del bundle para evitar flash.

Valores soportados: `off` (default, sin atributo), `deuteranopia`, `protanopia`, `tritanopia`. El selector vive en `Configuración → Apariencia` ([`src/pages/Admin.tsx`](../src/pages/Admin.tsx)) como grid 2×2 de cards con mini-swatches.

Los overrides CSS están en [`src/index.css`](../src/index.css) y se combinan con `[data-theme="dark"]`. Solo se reasignan tokens **semánticos** (no se toca `--primary`/`--accent` porque el azul Kawiil es seguro en deutero/prota):

| Token                 | Default (claro) | Deutero / Prota | Tritanopía       |
|-----------------------|-----------------|-----------------|------------------|
| `--destructive`       | rojo            | bermellón       | rojo puro        |
| `--success`           | verde           | azul            | verde            |
| `--warning`           | ámbar           | amarillo        | magenta          |
| `--info`              | azul            | azul cielo      | rojo             |
| `--priority-urgent`   | rojo            | bermellón       | rojo             |
| `--priority-high`     | naranja         | naranja         | magenta          |
| `--priority-medium`   | amarillo        | amarillo        | rosa             |
| `--priority-low`      | verde           | azul cielo      | verde            |

**Regla para componentes nuevos:** cualquier UI que transmita estado crítico (prioridad, semáforo, éxito/error) debe acompañar el color con **icono o texto**, para que siga siendo legible incluso si el usuario no activa el modo daltónico.

**Fuera de alcance actual:** los gráficos Recharts con colores hardcodeados (`FINANCE_CHART_COLORS`, etc.) no reaccionan a `data-cvd` todavía. Se planea exponer `useCvdPalette()` en un PR posterior.

## Anti-patrones

- Glass en cascada en >3 niveles anidados.
- `translate-y` fuerte en listas largas (fatiga visual).
- Usar `.gradient-text` en **microcopy** o celdas densas (reservar para títulos de módulo y cabeceras principales).

## Checklist antes de cerrar un PR de UI

- [ ] Rutas y datos sin cambios funcionales.
- [ ] Teclado: tabs y botones enfocables.
- [ ] Vista móvil en al menos una pantalla tocada.
