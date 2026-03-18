import { useToggleAnnualStep, useUpdateAnnualStepDetails } from "@/hooks/useAnnualDeclarations";
import type { AccountingStep, StepStatus } from "@/hooks/useAccountingPeriods";
import { UnifiedStepRow } from "./UnifiedStepRow";
import { useQueryClient } from "@tanstack/react-query";

export function AnnualStepDetailRow({
  step, index, declarationId, projectId, clientDropboxPath, clientId,
}: {
  step: AccountingStep;
  index: number;
  declarationId: string;
  projectId: string;
  clientDropboxPath?: string;
  clientId?: string;
}) {
  const toggleStep = useToggleAnnualStep();
  const updateDetails = useUpdateAnnualStepDetails();
  const queryClient = useQueryClient();

  return (
    <UnifiedStepRow
      step={step}
      index={index}
      projectId={projectId}
      clientDropboxPath={clientDropboxPath}
      clientId={clientId}
      showTimer={false}
      onToggle={(checked) => toggleStep.mutate({ declarationId, projectId, stepKey: step.key, completed: checked })}
      onSave={(updates) => {
        updateDetails.mutate(
          { declarationId, projectId, stepKey: step.key, updates },
          { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assigned-steps"] }) }
        );
      }}
      saving={updateDetails.isPending}
    />
  );
}
