# Dirección visual: Zen + Glass

Decisión de producto (Louis, oct 2026): Kawiil OS debe dar la sensación de **un lugar tranquilo**.
Aplica a todo lo que se revisa desde las notificaciones y a lo que venga después
(sonidos, organización y presentación de información, nuevas pantallas).

## Principios
1. **Glass**: superficies translúcidas (`backdrop-filter: blur`), bordes finos de baja opacidad, sombras largas y suaves teñidas del color de acento.
2. **Cálido y transparente**: fondos crema/arena (`--zen-bg`), degradados casi imperceptibles; evitar blancos duros, negros puros y rojos saturados.
3. **Calma al informar**: poco a la vez, jerarquía clara, mucho espacio. Agrupar por momento (ahora / hoy / más adelante) en lugar de listas largas y planas. Lo urgente se distingue por tono y orden, no por alarma.
4. **Movimiento lento**: entradas de ~0.5 s con curva `cubic-bezier(0.22, 1, 0.36, 1)`; respetar `prefers-reduced-motion`.
5. **Sonido suave que no cansa** (se oye todos los días): golpe de madera hueca en registro grave-medio (~260–350 Hz), filtro pasa-bajos sin brillo, menos de 0.6 s, volumen bajo. Evitar agudos, ondas cuadradas/triangulares y arpegios (suena a videojuego y harta). Solo avisa que hay algo.
6. **Tono de texto**: amable y breve, sin alarmismo. Ej.: "Listo, guardado con calma"; "Algo no salió como esperábamos, inténtalo de nuevo".

## Ya implementado
- Estilo: `src/styles/zen-toast.css` (tokens `--zen-*`, claro y oscuro), `src/components/ui/sonner.tsx`, `src/components/ui/toast.tsx`.
- Sonido: `src/lib/notificationBeep.ts`, variantes `madera` (por defecto, Do4–Fa4), `gota` y `bruma`; se elige con `playNotificationBeep(variante)`. Lección: el kalimba (Sol4–Re5) y el pitido original (880/1320 Hz) resultaron agudos y cansados.
- Paleta de estados: éxito = verde salvia, info = azul cielo, aviso = durazno, error = rosa suave (ícono: palomita / destello / viento / hoja).

- Dashboard (`src/pages/Dashboard.tsx`): wrapper `.zen-page .zen-dash`; las reglas de `zen-glass.css` reestilizan las clases compartidas (`surface-toolbar`, `stat-card`, `page-list-card`, `Card`, `Alert`) solo dentro del wrapper. Para pasar otra página a zen basta con envolverla en `zen-page zen-dash` y poner `className="zen-hero zen-glass"` al `PageHeader`.

- Tareas (`src/pages/Tareas.tsx`): wrapper `kwv24 zen-page zen-dash`. Las reglas `.zen-page .toolbar/.mtable/.pill-group/.ai-hero-card` de `zen-glass.css` reestilizan el sistema v24 (barra de filtros, tabla, píldoras, tarjetas de IA, kanban) solo en páginas con `zen-page`; Proyectos y otras páginas v24 siguen igual hasta que se envuelvan igual.

## Pendiente / siguiente
- Extender los tokens `--zen-*` al resto de páginas (Dashboard ya hecho), diálogos y tarjetas.

## Catálogo de frases suaves

Implementado en `src/lib/zenCopy.ts` (con pruebas) e instalado una sola vez en `src/components/ui/sonner.tsx`:
envuelve `toast.success/error/warning/info`, así que el tono aplica a toda la app sin editar cada llamada.
El detalle técnico no se pierde: pasa a la descripción del aviso.

| Original | Se muestra |
|---|---|
| `Error al subir archivo: <detalle>` | **No pudimos subir archivo** · `<detalle>` · Inténtalo de nuevo en un momento. |
| `No se pudo guardar: <detalle>` | **No pudimos guardar** · `<detalle>` · Inténtalo de nuevo en un momento. |
| `Error: <detalle>` | **Algo no salió como esperábamos** · `<detalle>` |
| `Escribe el acuerdo` / `Selecciona un PDF` | **Cuando puedas, escribe el acuerdo** |
| `Guardado` | Guardado con calma |
| `Cambios guardados` | Tus cambios ya están a salvo |
| `Copiado al portapapeles` | Copiado, listo para pegar |
| `Tarea completada` | Tarea completada, bien hecho |
| `Correo enviado` | Correo enviado, ya va en camino |

Reglas para escribir avisos nuevos:
- Decir qué pasó en pocas palabras y sin culpar al usuario ("No pudimos…", no "Error al…").
- Un error siempre sugiere el siguiente paso (reintentar, revisar un dato).
- Validaciones como petición amable ("Cuando puedas, …"), no como orden.
- Sin mayúsculas sostenidas, sin signos de exclamación en errores, sin tecnicismos en el título.
- Para frases nuevas frecuentes, agregarlas a `SUCCESS_PHRASES` en `zenCopy.ts`.
- Los avisos con JSX o con `description` propia no se reescriben.
- Los avisos de `useToast` (Radix) también pasan por el catálogo: `softenRadixToast` en `zenCopy.ts`, aplicado dentro de `src/hooks/use-toast.ts`. Un título "Error" a secas se vuelve "Algo no salió como esperábamos" y conserva la descripción.
