

## Plan: Corregir lag en textareas de notas y otros campos de texto

### Problema raíz

En `UnifiedStepRow.tsx`, el cronómetro ejecuta `setDisplaySeconds` cada segundo cuando está activo. Esto causa que **todo el componente** se re-renderice cada segundo, incluyendo el textarea de notas, los inputs, selects, etc. Al escribir, cada keystroke compite con re-renders del timer, causando que se "pierdan" letras.

El mismo patrón puede afectar `LawsuitDashboard.tsx` si hay actualizaciones frecuentes del estado padre.

### Solución

**Archivo: `src/components/projects/UnifiedStepRow.tsx`**

1. **Extraer el timer a un componente separado** (`StepTimer`) que encapsule su propio estado (`displaySeconds`, `timerRunning`, el interval). Así sus re-renders cada segundo no afectan al textarea ni al resto del formulario.
   - El componente `StepTimer` recibirá `initialSeconds` y un callback `onStop(totalSeconds)` para reportar el tiempo al guardar.
   - Se elimina `displaySeconds`, `timerRunning`, `timerRef`, `startTimeRef`, `baseSecondsRef` del componente padre.

2. **Debounce en el textarea de notas** — como medida adicional, cambiar el textarea de notas a un componente con estado local completamente independiente que solo propague cambios al padre con un debounce de 300ms, evitando cualquier re-render innecesario desde el padre.

**Archivo: `src/components/projects/LawsuitDashboard.tsx`**

3. Los textareas de notas en stages y deadlines usan `onChange` directo sobre el estado del array completo de stages/deadlines, lo que re-renderiza toda la lista al escribir una letra. Aplicar el mismo patrón: componente wrapper con estado local para cada textarea de notas.

### Componente nuevo: `src/components/projects/StepTimer.tsx`
- Encapsula timer state, interval, display
- Props: `initialSeconds`, `onStop`, `showTimer`
- Renderiza el badge en la fila colapsada y el control play/pause en la expandida

### Archivos a modificar
- `src/components/projects/UnifiedStepRow.tsx` — extraer timer, optimizar textarea
- `src/components/projects/LawsuitDashboard.tsx` — optimizar textareas de notas en stages/deadlines

### Sin cambios de base de datos

