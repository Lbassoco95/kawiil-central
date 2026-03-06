import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Receipt,
  KeyRound,
  Send,
  Save,
  CheckCircle2,
  Clock,
  AlertCircle,
  ClipboardList,
  Phone,
  CalendarClock,
  User,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDateMX } from "@/lib/dateUtils";
import { StepAssigneeSelect, useProfileName } from "./StepAssigneeSelect";
import { StepFileManager } from "./StepFileManager";
import { useProfiles } from "@/hooks/useTasks";

interface GestoriaStep {
  key: string;
  label: string;
  description: string;
  icon: string;
  phase: number;
  status: "pendiente" | "en_progreso" | "completado";
  completed_at: string | null;
  notes: string;
  appointment_date?: string | null;
  assigned_to?: string | null;
  due_date?: string | null;
  document_ids?: string[];
}

const PHASES = [
  { number: 1, label: "Documentación y requisitos previos" },
  { number: 2, label: "Trámite de RFC" },
  { number: 3, label: "Trámite de e.firma" },
  { number: 4, label: "Entrega" },
];

const DEFAULT_STEPS: GestoriaStep[] = [
  { key: "documentacion", label: "Recopilación de documentación", description: "Integrar documentos de identidad del contribuyente, acta constitutiva (persona moral), poder notarial y demás requisitos.", icon: "FileText", phase: 1, status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "comprobante_domicilio_rfc", label: "Comprobante de domicilio para RFC", description: "Estado de cuenta bancario a nombre del contribuyente o comprobante de teléfono. Requerido para la inscripción al RFC cuando hay un socio nacional.", icon: "FileText", phase: 1, status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "contratacion_linea", label: "Contratación de línea telefónica", description: "Contratar línea telefónica fija o móvil a nombre del contribuyente para generar el comprobante de domicilio requerido para la e.firma.", icon: "Phone", phase: 1, status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "recibo_linea", label: "Recibo de línea telefónica generado", description: "Verificar que ya se generó el recibo/comprobante de la línea contratada. Sin este documento no se puede agendar la cita para e.firma.", icon: "FileText", phase: 1, status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "cita_rfc", label: "Agendar cita ante el SAT (RFC)", description: "Solicitar cita en el SAT a través del gestor para realizar la inscripción al RFC.", icon: "CalendarClock", phase: 2, status: "pendiente", completed_at: null, notes: "", appointment_date: null, assigned_to: null, due_date: null, document_ids: [] },
  { key: "obtencion_rfc", label: "Obtención del RFC", description: "Acudir a la cita y completar la inscripción al Registro Federal de Contribuyentes.", icon: "Receipt", phase: 2, status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "cita_efirma", label: "Agendar cita ante el SAT (e.firma)", description: "Solicitar cita en el SAT a través del gestor para obtener la firma electrónica. Requiere tener el recibo de línea telefónica.", icon: "CalendarClock", phase: 3, status: "pendiente", completed_at: null, notes: "", appointment_date: null, assigned_to: null, due_date: null, document_ids: [] },
  { key: "obtencion_efirma", label: "Obtención de e.firma (FIEL)", description: "Acudir a la cita y completar el trámite de firma electrónica avanzada.", icon: "KeyRound", phase: 3, status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "entrega_final", label: "Entrega de documentos y acuses", description: "Entregar al cliente los documentos, acuses, constancia de RFC y archivos de e.firma obtenidos.", icon: "Send", phase: 4, status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
];

const ICON_MAP: Record<string, React.ElementType> = { FileText, Receipt, KeyRound, Send, Phone, CalendarClock };

const STATUS_CONFIG = {
  pendiente: { label: "Pendiente", class: "bg-muted text-muted-foreground", icon: Clock },
  en_progreso: { label: "En progreso", class: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", icon: AlertCircle },
  completado: { label: "Completado", class: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", icon: CheckCircle2 },
};

interface Props {
  projectId: string;
  gestoriaDetails: { steps: GestoriaStep[] } | null;
}

export function GestoriaDashboard({ projectId, gestoriaDetails }: Props) {
  const queryClient = useQueryClient();
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const { data: profiles = [] } = useProfiles();

  const steps: GestoriaStep[] = gestoriaDetails?.steps ?? DEFAULT_STEPS;
  const completedCount = steps.filter((s) => s.status === "completado").length;
  const progressPct = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;

  const saveMutation = useMutation({
    mutationFn: async (updatedSteps: GestoriaStep[]) => {
      const { error } = await supabase
        .from("projects")
        .update({ constitution_details: { steps: updatedSteps } } as any)
        .eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
      toast.success("Progreso guardado");
    },
    onError: (e: Error) => toast.error("Error: " + e.message),
  });

  const updateStep = (key: string, updates: Partial<GestoriaStep>) => {
    const updated = steps.map((s) =>
      s.key === key
        ? {
            ...s,
            ...updates,
            completed_at: updates.status === "completado" ? new Date().toISOString() : updates.status !== undefined ? null : s.completed_at,
          }
        : s
    );
    saveMutation.mutate(updated);
  };

  const initializeSteps = () => saveMutation.mutate(DEFAULT_STEPS);

  if (!gestoriaDetails) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <div>
            <h3 className="font-semibold text-foreground">Módulo de Gestoría</h3>
            <p className="text-sm text-muted-foreground mt-1">Inicia el seguimiento del trámite de RFC y firma electrónica.</p>
          </div>
          <Button onClick={initializeSteps}>
            <ClipboardList className="mr-2 h-4 w-4" /> Iniciar proceso de gestoría
          </Button>
        </CardContent>
      </Card>
    );
  }

  const getAssigneeName = (userId: string | null | undefined) => {
    if (!userId) return null;
    return profiles.find((p) => p.user_id === userId)?.full_name?.split(" ")[0] || null;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Progreso de gestoría</h3>
            <span className="text-sm font-medium text-muted-foreground">{completedCount}/{steps.length} pasos</span>
          </div>
          <Progress value={progressPct} className="h-2" />
        </CardContent>
      </Card>

      {PHASES.map((phase) => {
        const phaseSteps = steps.filter((s) => s.phase === phase.number);
        if (phaseSteps.length === 0) return null;
        const phaseCompleted = phaseSteps.every((s) => s.status === "completado");

        return (
          <div key={phase.number} className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <Badge variant={phaseCompleted ? "default" : "outline"} className={`text-xs ${phaseCompleted ? "bg-green-600 text-white" : ""}`}>
                Fase {phase.number}
              </Badge>
              <h4 className="text-sm font-semibold text-foreground">{phase.label}</h4>
            </div>

            {phaseSteps.map((step) => {
              const IconComp = ICON_MAP[step.icon] || FileText;
              const statusCfg = STATUS_CONFIG[step.status];
              const StatusIcon = statusCfg.icon;
              const isOpen = expandedStep === step.key;
              const globalIdx = steps.findIndex((s) => s.key === step.key);
              const hasAppointment = step.appointment_date !== undefined;
              const assigneeName = getAssigneeName(step.assigned_to);

              return (
                <Collapsible key={step.key} open={isOpen} onOpenChange={() => setExpandedStep(isOpen ? null : step.key)}>
                  <Card className={step.status === "completado" ? "opacity-75" : ""}>
                    <CollapsibleTrigger asChild>
                      <CardContent className="p-4 cursor-pointer hover:bg-muted/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted shrink-0">
                            <span className="text-xs font-bold text-muted-foreground">{globalIdx + 1}</span>
                          </div>
                          <IconComp className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-medium text-foreground truncate">{step.label}</h4>
                            <p className="text-xs text-muted-foreground truncate hidden sm:block">{step.description}</p>
                          </div>
                          {assigneeName && (
                            <Badge variant="outline" className="text-xs shrink-0 gap-1">
                              <User className="h-3 w-3" />{assigneeName}
                            </Badge>
                          )}
                          {step.due_date && (
                            <Badge variant="outline" className="text-xs shrink-0 bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                              {formatDateMX(step.due_date)}
                            </Badge>
                          )}
                          {hasAppointment && step.appointment_date && (
                            <Badge variant="outline" className="text-xs shrink-0 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                              <CalendarClock className="h-3 w-3 mr-1" />{formatDateMX(step.appointment_date)}
                            </Badge>
                          )}
                          <Badge variant="outline" className={`text-xs shrink-0 ${statusCfg.class}`}>
                            <StatusIcon className="h-3 w-3 mr-1" />{statusCfg.label}
                          </Badge>
                          {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                        </div>
                      </CardContent>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-4 pb-4 space-y-3 border-t pt-3">
                        <p className="text-sm text-muted-foreground">{step.description}</p>
                        {step.completed_at && <p className="text-xs text-muted-foreground">Completado: {formatDateMX(step.completed_at)}</p>}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <StepAssigneeSelect
                            value={step.assigned_to || null}
                            onChange={(userId) => updateStep(step.key, { assigned_to: userId })}
                            disabled={saveMutation.isPending}
                          />
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Fecha límite</label>
                            <div className="flex gap-2 items-center">
                              <Input
                                type="date"
                                className="text-sm h-8"
                                defaultValue={step.due_date || ""}
                                id={`gestoria-due-${step.key}`}
                              />
                              <Button size="sm" variant="outline" className="h-8" disabled={saveMutation.isPending}
                                onClick={() => {
                                  const el = document.getElementById(`gestoria-due-${step.key}`) as HTMLInputElement;
                                  if (el) updateStep(step.key, { due_date: el.value || null });
                                }}>
                                <Save className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </div>

                        {hasAppointment && (
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                              <CalendarClock className="h-3 w-3" /> Fecha y hora de cita
                            </label>
                            <div className="flex gap-2 items-center">
                              <Input type="datetime-local" className="text-sm w-auto" defaultValue={step.appointment_date || ""} id={`appointment-${step.key}`} />
                              <Button size="sm" variant="outline" disabled={saveMutation.isPending}
                                onClick={() => {
                                  const el = document.getElementById(`appointment-${step.key}`) as HTMLInputElement;
                                  if (el) updateStep(step.key, { appointment_date: el.value || null });
                                }}>
                                <Save className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          {(["pendiente", "en_progreso", "completado"] as const).map((st) => (
                            <Button key={st} size="sm" variant={step.status === st ? "default" : "outline"} className="text-xs"
                              onClick={() => updateStep(step.key, { status: st })} disabled={saveMutation.isPending}>
                              {STATUS_CONFIG[st].label}
                            </Button>
                          ))}
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Notas</label>
                          <div className="flex gap-2">
                            <Textarea className="text-sm min-h-[60px]" placeholder="Agregar notas..." defaultValue={step.notes} id={`gestoria-notes-${step.key}`} />
                            <Button size="sm" variant="outline" className="shrink-0 self-end" disabled={saveMutation.isPending}
                              onClick={() => {
                                const el = document.getElementById(`gestoria-notes-${step.key}`) as HTMLTextAreaElement;
                                if (el) updateStep(step.key, { notes: el.value });
                              }}>
                              <Save className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>

                        <StepFileManager
                          documentIds={step.document_ids || []}
                          onDocumentAdded={(newIds) => updateStep(step.key, { document_ids: newIds })}
                          projectId={projectId}
                          disabled={saveMutation.isPending}
                        />
                      </div>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
