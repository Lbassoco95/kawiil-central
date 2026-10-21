# Dirección visual: Zen + Glass

Decisión de producto (Louis, oct 2026): Kawiil OS debe dar la sensación de **un lugar tranquilo**.
Aplica a todo lo que se revisa desde las notificaciones y a lo que venga después
(sonidos, organización y presentación de información, nuevas pantallas).

## Principios
1. **Glass**: superficies translúcidas (`backdrop-filter: blur`), bordes finos de baja opacidad, sombras largas y suaves teñidas del color de acento.
2. **Cálido y transparente**: fondos crema/arena (`--zen-bg`), degradados casi imperceptibles; evitar blancos duros, negros puros y rojos saturados.
3. **Calma al informar**: poco a la vez, jerarquía clara, mucho espacio. Agrupar por momento (ahora / hoy / más adelante) en lugar de listas largas y planas. Lo urgente se distingue por tono y orden, no por alarma.
4. **Movimiento lento**: entradas de ~0.5 s con curva `cubic-bezier(0.22, 1, 0.36, 1)`; respetar `prefers-reduced-motion`.
5. **Sonido alegre y suave**: notas de kalimba/marimba (senoidales con caída natural y eco de sala corto), pentatónica mayor, menos de 1 s, volumen bajo. Nada de ondas cuadradas ni arpegios rápidos (suena a videojuego). Solo avisa que hay algo.
6. **Tono de texto**: amable y breve, sin alarmismo. Ej.: "Listo, guardado con calma"; "Algo no salió como esperábamos, inténtalo de nuevo".

## Ya implementado
- Estilo: `src/styles/zen-toast.css` (tokens `--zen-*`, claro y oscuro), `src/components/ui/sonner.tsx`, `src/components/ui/toast.tsx`.
- Sonido: `src/lib/notificationBeep.ts`, variantes `kalimba` (por defecto: Sol4–Si4–Re5), `marimba` y `campanillas`; se elige con `playNotificationBeep(variante)`.
- Paleta de estados: éxito = verde salvia, info = azul cielo, aviso = durazno, error = rosa suave (ícono: palomita / destello / viento / hoja).

## Pendiente / siguiente
- Página `Notificaciones` (`src/pages/Notificaciones.tsx`) con glass y agrupación calmada.
- Extender los tokens `--zen-*` al resto de superficies (paneles, diálogos, tarjetas).
- Catálogo de textos suaves para los mensajes de toast más comunes.
