import {
  useToggleAccountingStep, useUpdateStepDetails,
  type AccountingStep,
} from "@/hooks/useAccountingPeriods";
import { UnifiedStepRow } from "./UnifiedStepRow";
import { useQueryClient } from "@tanstack/react-query";

interface StepDetailRowProps {
  step: AccountingStep;
  index: number;
  periodId: string;
  projectId: string;
  clientDropboxPath?: string;
}

export function StepDetailRow({ step, index, periodId, projectId, clientDropboxPath }: StepDetailRowProps) {
  const toggleStep = useToggleAccountingStep();
  const updateDetails = useUpdateStepDetails();
  const queryClient = useQueryClient();

  return (
    <UnifiedStepRow
      step={step}
      index={index}
      projectId={projectId}
      clientDropboxPath={clientDropboxPath}
      showTimer={true}
      onToggle={(checked) => toggleStep.mutate({ periodId, projectId, stepKey: step.key, completed: checked })}
      onSave={(updates) => {
        updateDetails.mutate(
          { periodId, projectId, stepKey: step.key, updates },
          { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assigned-steps"] }) }
        );
      }}
      saving={updateDetails.isPending}
    />
  );
}
