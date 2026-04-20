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
- **Correo** (`EmailView`, `EmailKawiilCard`, `ComposeEmailDialog`, `CreateTaskFromEmailDialog`, `SendEmailToSlackDialog`) — resumen AI, enviar a Slack, crear tarea con prefill AI, todos con header azul y botones "Mejorar con AI".
- **Slack** (`SlackAiPanel`, `SlackComposer`) — panel AI y composer con acciones "Mejorar con AI" en azul Kawiil.
- **Calendario** (`Microsoft365Calendario`, `CalendarKawiilCard`) — ficha AI diaria con `KAWIIL_AI_GRADIENT`.

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
