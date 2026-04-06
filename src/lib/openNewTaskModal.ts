/**
 * Abre el modal de nueva tarea definido en AppLayout.
 * Usa un CustomEvent en window para no depender solo de React Context
 * (en algunos iframes / bundlers duplicados el contexto puede quedar vacío).
 */
export const OPEN_NEW_TASK_MODAL_EVENT = "kawiil:open-new-task-modal";

export function openNewTaskModal(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_NEW_TASK_MODAL_EVENT));
}
