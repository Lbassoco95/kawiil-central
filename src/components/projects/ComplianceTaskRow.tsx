import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useProfiles } from "@/hooks/useTasks";
import { UnifiedStepRow } from "./UnifiedStepRow";
import type { AccountingStep, StepStatus } from "@/hooks/useAccountingPeriods";

import { PERIODICITY_LABELS } from "@/lib/statusStyles";

// Map compliance task status to step status
const STATUS_MAP: Record<string, StepStatus> = {
  pendiente: "pendiente",
  en_progreso: "en_progreso",
  en_revision: "en_espera_cliente",
  completada: "completado",
};
const REVERSE_STATUS_MAP: Record<StepStatus, string> = {
  pendiente: "pendiente",
  en_progreso: "en_progreso",
  en_espera_cliente: "en_revision",
  completado: "completada",
};

export interface ComplianceTaskRowProps {
  task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_date: string | null;
    assigned_to: string | null;
    compliance_periodicity: string | null;
    compliance_period: string | null;
    checklist?: any;
    dropbox_links?: any;
    time_spent_seconds?: number;
    started_at?: string | null;
    completed_at?: string | null;
    created_by?: string | null;
  };
  projectId: string;
  clientDropboxPath?: string;
  urgencyBadge: React.ReactNode;
  onUpdate: () => void;
  index?: number;
}

export function ComplianceTaskRow({ task, projectId, clientDropboxPath, urgencyBadge, onUpdate, index = 0 }: ComplianceTaskRowProps) {
  const queryClient = useQueryClient();
  const { data: profiles = [] } = useProfiles();

  // Load collaborators and document IDs
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [documentIds, setDocumentIds] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      const [colRes, docRes] = await Promise.all([
        supabase.from("task_assignees").select("user_id").eq("task_id", task.id),
        supabase.from("documents").select("id").eq("task_id", task.id),
      ]);
      if (colRes.data) setCollaborators(colRes.data.map((d) => d.user_id));
      if (docRes.data) setDocumentIds(docRes.data.map((d) => d.id));
    };
    load();
  }, [task.id]);

  // Get creator name
  const creatorName = task.created_by
    ? profiles.find((p) => p.user_id === task.created_by)?.full_name || null
    : null;

  // Convert task to AccountingStep format
  const step: AccountingStep = {
    key: task.id,
    label: task.title,
    completed: task.status === "completada",
    completed_at: task.completed_at || null,
    completed_by: null,
    step_status: STATUS_MAP[task.status] || "pendiente",
    due_date: task.due_date || null,
    started_at: task.started_at || null,
    notes: task.description || null,
    document_ids: documentIds,
    time_spent_seconds: task.time_spent_seconds || 0,
    assigned_to: task.assigned_to || null,
    collaborators,
    checklist: Array.isArray(task.checklist) ? task.checklist : [],
    created_by_name: creatorName,
  };

  const handleToggle = async (checked: boolean) => {
    const newStatus = checked ? "completada" : "pendiente";
    await supabase.from("tasks").update({
      status: newStatus,
      completed_at: checked ? new Date().toISOString() : null,
    } as any).eq("id", task.id);
    onUpdate();
  };

  const handleSave = async (updates: Partial<AccountingStep>) => {
    const taskUpdates: Record<string, any> = {};

    if (updates.label !== undefined) taskUpdates.title = updates.label;
    if (updates.step_status !== undefined) taskUpdates.status = REVERSE_STATUS_MAP[updates.step_status!] || "pendiente";
    if (updates.due_date !== undefined) taskUpdates.due_date = updates.due_date ? updates.due_date.split("T")[0] : null;
    if (updates.notes !== undefined) taskUpdates.description = updates.notes;
    if (updates.assigned_to !== undefined) taskUpdates.assigned_to = updates.assigned_to;
    if (updates.time_spent_seconds !== undefined) taskUpdates.time_spent_seconds = updates.time_spent_seconds;
    if (updates.started_at !== undefined) taskUpdates.started_at = updates.started_at;
    if (updates.checklist !== undefined) taskUpdates.checklist = updates.checklist;

    if (Object.keys(taskUpdates).length > 0) {
      await supabase.from("tasks").update(taskUpdates as any).eq("id", task.id);
    }

    // Update collaborators if changed
    if (updates.collaborators !== undefined) {
      await supabase.from("task_assignees").delete().eq("task_id", task.id);
      if (updates.collaborators.length > 0) {
        await supabase.from("task_assignees").insert(
          updates.collaborators.map((uid) => ({ task_id: task.id, user_id: uid }))
        );
      }
    }

    // Link new documents to this task
    if (updates.document_ids !== undefined) {
      const newIds = updates.document_ids.filter((id) => !documentIds.includes(id));
      for (const docId of newIds) {
        await supabase.from("documents").update({ task_id: task.id }).eq("id", docId);
      }
      setDocumentIds(updates.document_ids);
    }

    onUpdate();
    queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
  };

  // Extra badges for compliance-specific info
  const extraFields = (
    <div className="flex flex-wrap gap-1.5">
      {task.compliance_periodicity && (
        <Badge variant="outline" className="text-[10px]">
          {PERIODICITY_LABELS[task.compliance_periodicity] || task.compliance_periodicity}
        </Badge>
      )}
      {task.compliance_period && (
        <Badge variant="secondary" className="text-[10px]">
          {task.compliance_period}
        </Badge>
      )}
      {urgencyBadge}
    </div>
  );

  return (
    <UnifiedStepRow
      step={step}
      index={index}
      projectId={projectId}
      clientDropboxPath={clientDropboxPath}
      showTimer={true}
      showCheckbox={true}
      commentStepKey={`compliance_${task.id}`}
      onToggle={handleToggle}
      onSave={handleSave}
      extraFields={extraFields}
    />
  );
}
