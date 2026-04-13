# Kawiil Central — Design system (fase 1, glass + minimal)

Fuente de verdad para UI en Dashboard, Clientes, Proyectos, Tareas y Pipeline (solo presentación). No sustituye lógica ni rutas.

## Principios

- **Minimal**: pocas sombras, poco movimiento vertical en hover; jerarquía por tipografía y espacio (múltiplos de 4px).
- **Glass moderado**: `backdrop-blur` y bordes suaves en **cabeceras de página**, **barras de filtros**, **tabs** y **contenedores de herramientas**. Listas densas y tarjetas Kanban mantienen fondo más opaco para legibilidad.
- **No glass**: celdas de tabla muy compactas, texto largo sobre fondo muy variable.

## Tokens CSS (ver `src/index.css`)

| Utilidad / token        | Uso |
|-------------------------|-----|
| `.surface-toolbar`      | Cabeceras de módulo, bloques de búsqueda/filtros. |
| `.surface-glass-subtle` | Contenedor secundario con blur ligero. |
| `Card variant="glass"`  | Bloques destacados; preferir opacidad alta en modo claro. |
| `.page-list-card`       | Filas/tarjetas de lista con hover suave. |

## Componentes

- **PageHeader** `variant="minimal"`: título sin gradiente; peso semibold, tracking tight.
- **TabsList**: fondo semitransparente + borde alineado con toolbar.
- **Progress**: altura 6px (`h-1.5`), indicador con transición suave.

## Accesibilidad

- Contraste texto/fondo ≥ 4.5:1 en cuerpo; foco visible (`ring-2`).
- `@media (prefers-reduced-motion: reduce)` ya acorta animaciones globales; no añadir animaciones decorativas largas fuera de eso.

## Anti-patrones

- Glass en cascada en >3 niveles anidados.
- `translate-y` fuerte en listas largas (fatiga visual).
- Gradientes llamativos en títulos de listas operativas (usar `minimal`).

## Checklist antes de cerrar un PR de UI

- [ ] Rutas y datos sin cambios funcionales.
- [ ] Teclado: tabs y botones enfocables.
- [ ] Vista móvil en al menos una pantalla tocada.
