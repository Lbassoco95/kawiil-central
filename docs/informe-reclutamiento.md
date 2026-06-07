# Informe — Módulo de Reclutamiento (vs. Brief CHRO)

Estado del módulo de Reclutamiento de Kawiil Central frente al *Brief CHRO → CTO*.
Fecha: junio 2026.

## Resumen ejecutivo
La **Fase 1 del brief (pipeline + comunicación + bitácora)** está **completa y en producción**, con varias funciones adicionales (expediente digital, onboarding, rúbrica, roles, NOM‑035/clima, jornada/asistencia). En esta iteración se cerraron casi todas las brechas internas restantes. Lo único que queda fuera es la **integración psicométrica externa** (Evalart) — se dejó lista la **fase 0 con liga (Tally/TypeForm)**.

## Especificación funcional — estado por punto

### 1. Pipeline de candidatos (Kanban)
- ✅ Kanban por vacante, tiempo real, arrastrar tarjetas.
- ✅ Etapas **configurables** por vacante (se ajustan a las del brief).
- ✅ Tarjeta: nombre, **canal de origen**, **score** (semáforo de rúbrica), pretensión (en ficha), notas, **último contacto**, indicador de CV.
- ✅ **Filtros** por canal y por fecha (además de vacante/etapa).

### 2. Gestión de vacantes
- ✅ Puesto, área/célula, **grado (G1–G4)**, **presupuesto**, **responsable** (Entrevistadores/Responsables), estado (activa/pausada/cerrada/cubierta).
- ✅ Candidato vinculado a vacante; historial de vacantes (lista con estados).

### 3. Comunicación integrada
- ✅ Templates con variables, envío 1 clic desde Outlook, **bitácora automática**.
- ✅ **Recordatorio 48 h**: digest diario (09:00 CDMX) a G4 con candidatos sin avance >48 h.

### 4. Evaluación y psicométricos
- ✅ **Rúbrica** ponderada (1–5) con semáforo y resultado en la tarjeta.
- ✅ **Liga de examen/psicométrico** por candidato (Tally/TypeForm/Evalart) — fase 0.
- 🟡 Integración API de Evalart (resultado automático en tarjeta): **pendiente** (externo).
- 🟡 Score compuesto CV+examen+psico: hoy es promedio ponderado de rúbrica.

### 5. Panel CHRO (vista diaria)
- ✅ Panel en Reclutamiento: candidatos **activos**, **nuevos (7 días)**, **sin avance >48 h**, **en riesgo >7 días**, lista de sin avance y **distribución por canal**.
- 🟡 Tiempo promedio por etapa / conversión y costo por contratación: **pendiente** (requiere capturar más datos).

### 6. Onboarding automatizado
- ✅ Checklist de bienvenida (plantilla por organización) **disparado al convertir candidato a colaborador**.
- 🟡 Disparo al mover a la etapa "Onboarding" y **responsable por ítem**: pendiente (el checklist vive a nivel del colaborador ya creado).

## Modelo de datos (Supabase) — implementado
- `rh_recruitment_processes` (vacantes) — incluye `grade`, `budget`, `status`, `celula_id`.
- `rh_candidates` — canal (`source`), `cv` (Storage), `assessment_url`, `rating`, ficha ampliada, `state_id`.
- `rh_recruitment_stages` / `rh_recruitment_states` — fases y estados configurables.
- `rh_candidate_activities` — bitácora (comunicaciones + cambios de etapa/estado).
- `rh_recruitment_criteria` / `rh_candidate_scores` — rúbrica y calificaciones.
- `rh_process_interviewers` / `rh_process_owners` — entrevistadores y responsables.
- Onboarding: `rh_onboarding_template_items` / `rh_onboarding_items`.

## Pendientes (decisión / esfuerzo)
1. **Evalart (API)** — integración externa; requiere contratar y conectar. Hoy cubierto por liga (fase 0).
2. **KPIs avanzados** (tiempo por etapa, conversión/costo por canal) — requieren más captura.
3. **Onboarding por etapa + responsable por ítem** — mejora del flujo actual.

## Caso de uso activo
Vacante **Contador G1** (Roma Sur, $10,500/mes) operando ya dentro del módulo: pipeline, candidatos importados, bitácora y panel CHRO.
