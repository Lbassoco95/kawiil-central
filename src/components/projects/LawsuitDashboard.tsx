import { useState, useEffect, useCallback } from "react";
import { DropboxFilePicker } from "./DropboxFilePicker";
import { StepComments } from "./StepComments";
import { sendSlackNotification } from "@/lib/slackNotifications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DebouncedTextarea } from "@/components/shared/DebouncedTextarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  ChevronDown,
  ChevronRight,
  Scale,
  Calendar,
  Plus,
  Trash2,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Link2,
  ExternalLink,
  FolderOpen,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isPast, isToday, addDays, isBefore } from "date-fns";
import { formatMX } from "@/lib/dateUtils";
import { StepAssigneeSelect } from "./StepAssigneeSelect";
import { StepFileManager } from "./StepFileManager";
import { CriticalityDelayCard } from "./CriticalityDelayCard";
import { UnifiedStepRow } from "./UnifiedStepRow";
import { ProjectPhaseStageCard } from "./ProjectPhaseStageCard";
import type { AccountingStep, StepStatus } from "@/hooks/useAccountingPeriods";

import { useProfiles } from "@/hooks/useTasks";
import { UserOrTextMulti } from "./UserOrTextInput";

interface StageAttachment {
  id: string;
  type: "dropbox" | "link";
  name: string;
  url: string;
}

interface LawsuitStage {
  key: string;
  label: string;
  status: string;
  date: string | null;
  notes: string;
  completed_at: string | null;
  attachments?: StageAttachment[];
  assigned_to?: string | null;
  collaborators?: string[];
  document_ids?: string[];
  due_date?: string | null;
  started_at?: string | null;
  time_spent_seconds?: number;
  checklist?: any[];
}

interface LawsuitDeadline {
  id: string;
  title: string;
  date: string;
  time: string;
  type: string;
  completed: boolean;
  notes: string;
  attendees: string[];
  assigned_to?: string | null;
  document_ids?: string[];
}

interface LawsuitDetails {
  lawsuit_type: string;
  case_number: string | null;
  court: string | null;
  plaintiff: string | null;
  defendant: string | null;
  lead_attorney?: string | null;
  substitute_attorney?: string | null;
  authorized_persons?: string[];
  stages: LawsuitStage[];
  deadlines: LawsuitDeadline[];
}

interface LawsuitDashboardProps {
  projectId: string;
  lawsuitDetails: LawsuitDetails;
  dropboxInitialPath?: string | null;
  lockDropboxToInitialPath?: boolean;
  clientId?: string;
}

const STAGE_TEMPLATES = [
  { value: "demanda", label: "Demanda" },
  { value: "contestacion", label: "Contestación" },
  { value: "reconvencion", label: "Reconvención" },
  { value: "pruebas", label: "Ofrecimiento de pruebas" },
  { value: "desahogo", label: "Desahogo de pruebas" },
  { value: "alegatos", label: "Alegatos" },
  { value: "sentencia", label: "Sentencia" },
  { value: "apelacion", label: "Apelación" },
  { value: "amparo", label: "Amparo" },
  { value: "ejecucion", label: "Ejecución" },
  { value: "audiencia", label: "Audiencia" },
  { value: "requerimiento", label: "Requerimiento" },
  { value: "notificacion", label: "Notificación" },
  { value: "incidente", label: "Incidente" },
  { value: "recurso", label: "Recurso" },
  { value: "custom", label: "Personalizada..." },
];

const DEADLINE_TYPE_LABELS: Record<string, string> = {
  termino: "Término",
  audiencia: "Audiencia",
  entrega: "Entrega de documentos",
  vencimiento: "Vencimiento",
};

const LAWSUIT_TYPE_LABELS: Record<string, string> = {
  laboral: "Laboral",
  mercantil: "Mercantil",
  civil: "Civil",
  fiscal: "Fiscal",
  penal: "Penal",
  administrativo: "Administrativo",
  familiar: "Familiar",
};

// Map lawsuit stage status to AccountingStep status
const STAGE_STATUS_TO_STEP: Record<string, StepStatus> = {
  pendiente: "pendiente",
  en_progreso: "en_progreso",
  completado: "completado",
  no_aplica: "completado",
};

export function LawsuitDashboard({ projectId, lawsuitDetails, dropboxInitialPath, lockDropboxToInitialPath = false, clientId }: LawsuitDashboardProps) {
  const [expandedDeadline, setExpandedDeadline] = useState<string | null>(null);
  const [deadlineDialogOpen, setDeadlineDialogOpen] = useState(false);
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [attachmentDialogOpen, setAttachmentDialogOpen] = useState<string | null>(null);
  const [dropboxPickerStage, setDropboxPickerStage] = useState<string | null>(null);
  const [newDeadline, setNewDeadline] = useState({ title: "", date: "", time: "", type: "termino", notes: "", attendees: [] as string[] });
  
  const [newStageTemplate, setNewStageTemplate] = useState("contestacion");
  const [newStageCustomLabel, setNewStageCustomLabel] = useState("");
  const [newAttachment, setNewAttachment] = useState({ name: "", url: "" });

  // Local editable fields for case info
  const [localCourt, setLocalCourt] = useState(lawsuitDetails.court || "");
  const [localCaseNumber, setLocalCaseNumber] = useState(lawsuitDetails.case_number || "");
  const [localPlaintiff, setLocalPlaintiff] = useState(lawsuitDetails.plaintiff || "");
  const [localDefendant, setLocalDefendant] = useState(lawsuitDetails.defendant || "");

  useEffect(() => {
    setLocalCourt(lawsuitDetails.court || "");
    setLocalCaseNumber(lawsuitDetails.case_number || "");
    setLocalPlaintiff(lawsuitDetails.plaintiff || "");
    setLocalDefendant(lawsuitDetails.defendant || "");
  }, [lawsuitDetails.court, lawsuitDetails.case_number, lawsuitDetails.plaintiff, lawsuitDetails.defendant]);
  const queryClient = useQueryClient();
  const { data: profiles = [] } = useProfiles();

  // Local source of truth — useState so UI re-renders from it
  const [localDetails, setLocalDetails] = useState<LawsuitDetails>(lawsuitDetails);

  // Sync from props only when no mutation is in flight (prevents stale overwrites)
  useEffect(() => {
    if (!updateLawsuit.isPending && !updateLawsuitWithName.isPending) {
      setLocalDetails(lawsuitDetails);
    }
  }, [lawsuitDetails]);

  const persistDetails = useCallback((updated: LawsuitDetails, alsoUpdateName = false) => {
    setLocalDetails(updated); // Optimistic update
    if (alsoUpdateName) {
      const typeLabel = LAWSUIT_TYPE_LABELS[updated.lawsuit_type] || updated.lawsuit_type;
      const opponent = updated.defendant || updated.plaintiff || "";
      updateLawsuitWithName.mutate({ details: updated, opponent, typeLabel });
    } else {
      updateLawsuit.mutate(updated);
    }
  }, []);

  const updateLawsuit = useMutation({
    mutationFn: async (updated: LawsuitDetails) => {
      const { error } = await supabase
        .from("projects")
        .update({ lawsuit_details: updated } as any)
        .eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const updateLawsuitWithName = useMutation({
    mutationFn: async ({ details, opponent, typeLabel }: { details: LawsuitDetails; opponent: string; typeLabel: string }) => {
      // Fetch current project to rebuild name with client
      const { data: proj } = await supabase
        .from("projects")
        .select("name, clients(name)")
        .eq("id", projectId)
        .single();
      const clientName = (proj as any)?.clients?.name || "Sin cliente";
      const newName = opponent
        ? `Juicio ${typeLabel} - ${clientName} vs ${opponent}`
        : `Juicio ${typeLabel} - ${clientName}`;
      const { error } = await supabase
        .from("projects")
        .update({ lawsuit_details: details, name: newName } as any)
        .eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const addStage = () => {
    const template = STAGE_TEMPLATES.find((t) => t.value === newStageTemplate);
    const label = newStageTemplate === "custom" ? newStageCustomLabel : template?.label || newStageTemplate;
    if (!label.trim()) return;

    const newStage: LawsuitStage = {
      key: `${newStageTemplate}_${Date.now()}`,
      label,
      status: "pendiente",
      date: null,
      notes: "",
      completed_at: null,
      attachments: [],
      checklist: [],
    };
    const current = localDetails;
    persistDetails({ ...current, stages: [...current.stages, newStage] });
    setStageDialogOpen(false);
    setNewStageCustomLabel("");
    toast.success("Etapa agregada");
  };

  const removeStage = (key: string) => {
    const current = localDetails;
    persistDetails({
      ...current,
      stages: current.stages.filter((s) => s.key !== key),
    });
    toast.success("Etapa eliminada");
  };

  const addAttachment = (stageKey: string) => {
    if (!newAttachment.name || !newAttachment.url) return;
    const attachment: StageAttachment = {
      id: crypto.randomUUID(),
      type: newAttachment.url.includes("dropbox.com") ? "dropbox" : "link",
      name: newAttachment.name,
      url: newAttachment.url,
    };
    const current = localDetails;
    persistDetails({
      ...current,
      stages: current.stages.map((s) =>
        s.key === stageKey
          ? { ...s, attachments: [...(s.attachments || []), attachment] }
          : s
      ),
    });
    setNewAttachment({ name: "", url: "" });
    setAttachmentDialogOpen(null);
    toast.success("Archivo vinculado");
  };

  const removeAttachment = (stageKey: string, attachmentId: string) => {
    const current = localDetails;
    persistDetails({
      ...current,
      stages: current.stages.map((s) =>
        s.key === stageKey
          ? { ...s, attachments: (s.attachments || []).filter((a) => a.id !== attachmentId) }
          : s
      ),
    });
  };

  const addDeadline = () => {
    if (!newDeadline.title || !newDeadline.date) return;
    const dl: LawsuitDeadline = {
      id: crypto.randomUUID(),
      ...newDeadline,
      completed: false,
      document_ids: [],
    };
    const current = localDetails;
    persistDetails({ ...current, deadlines: [...(current.deadlines || []), dl] });

    if (dl.attendees.length > 0 || dl.assigned_to) {
      sendSlackNotification("deadline_created" as any, {
        title: dl.title,
        date: dl.date,
        time: dl.time || "Sin hora",
        type: DEADLINE_TYPE_LABELS[dl.type] || dl.type,
        attendees: dl.attendees.join(", ") || "Sin asistentes",
        assigned_to: dl.assigned_to ? profiles.find(p => p.user_id === dl.assigned_to)?.full_name || "N/A" : "Sin asignar",
      });
    }

    setNewDeadline({ title: "", date: "", time: "", type: "termino", notes: "", attendees: [] });
    setDeadlineDialogOpen(false);
    toast.success("Término agregado");
  };

  const toggleDeadline = (id: string) => {
    const current = localDetails;
    persistDetails({
      ...current,
      deadlines: (current.deadlines || []).map((d) =>
        d.id === id ? { ...d, completed: !d.completed } : d
      ),
    });
  };

  const removeDeadline = (id: string) => {
    const current = localDetails;
    persistDetails({
      ...current,
      deadlines: (current.deadlines || []).filter((d) => d.id !== id),
    });
  };

  const updateDeadlineField = (id: string, field: string, value: any) => {
    const current = localDetails;
    persistDetails({
      ...current,
      deadlines: (current.deadlines || []).map((d) =>
        d.id === id ? { ...d, [field]: value } : d
      ),
    });
  };

  // Convert LawsuitStage to AccountingStep for UnifiedStepRow
  const stageToStep = (stage: LawsuitStage): AccountingStep => ({
    key: stage.key,
    label: stage.label,
    completed: stage.status === "completado",
    completed_at: stage.completed_at || null,
    completed_by: null,
    step_status: STAGE_STATUS_TO_STEP[stage.status] || "pendiente",
    due_date: stage.due_date || stage.date || null,
    started_at: stage.started_at || null,
    notes: stage.notes || null,
    document_ids: stage.document_ids || [],
    time_spent_seconds: stage.time_spent_seconds || 0,
    assigned_to: stage.assigned_to || null,
    collaborators: stage.collaborators || [],
    checklist: stage.checklist || [],
  });

  const handleStageSave = (stageKey: string, updates: Partial<AccountingStep>) => {
    const current = localDetails;
    const updatedStages = current.stages.map((s) => {
      if (s.key !== stageKey) return s;
      const merged = { ...s } as any;
      if (updates.label !== undefined) merged.label = updates.label;
      if (updates.step_status !== undefined) {
        // Map back to lawsuit status
        const reverseMap: Record<string, string> = {
          pendiente: "pendiente",
          en_progreso: "en_progreso",
          en_espera_cliente: "en_progreso",
          completado: "completado",
        };
        merged.status = reverseMap[updates.step_status] || "pendiente";
        if (updates.step_status === "completado") {
          merged.completed_at = new Date().toISOString();
        } else {
          merged.completed_at = null;
        }
      }
      if (updates.due_date !== undefined) {
        merged.due_date = updates.due_date;
        // Mantener `date` alineado: la lista "Mis pasos" y datos legacy leían solo `date`.
        merged.date = updates.due_date;
      }
      if (updates.notes !== undefined) merged.notes = updates.notes || "";
      if (updates.assigned_to !== undefined) merged.assigned_to = updates.assigned_to;
      if (updates.collaborators !== undefined) merged.collaborators = updates.collaborators;
      if (updates.document_ids !== undefined) merged.document_ids = updates.document_ids;
      if (updates.time_spent_seconds !== undefined) merged.time_spent_seconds = updates.time_spent_seconds;
      if (updates.started_at !== undefined) merged.started_at = updates.started_at;
      if (updates.checklist !== undefined) merged.checklist = updates.checklist;
      return merged;
    });
    persistDetails({ ...current, stages: updatedStages });
  };

  const lawsuitStageCardMetrics = (stage: LawsuitStage) => {
    if (stage.status === "completado" || stage.status === "no_aplica") {
      return { pct: 100, completed: 1, total: 1 };
    }
    if (stage.status === "en_progreso") {
      return { pct: 50, completed: 0, total: 1 };
    }
    return { pct: 0, completed: 0, total: 1 };
  };

  const handleStageToggle = (stageKey: string, completed: boolean) => {
    const current = localDetails;
    const updatedStages = current.stages.map((s) =>
      s.key === stageKey
        ? { ...s, status: completed ? "completado" : "pendiente", completed_at: completed ? new Date().toISOString() : null }
        : s
    );
    persistDetails({ ...current, stages: updatedStages });
  };

  const completedStages = localDetails.stages.filter((s) => s.status === "completado").length;
  const totalStages = localDetails.stages.filter((s) => s.status !== "no_aplica").length;
  const upcomingDeadlines = (localDetails.deadlines || [])
    .filter((d) => !d.completed)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const urgentDeadlines = upcomingDeadlines.filter(
    (d) => isBefore(new Date(d.date), addDays(new Date(), 7))
  );

  return (
    <div className="space-y-6">
      <CriticalityDelayCard projectId={projectId} />
      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Scale className="h-4 w-4" />
              <span>Tipo</span>
            </div>
            <p className="text-lg font-semibold mt-1">
              {LAWSUIT_TYPE_LABELS[lawsuitDetails.lawsuit_type] || lawsuitDetails.lawsuit_type}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Expediente</span>
            </div>
            <p className="text-lg font-semibold mt-1">{lawsuitDetails.case_number || "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" />
              <span>Avance</span>
            </div>
            <p className="text-lg font-semibold mt-1">
              {completedStages}/{totalStages} etapas
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {urgentDeadlines.length > 0 ? (
                <AlertTriangle className="h-4 w-4 text-destructive" />
              ) : (
                <Calendar className="h-4 w-4" />
              )}
              <span>Términos próximos</span>
            </div>
            <p className={`text-lg font-semibold mt-1 ${urgentDeadlines.length > 0 ? "text-destructive" : ""}`}>
              {urgentDeadlines.length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Case info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos del juicio</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Juzgado/Tribunal</span>
            <Input
              className="w-2/3 h-8 text-sm text-right"
              value={localCourt}
              onChange={(e) => setLocalCourt(e.target.value)}
              onBlur={() => {
                const current = localDetails;
                if (localCourt !== (current.court || "")) {
                  persistDetails({ ...current, court: localCourt || null });
                }
              }}
              placeholder="—"
            />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">No. Expediente</span>
            <Input
              className="w-2/3 h-8 text-sm text-right"
              value={localCaseNumber}
              onChange={(e) => setLocalCaseNumber(e.target.value)}
              onBlur={() => {
                const current = localDetails;
                if (localCaseNumber !== (current.case_number || "")) {
                  persistDetails({ ...current, case_number: localCaseNumber || null });
                }
              }}
              placeholder="—"
            />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Actor</span>
            <Input
              className="w-2/3 h-8 text-sm text-right"
              value={localPlaintiff}
              onChange={(e) => setLocalPlaintiff(e.target.value)}
              onBlur={() => {
                const current = localDetails;
                if (localPlaintiff !== (current.plaintiff || "")) {
                  persistDetails({ ...current, plaintiff: localPlaintiff || null }, true);
                }
              }}
              placeholder="—"
            />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Demandado</span>
            <Input
              className="w-2/3 h-8 text-sm text-right"
              value={localDefendant}
              onChange={(e) => setLocalDefendant(e.target.value)}
              onBlur={() => {
                const current = localDetails;
                if (localDefendant !== (current.defendant || "")) {
                  persistDetails({ ...current, defendant: localDefendant || null }, true);
                }
              }}
              placeholder="—"
            />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Abogado Patrono</span>
            <span>{lawsuitDetails.lead_attorney || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Abogado Sustituto</span>
            <span>{lawsuitDetails.substitute_attorney || "—"}</span>
          </div>
          {(lawsuitDetails.authorized_persons || []).length > 0 && (
            <div className="col-span-full">
              <span className="text-muted-foreground">Autorizados: </span>
              <span>{(lawsuitDetails.authorized_persons || []).join(", ")}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Etapas procesales — mismo diseño de fases que el resto del sistema (tab Tareas) */}
      <div className="space-y-3">
        <div className="flex flex-row items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Etapas procesales</h3>
          <Button size="sm" variant="outline" onClick={() => setStageDialogOpen(true)}>
            <Plus className="h-3 w-3 mr-1" /> Agregar etapa
          </Button>
        </div>
        <div className="space-y-3">
          {localDetails.stages.map((stage, idx) => {
            const attachments = stage.attachments || [];
            const metrics = lawsuitStageCardMetrics(stage);

            const stageExtraFields = (
              <div className="space-y-3">
                {/* Legacy attachments */}
                {attachments.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs flex items-center gap-1"><FolderOpen className="h-3 w-3" /> Links vinculados</Label>
                    <div className="space-y-1">
                      {attachments.map((att) => (
                        <div key={att.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-xs bg-muted/30">
                          {att.type === "dropbox" ? <FolderOpen className="h-3 w-3 text-blue-500 shrink-0" /> : <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />}
                          <span className="flex-1 truncate">{att.name}</span>
                          <a href={att.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0" onClick={(e) => e.stopPropagation()}><ExternalLink className="h-3 w-3" /></a>
                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={(e) => { e.stopPropagation(); removeAttachment(stage.key, att.id); }}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={(e) => { e.stopPropagation(); setAttachmentDialogOpen(stage.key); }}>
                  <Plus className="h-3 w-3 mr-1" /> Agregar link externo
                </Button>
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => removeStage(stage.key)}>
                    <Trash2 className="h-3 w-3 mr-1" /> Eliminar etapa
                  </Button>
                </div>
              </div>
            );

            return (
              <ProjectPhaseStageCard
                key={stage.key}
                colorIndex={idx}
                title={`${idx + 1}. ${stage.label}`}
                progressPercent={metrics.pct}
                completedCount={metrics.completed}
                totalCount={metrics.total}
                defaultOpen={stage.status !== "completado"}
              >
                <UnifiedStepRow
                  step={stageToStep(stage)}
                  index={idx}
                  projectId={projectId}
                  clientDropboxPath={dropboxInitialPath || undefined}
                  clientId={clientId}
                  showTimer={true}
                  showCheckbox={true}
                  onToggle={(checked) => handleStageToggle(stage.key, checked)}
                  onSave={(updates) => handleStageSave(stage.key, updates)}
                  saving={updateLawsuit.isPending}
                  extraFields={stageExtraFields}
                  rootClassName="border-border/50 shadow-sm"
                />
              </ProjectPhaseStageCard>
            );
          })}
        </div>
      </div>

      {/* Deadlines / Términos */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Términos y fechas clave</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setDeadlineDialogOpen(true)}>
            <Plus className="h-3 w-3 mr-1" /> Agregar
          </Button>
        </CardHeader>
        <CardContent>
          {(!lawsuitDetails.deadlines || lawsuitDetails.deadlines.length === 0) ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Sin términos registrados. Agrega fechas importantes del proceso.
            </p>
          ) : (
            <div className="space-y-1">
              {[...lawsuitDetails.deadlines]
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map((dl) => {
                  const dlDate = new Date(dl.date);
                  const isOverdue = !dl.completed && isPast(dlDate) && !isToday(dlDate);
                  const isUrgent = !dl.completed && isBefore(dlDate, addDays(new Date(), 3));
                  const isExpanded = expandedDeadline === dl.id;

                  return (
                    <Collapsible
                      key={dl.id}
                      open={isExpanded}
                      onOpenChange={() => setExpandedDeadline(isExpanded ? null : dl.id)}
                    >
                      <div className={`rounded-md border ${
                        dl.completed ? "opacity-50" : isOverdue ? "border-destructive bg-destructive/5" : isUrgent ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10" : ""
                      }`}>
                        <CollapsibleTrigger className="flex items-center w-full gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left">
                          {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                          <button
                            className={`shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                              dl.completed ? "bg-accent border-accent text-accent-foreground" : "border-muted-foreground"
                            }`}
                            onClick={(e) => { e.stopPropagation(); toggleDeadline(dl.id); }}
                          >
                            {dl.completed && <CheckCircle2 className="h-3 w-3" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-medium ${dl.completed ? "line-through" : ""}`}>
                                {dl.title}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {DEADLINE_TYPE_LABELS[dl.type] || dl.type}
                              </Badge>
                              {dl.time && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Clock className="h-3 w-3" /> {dl.time}
                                </span>
                              )}
                              {(dl.document_ids || []).length > 0 && (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Link2 className="h-3 w-3" />
                                  {(dl.document_ids || []).length}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isOverdue && <AlertTriangle className="h-3 w-3 text-destructive" />}
                            {isUrgent && !isOverdue && <Clock className="h-3 w-3 text-yellow-600" />}
                            <span className={`text-xs ${isOverdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                              {formatMX(dlDate, "dd MMM yyyy")}
                            </span>
                          </div>
                        </CollapsibleTrigger>

                        <CollapsibleContent className="px-3 pb-3 pt-1 space-y-3 ml-9">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <StepAssigneeSelect
                              value={dl.assigned_to || null}
                              onChange={(userId) => updateDeadlineField(dl.id, "assigned_to", userId)}
                            />
                            <div className="space-y-1">
                              <Label className="text-xs">Fecha</Label>
                              <Input type="date" className="h-8 text-xs" value={dl.date} onChange={(e) => updateDeadlineField(dl.id, "date", e.target.value)} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Hora</Label>
                              <Input type="time" className="h-8 text-xs" value={dl.time || ""} onChange={(e) => updateDeadlineField(dl.id, "time", e.target.value)} />
                            </div>
                          </div>

                          {/* Attendees */}
                          <div className="space-y-2">
                            <Label className="text-xs">¿Quiénes asistirán?</Label>
                            <UserOrTextMulti
                              values={dl.attendees || []}
                              onChange={(vals) => updateDeadlineField(dl.id, "attendees", vals)}
                              profiles={profiles.map((p) => ({ user_id: p.user_id, full_name: p.full_name }))}
                              placeholder="Nombre o seleccionar usuario..."
                            />
                          </div>

                          <div className="space-y-1">
                            <Label className="text-xs">Notas</Label>
                            <DebouncedTextarea className="text-xs min-h-[60px]" placeholder="Notas del término..." value={dl.notes || ""} onChange={(val) => updateDeadlineField(dl.id, "notes", val)} />
                          </div>

                          {/* Step Comments */}
                          <StepComments projectId={projectId} stepKey={`deadline_${dl.id}`} stepLabel={dl.title} />

                          {/* File management */}
                          <StepFileManager
                            documentIds={dl.document_ids || []}
                            onDocumentAdded={(newIds) => updateDeadlineField(dl.id, "document_ids", newIds)}
                            projectId={projectId}
                            clientDropboxPath={dropboxInitialPath || undefined}
                          />

                          <div className="flex items-center justify-end pt-3 mt-2 border-t border-border">
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => removeDeadline(dl.id)}>
                              <Trash2 className="h-3 w-3 mr-1" /> Eliminar
                            </Button>
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add stage dialog */}
      <Dialog open={stageDialogOpen} onOpenChange={setStageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar etapa procesal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Tipo de etapa *</Label>
              <Select value={newStageTemplate} onValueChange={setNewStageTemplate}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGE_TEMPLATES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {newStageTemplate === "custom" && (
              <div className="space-y-2">
                <Label>Nombre de la etapa *</Label>
                <Input
                  placeholder="Ej: Segunda contestación"
                  value={newStageCustomLabel}
                  onChange={(e) => setNewStageCustomLabel(e.target.value)}
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStageDialogOpen(false)}>Cancelar</Button>
              <Button
                onClick={addStage}
                disabled={newStageTemplate === "custom" && !newStageCustomLabel.trim()}
              >
                Agregar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dropbox file picker */}
      <DropboxFilePicker
        open={!!dropboxPickerStage}
        initialPath={dropboxInitialPath || ""}
        lockToInitialPath={Boolean(lockDropboxToInitialPath && dropboxInitialPath?.trim())}
        onClose={() => setDropboxPickerStage(null)}
        onSelect={(file) => {
          if (dropboxPickerStage) {
            const attachment = {
              id: crypto.randomUUID(),
              type: "dropbox" as const,
              name: file.name,
              url: file.url,
            };
            const updated = {
              ...localDetails,
              stages: localDetails.stages.map((s) =>
                s.key === dropboxPickerStage
                  ? { ...s, attachments: [...(s.attachments || []), attachment] }
                  : s
              ),
            };
            updateLawsuit.mutate(updated);
            toast.success("Archivo de Dropbox vinculado");
          }
        }}
      />

      {/* Add attachment dialog */}
      <Dialog open={!!attachmentDialogOpen} onOpenChange={() => setAttachmentDialogOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular archivo o link</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Pega un enlace manualmente o busca directamente en Dropbox.
          </p>
          <div className="space-y-4 pt-2">
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={() => {
                const stageKey = attachmentDialogOpen;
                setAttachmentDialogOpen(null);
                setDropboxPickerStage(stageKey);
              }}
            >
              <FolderOpen className="h-4 w-4" />
              Buscar en Dropbox
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">o pegar link</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Nombre del archivo *</Label>
              <Input
                placeholder="Ej: Escrito de contestación"
                value={newAttachment.name}
                onChange={(e) => setNewAttachment((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>URL / Link *</Label>
              <Input
                placeholder="https://www.dropbox.com/..."
                value={newAttachment.url}
                onChange={(e) => setNewAttachment((p) => ({ ...p, url: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAttachmentDialogOpen(null)}>Cancelar</Button>
              <Button
                onClick={() => attachmentDialogOpen && addAttachment(attachmentDialogOpen)}
                disabled={!newAttachment.name || !newAttachment.url}
              >
                Vincular
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add deadline dialog */}
      <Dialog open={deadlineDialogOpen} onOpenChange={setDeadlineDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar término / fecha clave</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Título *</Label>
              <Input
                placeholder="Ej: Término para contestar demanda"
                value={newDeadline.title}
                onChange={(e) => setNewDeadline((p) => ({ ...p, title: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Fecha *</Label>
                <Input
                  type="date"
                  value={newDeadline.date}
                  onChange={(e) => setNewDeadline((p) => ({ ...p, date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Hora</Label>
                <Input
                  type="time"
                  value={newDeadline.time}
                  onChange={(e) => setNewDeadline((p) => ({ ...p, time: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={newDeadline.type}
                  onValueChange={(v) => setNewDeadline((p) => ({ ...p, type: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DEADLINE_TYPE_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Attendees */}
            <div className="space-y-2">
              <Label>¿Quiénes asistirán?</Label>
              <UserOrTextMulti
                values={newDeadline.attendees || []}
                onChange={(vals) => setNewDeadline((p) => ({ ...p, attendees: vals }))}
                profiles={profiles.map((p) => ({ user_id: p.user_id, full_name: p.full_name }))}
                placeholder="Nombre o seleccionar usuario..."
              />
            </div>

            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea
                placeholder="Detalles adicionales..."
                value={newDeadline.notes}
                onChange={(e) => setNewDeadline((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeadlineDialogOpen(false)}>Cancelar</Button>
              <Button onClick={addDeadline} disabled={!newDeadline.title || !newDeadline.date}>
                Agregar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
