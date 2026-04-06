/** Estados que siguen en el flujo de trabajo (visibles por defecto en listas operativas). */
export const OPEN_TASK_STATUSES = ["pendiente", "en_progreso", "en_revision"] as const;

export type OpenTaskStatus = (typeof OPEN_TASK_STATUSES)[number];

export function isTaskOpenStatus(status: string): status is OpenTaskStatus {
  return (OPEN_TASK_STATUSES as readonly string[]).includes(status);
}

export function isTaskClosedStatus(status: string): boolean {
  return status === "completada" || status === "cancelada";
}
