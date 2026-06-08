# Informe — Módulo de Reclutamiento (vs. Brief CHRO)

Estado final del módulo de Reclutamiento de Kawiil Central frente al
*Brief CHRO → CTO*. Fecha: junio 2026.

## Resumen ejecutivo
El módulo cubre **todo el ciclo del candidato dentro de Kawiil** —
postulación, pipeline, comunicación, evaluación, panel CHRO y onboarding— y
**opera 100% en la plataforma**. Hacia afuera solo se **publica un link** y la
información **entra sola**. Lo único que queda fuera del alcance interno es la
**integración psicométrica por API (Evalart)**, cubierta hoy con liga/PDF.

## Especificación funcional — estado por punto

### 1. Pipeline de candidatos (Kanban)
- ✅ Kanban por vacante, tiempo real, arrastrar tarjetas.
- ✅ Etapas **configurables** por vacante.
- ✅ Tarjeta: nombre, **canal de origen**, **score** (semáforo), pretensión, notas, **último contacto**, indicador de CV.
- ✅ **Filtros** por canal y fecha (además de vacante/etapa).

### 2. Gestión de vacantes
- ✅ Puesto, área/célula, **grado (G1–G4)**, **presupuesto**, **responsable** (Entrevistadores/Responsables), estado (activa/pausada/cerrada/cubierta).
- ✅ Candidato vinculado a vacante; lista con estados.

### 3. Captación (publicar afuera, traer adentro)
- ✅ **Formulario de postulación propio** por vacante: botón **"Publicar"** copia un link `…/postular/<token>` que se difunde en Computrabajo, LinkedIn, OCC, etc.
- ✅ Las postulaciones **entran solas** al pipeline (fase y estado inicial), con canal de origen y CV; quedan en la bitácora. Anti‑spam básico.
- 🟡 API directa de Computrabajo/Indeed/LinkedIn: no aplica (sin API abierta / costo). Lo que llegue por **correo** se ve en el módulo de Correo y se da de alta.

### 4. Comunicación integrada
- ✅ **Plantillas** con variables ({{nombre}}, {{vacante}}, {{empresa}}, {{fase}}): Invitación a entrevista, Solicitud de documentos, **Recordatorio (48 h)**, Oferta laboral, Agradecimiento.
- ✅ Envío 1 clic desde Outlook + **bitácora automática**.
- ✅ **Recordatorio 48 h**: digest diario a G4 con candidatos sin avance.

### 5. Evaluación y psicométricos
- ✅ **Rúbrica** ponderada (1–5) con semáforo, resultado en la tarjeta.
- ✅ **Liga y PDF** del examen/psicométrico por candidato (Tally/TypeForm/Psicotest, fase 0).
- 🟡 API de Evalart (resultado automático): pendiente (externo, requiere cuenta/API key).

### 6. Panel CHRO (vista diaria)
- ✅ Activos, **nuevos (7 días)**, **sin avance >48 h**, **en riesgo >7 días**, lista de sin avance y **distribución por canal**.
- 🟡 Tiempo promedio por etapa / costo por contratación: pendiente (requiere más captura).

### 7. Onboarding
- ✅ Checklist de bienvenida (plantilla por organización) al **convertir candidato a colaborador**; expediente digital y documentos.
- 🟡 Disparo por etapa "Onboarding" + responsable por ítem: mejora futura.

## Roles
- **Admin/Reclutador** (G4 o permiso de módulo): control total.
- **Responsable** (por vacante): gestiona su vacante.
- **Entrevistador** (por vacante): solo evalúa (rúbrica + notas).

## Pendiente solo de despliegue (operación, no desarrollo)
Correr en Supabase (editor SQL) las migraciones, y desplegar las 2 edge
functions (`recruit-apply` ✅ ya, `slack-jornada-sync` para el estado de Slack
"En reunión"). El módulo **opera sin esas APIs externas**.

## Fuera de alcance interno (decisión de negocio)
- **Evalart (psicométrico por API)** — contratar + conectar; hoy cubierto con liga/PDF.
- **KPIs avanzados** (tiempo por etapa, costo) — requieren más datos.

## Caso de uso activo
Vacante **Contador G1** (Roma Sur, $10,500/mes) operando en el módulo:
publicación por link, candidatos en pipeline, comunicación con plantillas,
evaluación con rúbrica y panel CHRO.
