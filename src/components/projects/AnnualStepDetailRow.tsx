import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronDown, FileText, Save, User } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  useToggleAnnualStep, useUpdateAnnualStepDetails,
} from "@/hooks/useAnnualDeclarations";
import type { AccountingStep, StepStatus } from "@/hooks/useAccountingPeriods";
import { STEP_STATUS_OPTIONS } from "@/hooks/useAccountingPeriods";
import { StepAssigneeSelect } from "./StepAssigneeSelect";
import { StepFileManager } from "./StepFileManager";
import { useProfiles } from "@/hooks/useTasks";
import { useQueryClient } from "@tanstack/react-query";

const STEP_STATUS_STYLES: Record<StepStatus, string> = {
  pendiente: "bg-muted text-muted-foreground",
  en_progreso: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  en_espera_cliente: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  completado: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

export function AnnualStepDetailRow({
  step, index, declarationId, projectId,
}: {
  step: AccountingStep;
  index: number;
  declarationId: string;
  projectId: string;
}) {
  const [open, setOpen] = useState(false);
  const [localStatus, setLocalStatus] = useState(step.step_status || "pendiente");
  const [localDate, setLocalDate] = useState(step.date || "");
  const [localNotes, setLocalNotes] = useState(step.notes || "");
  const [localAssignee, setLocalAssignee] = useState<string | null>(step.assigned_to || null);
  const [hasChanges, setHasChanges] = useState(false);
  const toggleStep = useToggleAnnualStep();
  const updateDetails = useUpdateAnnualStepDetails();
  const { data: profiles = [] } = useProfiles();
  const queryClient = useQueryClient();

  const statusStyle = STEP_STATUS_STYLES[localStatus as StepStatus] || STEP_STATUS_STYLES.pendiente;
  const assigneeName = localAssignee ? profiles.find((p) => p.user_id === localAssignee)?.full_name?.split(" ")[0] : null;

  const handleToggle = (checked: boolean) => {
    toggleStep.mutate({ declarationId, projectId, stepKey: step.key, completed: checked });
  };

  const markChanged = () => setHasChanges(true);

  const handleSave = () => {
    updateDetails.mutate(
      {
        declarationId, projectId, stepKey: step.key,
        updates: {
          step_status: localStatus as StepStatus,
          date: localDate || null,
          notes: localNotes || null,
          assigned_to: localAssignee,
        },
      },
      {
        onSuccess: () => {
          setHasChanges(false);
          queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
        },
      }
    );
  };

  const handleDocumentAdded = (newIds: string[]) => {
    updateDetails.mutate({
      declarationId, projectId, stepKey: step.key,
      updates: { document_ids: newIds },
    });
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={cn("rounded-lg border px-3 py-2 transition-colors", step.completed ? "bg-muted/40" : "bg-background")}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-3 cursor-pointer">
            <Checkbox
              checked={step.completed}
              onCheckedChange={(checked) => handleToggle(!!checked)}
              onClick={(e) => e.stopPropagation()}
            />
            <span className={cn("flex-1 text-sm", step.completed && "line-through text-muted-foreground")}>
              {index + 1}. {step.label}
            </span>
            {assigneeName && (
              <Badge variant="outline" className="text-xs gap-1"><User className="h-3 w-3" />{assigneeName}</Badge>
            )}
            <Badge variant="outline" className={cn("text-xs", statusStyle)}>
              {STEP_STATUS_OPTIONS.find((o) => o.value === localStatus)?.label || "Pendiente"}
            </Badge>
            {(step.document_ids?.length || 0) > 0 && (
              <Badge variant="secondary" className="text-xs gap-1"><FileText className="h-3 w-3" />{step.document_ids?.length}</Badge>
            )}
            {step.notes && <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 ml-7 space-y-3 pb-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StepAssigneeSelect value={localAssignee} onChange={(v) => { setLocalAssignee(v); markChanged(); }} />
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Estado</label>
                <Select value={localStatus} onValueChange={(v) => { setLocalStatus(v as StepStatus); markChanged(); }}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STEP_STATUS_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Fecha</label>
                <Input type="date" className="h-8 text-xs" value={localDate} onChange={(e) => { setLocalDate(e.target.value); markChanged(); }} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Notas</label>
              <Textarea className="text-xs min-h-[60px]" placeholder="Agregar notas..." value={localNotes} onChange={(e) => { setLocalNotes(e.target.value); markChanged(); }} />
            </div>

            <StepFileManager
              documentIds={step.document_ids || []}
              onDocumentAdded={handleDocumentAdded}
              projectId={projectId}
            />

            <div className="flex justify-end">
              <Button size="sm" onClick={handleSave} disabled={!hasChanges || updateDetails.isPending}>
                <Save className="h-4 w-4 mr-1" />Guardar
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
