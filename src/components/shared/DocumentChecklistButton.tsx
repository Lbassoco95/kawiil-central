import { Button } from "@/components/ui/button";
import { FilePlus } from "lucide-react";
import { toast } from "sonner";
import type { ChecklistItem } from "@/hooks/useAccountingPeriods";
import { buildDocumentChecklistAdditions } from "@/lib/documentChecklist";

interface Props {
  /** Checklist actual del paso/tarea. */
  checklist: ChecklistItem[];
  /** Recibe el checklist completo ya con los documentos agregados. */
  onInsert: (updated: ChecklistItem[]) => void;
  /** Responsable a heredar en los ítems nuevos. */
  assignedTo?: string | null;
  disabled?: boolean;
  className?: string;
}

/**
 * Botón reutilizable "Insertar checklist de documentos": agrega la lista
 * estándar de documentos requeridos como ítems de checklist (solo para
 * palomear, sin crear tareas). No duplica los que ya existan por texto.
 * Disponible en cualquier paso (UnifiedStepRow) y tarea (TaskDetailDialog).
 */
export function DocumentChecklistButton({ checklist, onInsert, assignedTo, disabled, className }: Props) {
  const handleInsert = () => {
    const additions = buildDocumentChecklistAdditions(checklist, assignedTo ?? null, Date.now());
    if (additions.length === 0) {
      toast.info("El checklist de documentos ya está agregado");
      return;
    }
    onInsert([...checklist, ...additions]);
    toast.success(`${additions.length} documento(s) agregados al checklist`);
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={className}
      disabled={disabled}
      onClick={handleInsert}
    >
      <FilePlus className="h-3.5 w-3.5 mr-1" /> Insertar checklist de documentos
    </Button>
  );
}
