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

- **Dashboard** (`Dashboard.tsx`, `AiHeroGrid`) — hero `iconAccent={KAWIIL_AI_GRADIENT}`, badge "v2.4" en `actions`, chip "KAWIIL AI · v2.4" en el briefing, burbuja `Sparkles` con gradiente azul.
- **Hub** (`Hub.tsx`) — hero con icono en gradiente azul, badge "v2.4", dialogs (Subir procedimiento / Nuevo comunicado) con **header azul Kawiil** (icono blanco sobre `KAWIIL_AI_HEADER_BG`) y CTA primario con gradiente azul.
- **Asistente IA** (`AsistenteIA.tsx`) — header, hero vacío, avatares y CTA usan `KAWIIL_AI_GRADIENT`.
- **Correo** (`EmailView`, `EmailKawiilCard`, `ComposeEmailDialog`, `CreateTaskFromEmailDialog`, `SendEmailToSlackDialog`) — resumen AI, enviar a Slack, crear tarea con prefill AI, todos con header azul y botones "Mejorar con AI". **Redacción de correos nuevos v2.4**: header con badge "v2.4" + subtítulo dinámico (asunto o "N destinatarios · sin asunto"); botón **"Asistente"** en el header que toggle el panel IA; botón **"Sugerir asunto"** junto al input de asunto que usa `ai-email-draft` para generar un asunto breve; **plantillas rápidas Kawiil** ("Confirmar reunión", "Pedir información", "Enviar reporte semanal", "Seguimiento de pago") visibles tanto en el panel IA como como pills bajo el editor cuando el cuerpo está vacío.
- **Slack** (`Comunicacion`, `SlackWorkspaceLayout`, `SlackAiPanel`, `SlackComposer`, `SlackChannelHeader`, `SlackChannelInlineSummary`, `SlackConversationList`, `SlackMessageList`, `SlackQuickReplyBar`, `SlackChannelFilesPanel`) — **layout v2.4 estilo Slack-nativo full-screen**: se eliminó el `PageHeader` hero "Slack workspace" (ocupaba media pantalla y rompía el feeling de chat); ahora el `SlackWorkspaceLayout` muestra un **mini rail vertical oscuro** (60 px) con avatar del workspace `Kawiil` (gradiente azul, badge rojo de no leídos, botón "+" para nuevo DM, indicador de conexión OAuth) y un **sidebar oscuro** (300 px) con header workspace + nombre + stats compactas + botón `MessageSquarePlus`; el subárbol del sidebar usa `dark` scoping para que tokens (`text-foreground`, `text-muted-foreground`, hover) den buen contraste sobre el fondo `slate-900`. Panel AI lateral y composer con "Mejorar con AI" en azul Kawiil; botón prominente **"Resumir con Kawiil"** en el header que abre el banner inline **KAWIIL · RESUMEN DEL CANAL** (tabs Hoy/Esta semana/Sin leer + chips "Crear N tareas", "Agendar llamada", "Ver hilo completo"); **drag & drop cross-zone** para asignar cualquier canal/DM a un grupo personalizado del sidebar (feedback visual con ring azul + `DragOverlay`); chip **"Sync a Kawiil"** con gradiente azul en adjuntos no-imagen; **barra "Kawiil sugiere"** sobre el composer con 3 chips de respuesta rápida (insertan al draft); panel **"Archivos del canal"** dentro del SlackAiPanel con preview por tipo y acciones **Sync a Kawiil** + **Guardar en Dropbox** (subida vía `dropbox-upload` al path `/Slack/<canal>/<archivo>`).
- **Calendario** (`Microsoft365Calendario`, `CalendarKawiilCard`) — ficha AI diaria con `KAWIIL_AI_GRADIENT`.
- **Notificaciones** (`Notificaciones.tsx`, `NotificationsKawiilCard`) — hero con icono en gradiente azul + badge "v2.4"; tarjeta **"KAWIIL AI · Tu día"** con resumen automático del estado de la bandeja, mini-stats coloreados (Menciones / Actividad / Vencidas / Sistema) que navegan a su tab y CTA "Atender lo prioritario" en gradiente azul; iconos de tipo (`slack_*`, `knowledge_*`, `ai_proactive_tip`) homologados a `text-sky-*` (eliminado el morado/violeta). **Reorden v2.4**: las pestañas y la lista (Menciones / Actividad / Sistema / Vencimientos) se renderizan inmediatamente después de la tarjeta IA y las **preferencias de notificaciones** (entrega, IA proactiva) bajan al final bajo un divider con encabezado "Preferencias de notificaciones".
- **Pipeline** (`PipelineLayout`, `PipelineDashboard`, `LeadDetailPage`, `EmailSequences`, `EmailTemplates`, modales `AddNoteModal`/`CreateTaskModal`/`LogCallModal`/`LogWhatsAppModal`/`ScheduleMeetingModal`/`SendEmailModal`) — `PipelineLayout` usa `PageHeader` hero v2.4 con `iconAccent={KAWIIL_AI_GRADIENT}` y badge "v2.4"; el hero ejecutivo "Sala de control comercial" pasó del morado/violeta al azul Kawiil + badge "v2.4"; `LeadDetailPage` estrena header gradiente azul con avatar `Sparkles` + ficha **"KAWIIL AI · Insights del lead"** que sugiere próxima acción según prioridad/score. Todos los modales del pipeline usan el helper compartido `PipelineModalHeader` (gradiente azul Kawiil + icono blanco + subtítulo) para dar consistencia visual y reemplazar los `DialogHeader` simples.
- **Finanzas** (`Finanzas.tsx`, `FinanceKawiilCard`, `ExpenseFormDialog`, `ExpenseReviewDialog`) — hero v2.4 con `iconAccent={KAWIIL_AI_GRADIENT}` + breadcrumb "Kawiil OS · Operación · Finanzas" + badge "v2.4" junto al CTA "Nueva solicitud"; tarjeta **"KAWIIL AI · Finanzas en un vistazo"** debajo del hero con resumen automático del periodo (pendientes, aprobados, pagados y, si Savio está activo, cartera por cobrar) más mini-stats coloreados que navegan a la tab correspondiente y CTAs "Atender lo prioritario" / "Ver tableros" en gradiente azul; los dialogs `ExpenseFormDialog` (Nueva solicitud) y `ExpenseReviewDialog` (Detalle de gasto) ahora usan **header azul Kawiil** (icono blanco sobre `KAWIIL_AI_HEADER_BG` + subtítulo + cierre custom), homologando la experiencia con Pipeline y Correo.

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

## Anti-patrones

- Glass en cascada en >3 niveles anidados.
- `translate-y` fuerte en listas largas (fatiga visual).
- Usar `.gradient-text` en **microcopy** o celdas densas (reservar para títulos de módulo y cabeceras principales).

## Checklist antes de cerrar un PR de UI

- [ ] Rutas y datos sin cambios funcionales.
- [ ] Teclado: tabs y botones enfocables.
- [ ] Vista móvil en al menos una pantalla tocada.
