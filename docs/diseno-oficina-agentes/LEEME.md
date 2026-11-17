# Diseño: oficina virtual de agentes (Kawiil OS)

Referencia visual y de datos para implementar en `kawiil-central`. Ábrelo como consulta; no es código para copiar tal cual.

## tableros/
Pantallas en HTML (formato del lienzo de diseño). Se leen como maquetas: estructura, textos, clases y colores.
- Recorrido.dc.html: los tres pasos y las decisiones.
- Main.dc.html: plano de islas (vista general) + Estado de tareas.
- IslaJuridico / IslaFiscal / IslaAcervo / IslaGestoria / IslaCumplimiento / IslaOtros / IslaMarketing: sala isométrica de cada isla + escritorio del agente (5 pestañas).
- Escritorio.dc.html: la misma isla de Marketing dentro del módulo Marketing (pestaña Agentes).
- Administrar.dc.html: Crear agente + Tablas.
- Personajes.dc.html: perfiles (personalidad, aspecto, nivel) de los 29 agentes.
- Aprendizaje.dc.html: las tres vías de aprendizaje y los niveles.
- MovilPlano / MovilIsla / Movil: flujo móvil.
- canvas.json: posición de cada pantalla.

## assets/
- sprites_unif.json: los 29 sprites en el formato único (escritorio con patas, monitor azul, accesorios). `unif.py` los genera a partir de `sprites_originales.json`.
- perfiles_islas_salas.json: personalidad y aspecto por agente, accesorios, nombres, islas y distribución de cada sala (cuadrícula y zonas).
- plano2.svg y plano_hits.json: el plano actual ajustado (viewBox -130 0 1400 880) y el área tocable de cada isla.
- sala_marketing_anterior.png: la sala de Marketing que se reemplaza.

Todos los datos de actividad, estados, niveles y tareas son de ejemplo.
