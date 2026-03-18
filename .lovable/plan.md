
Problema confirmado: en el proyecto `/proyectos/24289b35-e445-40a8-8118-b17897808776` sí se creó la tarea central (`tasks`), pero no quedó guardada dentro de la etapa de juicio donde nació. Revisé los datos reales del backend y la etapa `demanda` en `projects.lawsuit_details.stages` no tiene `checklist`, por eso no aparece en la fase aunque la tarea exista.

Qué está pasando:
- `UnifiedStepRow` sí crea la subtarea local y sí crea la tarea en `tasks`.
- También llama `onSave({ checklist: updatedList })`.
- Pero en módulos basados en JSON del proyecto, especialmente `LawsuitDashboard`, el guardado usa el objeto `lawsuitDetails` recibido por props como base.
- Si hay varias mutaciones seguidas o el prop todavía no refleja el último cambio, `handleStageSave()` reconstruye `stages` desde un snapshot viejo y termina sobrescribiendo el `checklist` recién agregado.
- Esto explica exactamente el síntoma: la tarea se crea, pero no permanece dentro de la etapa.

Implementación propuesta:
1. Fortalecer `LawsuitDashboard`
- Dejar de basar `handleStageSave`, `handleStageToggle`, `addAttachment`, `removeAttachment`, `addStage`, `removeStage`, `addDeadline`, etc. directamente en `lawsuitDetails` de props.
- Crear un estado local fuente de verdad, por ejemplo `localLawsuitDetails`, sincronizado con props cuando cambie el proyecto.
- Todas las acciones deben leer y escribir sobre ese estado local antes de persistir.

2. Persistencia optimista segura
- Cuando `UnifiedStepRow` agregue una subtarea, `onSave` deberá impactar inmediatamente el estado local del dashboard.
- Luego se hace la actualización al backend con ese estado ya consolidado.
- Así evitamos que una mutación posterior reconstruya la etapa desde datos viejos y borre el checklist.

3. Invalidación/refetch correcto
- Mantener la invalidación de `["project", projectId]`, pero además asegurar que la UI renderice desde el estado local mientras llega el refetch.
- Esto evita que la subtarea “desaparezca” visualmente entre renders.

4. Revisar el mismo patrón en otros dashboards con JSON en `projects`
- `ConstitutionDashboard`
- `GestoriaDashboard`
Estos módulos usan el mismo enfoque de reconstruir arrays desde props y podrían sufrir el mismo problema con subtareas o cambios rápidos.
- Haría el arreglo primero en `LawsuitDashboard` y replicaría el patrón preventivo donde aplique.

Archivos a tocar:
- `src/components/projects/LawsuitDashboard.tsx` — corrección principal
- Posiblemente también:
  - `src/components/projects/ConstitutionDashboard.tsx`
  - `src/components/projects/GestoriaDashboard.tsx`

Resultado esperado:
- La subtarea seguirá creándose en el módulo de tareas.
- También quedará registrada dentro de la etapa/fase exacta donde se creó.
- En la fase se seguirá viendo:
  - nombre de la subtarea
  - responsable
  - fecha límite
  - avance
- Y desde esa subtarea se podrá abrir la tarea homologada como ya está diseñado.
