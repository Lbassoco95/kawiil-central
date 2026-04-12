import type { AppGrado } from "@/lib/gradoLabels";

/** Permisos granulares guardados en `profiles.kawiiler_permissions` (JSON). */
export type KawiilerPermissionsJson = {
  can_delete_tasks?: boolean;
  can_edit_task_due_dates?: boolean;
};

export function parseKawiilerPermissions(raw: unknown): KawiilerPermissionsJson {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  return {
    can_delete_tasks: typeof o.can_delete_tasks === "boolean" ? o.can_delete_tasks : undefined,
    can_edit_task_due_dates:
      typeof o.can_edit_task_due_dates === "boolean" ? o.can_edit_task_due_dates : undefined,
  };
}

/** Efectivo en UI y reglas de negocio según grado y flags guardados. */
export function effectiveCanDeleteTasks(role: AppGrado | string, p: KawiilerPermissionsJson): boolean {
  if (role === "transformador") return p.can_delete_tasks !== false;
  if (role === "referente") return p.can_delete_tasks === true;
  return false;
}

export function effectiveCanEditTaskDueDates(role: AppGrado | string, p: KawiilerPermissionsJson): boolean {
  if (role === "transformador") return p.can_edit_task_due_dates !== false;
  if (role === "referente") return p.can_edit_task_due_dates === true;
  return false;
}

export function taskPermissionDefaultsForRole(role: AppGrado | string): KawiilerPermissionsJson {
  if (role === "transformador") return { can_delete_tasks: true, can_edit_task_due_dates: true };
  if (role === "referente") return { can_delete_tasks: false, can_edit_task_due_dates: false };
  return { can_delete_tasks: false, can_edit_task_due_dates: false };
}
