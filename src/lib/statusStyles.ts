// Centralized status styles for the entire platform
// All labels use Title Case. All colors are consistent across modules.

import type { Database } from "@/integrations/supabase/types";

type TaskStatus = Database["public"]["Enums"]["task_status"];
type TaskPriority = Database["public"]["Enums"]["task_priority"];
type ClientStatus = Database["public"]["Enums"]["client_status"];
type ProjectStatus = Database["public"]["Enums"]["project_status"];

// ── Task Status ──
export const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  pendiente: { label: "Pendiente", color: "bg-muted text-muted-foreground" },
  en_progreso: { label: "En Progreso", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  en_revision: { label: "En Revisión", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  completada: { label: "Completada", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  cancelada: { label: "Cancelada", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
};

// ── Step Status (project steps/phases) ──
export type StepStatusKey = "pendiente" | "en_progreso" | "en_espera_cliente" | "completado";

export const STEP_STATUS_CONFIG: Record<StepStatusKey, { label: string; color: string }> = {
  pendiente: { label: "Pendiente", color: "bg-muted text-muted-foreground" },
  en_progreso: { label: "En Progreso", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  en_espera_cliente: { label: "En Espera del Cliente", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  completado: { label: "Completado", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
};

// ── Priority ──
export const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; emoji: string }> = {
  urgente: { label: "Urgente", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400", emoji: "🔴" },
  alta: { label: "Alta", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400", emoji: "🟠" },
  media: { label: "Media", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", emoji: "🟡" },
  baja: { label: "Baja", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", emoji: "🟢" },
};

// ── Client Status ──
export const CLIENT_STATUS_CONFIG: Record<ClientStatus, { label: string; color: string }> = {
  activo: { label: "Activo", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  inactivo: { label: "Inactivo", color: "bg-muted text-muted-foreground" },
  prospecto: { label: "Prospecto", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
};

// ── Project Status ──
export const PROJECT_STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string }> = {
  activo: { label: "Activo", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  pausado: { label: "Pausado", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  completado: { label: "Completado", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  cancelado: { label: "Cancelado", color: "bg-muted text-muted-foreground" },
};

// ── Periodicity Labels (compliance) ──
export const PERIODICITY_LABELS: Record<string, string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  cuando_aplique: "Cuando Aplique",
};
