import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  useToggleAnnualStep,
  useUpdateAnnualStepDetails,
} from "@/hooks/useAnnualDeclarations";
import type { AccountingStep, StepStatus } from "@/hooks/useAccountingPeriods";
import { STEP_STATUS_OPTIONS } from "@/hooks/useAccountingPeriods";

const STEP_STATUS_STYLES: Record<StepStatus, string> = {
  pendiente: "bg-muted text-muted-foreground",
  en_progreso: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  en_espera_cliente: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  completado: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

export function AnnualStepDetailRow({
  step,
  index,
  declarationId,
  projectId,
}: {
  step: AccountingStep;
  index: number;
  declarationId: string;
  projectId: string;
}) {
  const [open, setOpen] = useState(false);
  const toggleStep = useToggleAnnualStep();
  const updateDetails = useUpdateAnnualStepDetails();

  const stepStatus = step.step_status || "pendiente";
  const statusStyle = STEP_STATUS_STYLES[stepStatus] || STEP_STATUS_STYLES.pendiente;

  const handleToggle = (checked: boolean) => {
    toggleStep.mutate({
      declarationId,
      projectId,
      stepKey: step.key,
      completed: checked,
    });
  };

  const handleStatusChange = (value: string) => {
    updateDetails.mutate({
      declarationId,
      projectId,
      stepKey: step.key,
      updates: { step_status: value as StepStatus },
    });
  };

  const handleNotesBlur = (value: string) => {
    if (value !== (step.notes || "")) {
      updateDetails.mutate({
        declarationId,
        projectId,
        stepKey: step.key,
        updates: { notes: value || null },
      });
    }
  };

  const handleDateChange = (value: string) => {
    updateDetails.mutate({
      declarationId,
      projectId,
      stepKey: step.key,
      updates: { date: value || null },
    });
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "rounded-lg border px-3 py-2 transition-colors",
          step.completed ? "bg-muted/40" : "bg-background"
        )}
      >
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-3 cursor-pointer">
            <Checkbox
              checked={step.completed}
              onCheckedChange={(checked) => {
                handleToggle(!!checked);
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <span
              className={cn(
                "flex-1 text-sm",
                step.completed && "line-through text-muted-foreground"
              )}
            >
              {index + 1}. {step.label}
            </span>
            <Badge variant="outline" className={cn("text-xs", statusStyle)}>
              {STEP_STATUS_OPTIONS.find((o) => o.value === stepStatus)?.label || "Pendiente"}
            </Badge>
            {step.notes && <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                open && "rotate-180"
              )}
            />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 ml-7 space-y-3 pb-1">
            <div className="flex gap-3 flex-wrap">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Estado</label>
                <Select value={stepStatus} onValueChange={handleStatusChange}>
                  <SelectTrigger className="h-8 text-xs w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STEP_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Fecha</label>
                <Input
                  type="date"
                  className="h-8 text-xs w-40"
                  defaultValue={step.date || ""}
                  onChange={(e) => handleDateChange(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Notas</label>
              <Textarea
                className="text-xs min-h-[60px]"
                placeholder="Agregar notas..."
                defaultValue={step.notes || ""}
                onBlur={(e) => handleNotesBlur(e.target.value)}
              />
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
