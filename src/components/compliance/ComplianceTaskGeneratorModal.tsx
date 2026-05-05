import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Shield,
  AlertTriangle,
  Landmark,
  ShieldCheck,
  Users,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import {
  useComplianceTemplates,
  useGenerateComplianceTasks,
  type ComplianceTaskTemplate,
} from "@/hooks/useCompliance";

const CATEGORY_LABELS: Record<string, string> = {
  reportes_uif: "Reportes al SAT/UIF",
  reportes_cnbv: "Reportes a CNBV",
  reportes_banxico: "Reportes Banxico",
  reportes_condusef: "Reportes Condusef",
  fiscal: "Obligaciones SAT/Fiscal",
  gobierno_corporativo: "Gobierno corporativo",
  capacitacion: "Capacitación",
  kyc: "KYC / Expedientes",
  politicas: "Políticas y manuales",
  auditoria: "Auditoría",
  avisos_sat: "Avisos al SAT",
  conservacion: "Conservación",
};

const CATEGORY_ICONS: Partial<Record<string, LucideIcon>> = {
  reportes_banxico: Landmark,
  reportes_condusef: ShieldCheck,
  gobierno_corporativo: Users,
  fiscal: Receipt,
};

/** Orden de secciones en el modal (categorías desconocidas al final por nombre). */
const CATEGORY_SORT_ORDER = Object.keys(CATEGORY_LABELS);

const PERIODICITY_LABELS: Record<string, string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  cuando_aplique: "Cuando aplique",
};

interface ComplianceTaskGeneratorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  entityTypeIds: string[];
  responsibleUserId: string;
  /** Si existe, las tareas llevan contexto regulatorio (folio, entidad, etc.) y `client_id`. */
  clientId?: string | null;
  onGenerated?: () => void;
}

export function ComplianceTaskGeneratorModal({
  open,
  onOpenChange,
  projectId,
  entityTypeIds,
  responsibleUserId,
  clientId,
  onGenerated,
}: ComplianceTaskGeneratorModalProps) {
  const { data: templates = [] } = useComplianceTemplates(entityTypeIds);
  const generateTasks = useGenerateComplianceTasks();
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const groups: Record<string, typeof templates> = {};
    for (const t of templates) {
      const cat = t.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    }
    return Object.entries(groups).sort(([a], [b]) => {
      const ia = CATEGORY_SORT_ORDER.indexOf(a);
      const ib = CATEGORY_SORT_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b, "es");
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [templates]);

  const selectedTemplates = templates.filter((t) => !deselected.has(t.id));

  // Estimate total tasks (considering periodicity)
  const estimatedTotal = useMemo(() => {
    let count = 0;
    for (const t of selectedTemplates) {
      switch (t.periodicity) {
        case "mensual": count += 12; break;
        case "trimestral": count += 4; break;
        case "semestral": count += 2; break;
        case "anual": count += 1; break;
        case "cuando_aplique": count += 1; break;
      }
    }
    return count;
  }, [selectedTemplates]);

  const toggleTemplate = (id: string) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleGenerate = async () => {
    await generateTasks.mutateAsync({
      projectId,
      templates: selectedTemplates,
      responsibleUserId,
      clientId: clientId ?? undefined,
    });
    onOpenChange(false);
    onGenerated?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Generar tareas de cumplimiento
          </DialogTitle>
        </DialogHeader>

        <div className="text-sm text-muted-foreground mb-2">
          Se generarán <strong>{estimatedTotal}</strong> tareas para el año{" "}
          <strong>{new Date().getFullYear()}</strong>.
          {clientId
            ? " En cada tarea se añade el contexto regulatorio del cliente (tipos de entidad, folio, fechas) tomado de la ficha Cumplimiento."
            : " Vincula el proyecto al cliente para incluir folio y tipo de entidad en las descripciones de las tareas."}{" "}
          Desmarca las obligaciones que no apliquen.
        </div>

        <ScrollArea className="max-h-[50vh]">
          <div className="space-y-4 pr-4">
            {grouped.map(([category, tpls]) => {
              const CategoryIcon = CATEGORY_ICONS[category];
              return (
              <div key={category}>
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  {CategoryIcon ? (
                    <CategoryIcon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                  ) : null}
                  {CATEGORY_LABELS[category] || category}
                </h4>
                <div className="space-y-1">
                  {tpls.map((tpl) => (
                    <label
                      key={tpl.id}
                      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={!deselected.has(tpl.id)}
                        onCheckedChange={() => toggleTemplate(tpl.id)}
                      />
                      <span className="flex-1">{tpl.task_name}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {PERIODICITY_LABELS[tpl.periodicity] || tpl.periodicity}
                      </Badge>
                    </label>
                  ))}
                </div>
              </div>
              );
            })}
          </div>
        </ScrollArea>

        {templates.length === 0 && (
          <div className="flex items-start gap-2 text-sm text-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 dark:text-yellow-400 rounded-md p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              No hay plantillas en el catálogo para los tipos de entidad seleccionados. Puedes crear tareas manualmente
              en el tab Tareas del proyecto o subir un documento de referencia en Documentos y registrar obligaciones
              una a una.
            </span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={generateTasks.isPending || selectedTemplates.length === 0}
          >
            {generateTasks.isPending
              ? "Generando..."
              : `Confirmar y crear ${estimatedTotal} tareas`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
