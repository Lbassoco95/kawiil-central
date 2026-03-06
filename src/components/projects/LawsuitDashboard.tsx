import { useState } from "react";
import { DropboxFilePicker } from "./DropboxFilePicker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
}

interface LawsuitDeadline {
  id: string;
  title: string;
  date: string;
  type: string;
  completed: boolean;
  notes: string;
}

interface LawsuitDetails {
  lawsuit_type: string;
  case_number: string | null;
  court: string | null;
  plaintiff: string | null;
  defendant: string | null;
  stages: LawsuitStage[];
  deadlines: LawsuitDeadline[];
}

interface LawsuitDashboardProps {
  projectId: string;
  lawsuitDetails: LawsuitDetails;
  dropboxInitialPath?: string | null;
  lockDropboxToInitialPath?: boolean;
}

const STAGE_STATUS_OPTIONS = [
  { value: "pendiente", label: "Pendiente", color: "bg-muted text-muted-foreground" },
  { value: "en_progreso", label: "En progreso", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  { value: "completado", label: "Completado", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  { value: "no_aplica", label: "No aplica", color: "bg-muted text-muted-foreground line-through" },
];

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

export function LawsuitDashboard({ projectId, lawsuitDetails, dropboxInitialPath, lockDropboxToInitialPath = false }: LawsuitDashboardProps) {
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [deadlineDialogOpen, setDeadlineDialogOpen] = useState(false);
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [attachmentDialogOpen, setAttachmentDialogOpen] = useState<string | null>(null);
  const [dropboxPickerStage, setDropboxPickerStage] = useState<string | null>(null);
  const [newDeadline, setNewDeadline] = useState({ title: "", date: "", type: "termino", notes: "" });
  const [newStageTemplate, setNewStageTemplate] = useState("contestacion");
  const [newStageCustomLabel, setNewStageCustomLabel] = useState("");
  const [newAttachment, setNewAttachment] = useState({ name: "", url: "" });
  const queryClient = useQueryClient();

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
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const updateStageStatus = (key: string, status: string) => {
    const updated = {
      ...lawsuitDetails,
      stages: lawsuitDetails.stages.map((s) =>
        s.key === key
          ? { ...s, status, completed_at: status === "completado" ? new Date().toISOString() : null }
          : s
      ),
    };
    updateLawsuit.mutate(updated);
  };

  const updateStageField = (key: string, field: "date" | "notes", value: string) => {
    const updated = {
      ...lawsuitDetails,
      stages: lawsuitDetails.stages.map((s) =>
        s.key === key ? { ...s, [field]: value || null } : s
      ),
    };
    updateLawsuit.mutate(updated);
  };

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
    };
    const updated = { ...lawsuitDetails, stages: [...lawsuitDetails.stages, newStage] };
    updateLawsuit.mutate(updated);
    setStageDialogOpen(false);
    setNewStageCustomLabel("");
    toast.success("Etapa agregada");
  };

  const removeStage = (key: string) => {
    const updated = {
      ...lawsuitDetails,
      stages: lawsuitDetails.stages.filter((s) => s.key !== key),
    };
    updateLawsuit.mutate(updated);
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
    const updated = {
      ...lawsuitDetails,
      stages: lawsuitDetails.stages.map((s) =>
        s.key === stageKey
          ? { ...s, attachments: [...(s.attachments || []), attachment] }
          : s
      ),
    };
    updateLawsuit.mutate(updated);
    setNewAttachment({ name: "", url: "" });
    setAttachmentDialogOpen(null);
    toast.success("Archivo vinculado");
  };

  const removeAttachment = (stageKey: string, attachmentId: string) => {
    const updated = {
      ...lawsuitDetails,
      stages: lawsuitDetails.stages.map((s) =>
        s.key === stageKey
          ? { ...s, attachments: (s.attachments || []).filter((a) => a.id !== attachmentId) }
          : s
      ),
    };
    updateLawsuit.mutate(updated);
  };

  const addDeadline = () => {
    if (!newDeadline.title || !newDeadline.date) return;
    const dl: LawsuitDeadline = {
      id: crypto.randomUUID(),
      ...newDeadline,
      completed: false,
    };
    const updated = { ...lawsuitDetails, deadlines: [...(lawsuitDetails.deadlines || []), dl] };
    updateLawsuit.mutate(updated);
    setNewDeadline({ title: "", date: "", type: "termino", notes: "" });
    setDeadlineDialogOpen(false);
    toast.success("Término agregado");
  };

  const toggleDeadline = (id: string) => {
    const updated = {
      ...lawsuitDetails,
      deadlines: (lawsuitDetails.deadlines || []).map((d) =>
        d.id === id ? { ...d, completed: !d.completed } : d
      ),
    };
    updateLawsuit.mutate(updated);
  };

  const removeDeadline = (id: string) => {
    const updated = {
      ...lawsuitDetails,
      deadlines: (lawsuitDetails.deadlines || []).filter((d) => d.id !== id),
    };
    updateLawsuit.mutate(updated);
  };

  const completedStages = lawsuitDetails.stages.filter((s) => s.status === "completado").length;
  const totalStages = lawsuitDetails.stages.filter((s) => s.status !== "no_aplica").length;
  const upcomingDeadlines = (lawsuitDetails.deadlines || [])
    .filter((d) => !d.completed)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const urgentDeadlines = upcomingDeadlines.filter(
    (d) => isBefore(new Date(d.date), addDays(new Date(), 7))
  );

  return (
    <div className="space-y-6">
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
          <div className="flex justify-between">
            <span className="text-muted-foreground">Juzgado/Tribunal</span>
            <span className="text-right">{lawsuitDetails.court || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">No. Expediente</span>
            <span>{lawsuitDetails.case_number || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Actor</span>
            <span>{lawsuitDetails.plaintiff || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Demandado</span>
            <span>{lawsuitDetails.defendant || "—"}</span>
          </div>
        </CardContent>
      </Card>

      {/* Procedural stages */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Etapas procesales</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setStageDialogOpen(true)}>
            <Plus className="h-3 w-3 mr-1" /> Agregar etapa
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          {lawsuitDetails.stages.map((stage) => {
            const statusOpt = STAGE_STATUS_OPTIONS.find((s) => s.value === stage.status);
            const isExpanded = expandedStage === stage.key;
            const attachments = stage.attachments || [];

            return (
              <Collapsible
                key={stage.key}
                open={isExpanded}
                onOpenChange={() => setExpandedStage(isExpanded ? null : stage.key)}
              >
                <CollapsibleTrigger className="flex items-center w-full gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors text-left">
                  {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  <span className={`flex-1 text-sm font-medium ${stage.status === "no_aplica" ? "line-through text-muted-foreground" : ""}`}>
                    {stage.label}
                  </span>
                  {attachments.length > 0 && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Link2 className="h-3 w-3" />
                      {attachments.length}
                    </span>
                  )}
                  {stage.date && (
                    <span className="text-xs text-muted-foreground">
                      {formatMX(stage.date, "dd MMM yyyy")}
                    </span>
                  )}
                  <Badge variant="outline" className={`text-xs ${statusOpt?.color}`}>
                    {statusOpt?.label}
                  </Badge>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-10 pr-3 pb-3 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Estado</Label>
                      <Select
                        value={stage.status}
                        onValueChange={(v) => updateStageStatus(stage.key, v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STAGE_STATUS_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Fecha</Label>
                      <Input
                        type="date"
                        className="h-8 text-xs"
                        value={stage.date || ""}
                        onChange={(e) => updateStageField(stage.key, "date", e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Notas</Label>
                    <Textarea
                      className="text-xs min-h-[60px]"
                      placeholder="Notas de esta etapa..."
                      value={stage.notes || ""}
                      onChange={(e) => updateStageField(stage.key, "notes", e.target.value)}
                    />
                  </div>

                  {/* Attachments section */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs flex items-center gap-1">
                        <FolderOpen className="h-3 w-3" /> Archivos vinculados
                      </Label>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAttachmentDialogOpen(stage.key);
                        }}
                      >
                        <Plus className="h-3 w-3 mr-1" /> Agregar link
                      </Button>
                    </div>
                    {attachments.length > 0 ? (
                      <div className="space-y-1">
                        {attachments.map((att) => (
                          <div
                            key={att.id}
                            className="flex items-center gap-2 rounded border px-2 py-1.5 text-xs bg-muted/30"
                          >
                            {att.type === "dropbox" ? (
                              <FolderOpen className="h-3 w-3 text-blue-500 shrink-0" />
                            ) : (
                              <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />
                            )}
                            <span className="flex-1 truncate">{att.name}</span>
                            <a
                              href={att.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeAttachment(stage.key, att.id);
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">Sin archivos vinculados</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    {stage.completed_at && (
                      <p className="text-xs text-muted-foreground">
                        Completado: {formatMX(stage.completed_at, "dd/MM/yyyy HH:mm")}
                      </p>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-destructive hover:text-destructive ml-auto"
                      onClick={() => removeStage(stage.key)}
                    >
                      <Trash2 className="h-3 w-3 mr-1" /> Eliminar etapa
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </CardContent>
      </Card>

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
            <div className="space-y-2">
              {[...lawsuitDetails.deadlines]
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map((dl) => {
                  const dlDate = new Date(dl.date);
                  const isOverdue = !dl.completed && isPast(dlDate) && !isToday(dlDate);
                  const isUrgent = !dl.completed && isBefore(dlDate, addDays(new Date(), 3));

                  return (
                    <div
                      key={dl.id}
                      className={`flex items-center gap-3 rounded-md border p-3 ${
                        dl.completed ? "opacity-50" : isOverdue ? "border-destructive bg-destructive/5" : isUrgent ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10" : ""
                      }`}
                    >
                      <button
                        className={`shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          dl.completed ? "bg-green-500 border-green-500 text-white" : "border-muted-foreground"
                        }`}
                        onClick={() => toggleDeadline(dl.id)}
                      >
                        {dl.completed && <CheckCircle2 className="h-3 w-3" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${dl.completed ? "line-through" : ""}`}>
                            {dl.title}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {DEADLINE_TYPE_LABELS[dl.type] || dl.type}
                          </Badge>
                        </div>
                        {dl.notes && (
                          <p className="text-xs text-muted-foreground mt-0.5">{dl.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1 text-xs">
                          {isOverdue && <AlertTriangle className="h-3 w-3 text-destructive" />}
                          {isUrgent && !isOverdue && <Clock className="h-3 w-3 text-yellow-600" />}
                          <span className={isOverdue ? "text-destructive font-medium" : "text-muted-foreground"}>
                            {formatMX(dlDate, "dd MMM yyyy")}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => removeDeadline(dl.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
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
              ...lawsuitDetails,
              stages: lawsuitDetails.stages.map((s) =>
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
            {/* Dropbox browse button */}
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha *</Label>
                <Input
                  type="date"
                  value={newDeadline.date}
                  onChange={(e) => setNewDeadline((p) => ({ ...p, date: e.target.value }))}
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
