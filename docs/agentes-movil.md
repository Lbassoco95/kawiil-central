# Agentes · versión móvil (R7)

Entrega del 26 nov 2026. Capturas (datos de ejemplo, celular de 390 px) en `docs/diseno-oficina-agentes/capturas-v2/movil-*.png`. Base: Movil, MovilPlano y MovilIsla de `tableros/` y el tablero 7 de `tableros-v2/`.

## Qué hay (menos de 768 px)
- **Sala:** la lista de agentes con su estado va primero y el plano queda de apoyo debajo. Tocar a un agente abre su chat a pantalla completa (no el panel de la sala). La oficina de un equipo aparece como una sección con su nombre y «Entrar a la oficina» la abre en su propia pantalla. «Abrir en pestaña» no se ofrece en el celular.
- **Chat a pantalla completa** (`/agentes/chat/<id>`): barra con «‹ Sala», el nombre del agente y el botón «Requerimientos» con su total; el cuadro para escribir queda abajo, en la primera pantalla. Las secciones (Conversaciones, Perfil, Aprendizaje, Rutinas y Documentos) se recorren de lado.
- **Varias conversaciones:** pestañas arriba (con scroll lateral), cada una con nombre y estado en palabra y marca; se cambia con un toque. «Varios a la vez» no se ofrece. «En curso» empieza plegada para no quitarle pantalla al chat.
- **Requerimientos en pantalla propia:** el botón del chat abre «Pendientes de ti · De la autoridad · Documentos» con «‹ Volver al chat».
- **Toques de al menos 44 px** en la lista de la sala, los botones de la oficina, las pestañas, las secciones, «Requerimientos», «Nueva», las conversaciones y «Enviar».
- En pantalla ancha todo sigue como antes.

## Supuestos
1. «Celular» = menos de 768 px de ancho (`md` de Tailwind).
2. El chat del celular es una pantalla encima de la app (`fixed`), así no depende del encabezado de la aplicación; se sale con «‹ Sala».
3. El total del botón «Requerimientos» son los pendientes de ti de todos los agentes (igual que la franja).
4. La altura del chat se calcula con la altura de la pantalla (`100dvh`); con muchos avisos arriba, la pantalla se desliza.
5. No se probó en un celular real ni con la barra del navegador móvil: se revisó con una ventana de 390 × 844.
