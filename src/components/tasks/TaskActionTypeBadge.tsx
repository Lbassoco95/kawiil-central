import { cn } from "@/lib/utils";
import { CheckCircle2, Eye, Forward, ListChecks } from "lucide-react";

/** Etiqueta visual del "tipo de acción" de una tarea (qué hay que hacer con ella). */
const ACTION_META: Record<string, { label: string; icon: typeof Eye; cls: string }> = {
  propia: { label: "La hacemos", icon: CheckCircle2, cls: "text-muted-foreground bg-muted" },
  seguimiento: { label: "Seguimiento", icon: Eye, cls: "text-amber-700 bg-amber-500/12 dark:text-amber-400" },
  derivar: { label: "Derivada", icon: Forward, cls: "text-blue-700 bg-blue-500/12 dark:text-blue-400" },
  registro: { label: "Registro", icon: ListChecks, cls: "text-purple-700 bg-purple-500/12 dark:text-purple-400" },
};

export function TaskActionTypeBadge({
  actionType,
  className,
  // "propia" no aporta info; por defecto no se muestra.
  hidePropia = true,
}: {
  actionType?: string | null;
  className?: string;
  hidePropia?: boolean;
}) {
  const key = actionType || "propia";
  if (hidePropia && key === "propia") return null;
  const meta = ACTION_META[key];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium", meta.cls, className)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}
