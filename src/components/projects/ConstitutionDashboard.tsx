import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown, ChevronRight, FileText, Building2, Stamp, PenLine, Home,
  Receipt, KeyRound, Landmark, BookOpen, Globe, Save, CheckCircle2, Clock,
  AlertCircle, Phone, CalendarClock, User,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDateMX } from "@/lib/dateUtils";
import { StepAssigneeSelect } from "./StepAssigneeSelect";
import { StepFileManager } from "./StepFileManager";
import { useProfiles } from "@/hooks/useTasks";

interface ConstitutionStep {
  key: string;
  label: string;
  description: string;
  icon: string;
  status: "pendiente" | "en_progreso" | "completado";
  completed_at: string | null;
  notes: string;
  conditional?: boolean;
  appointment_date?: string | null;
  assigned_to?: string | null;
  due_date?: string | null;
  document_ids?: string[];
}

const DEFAULT_STEPS: ConstitutionStep[] = [
  { key: "documentacion_socios", label: "Recopilación de documentación de socios", description: "Integrar documentos de identidad, poderes y datos de los socios/accionistas.", icon: "FileText", status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "envio_notaria", label: "Envío de información a notaría", description: "Enviar la documentación completa de socios a la notaría para iniciar el proceso.", icon: "Building2", status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "proyecto_constitucion", label: "Proyecto de constitución", description: "La notaría prepara el proyecto de acta constitutiva para revisión.", icon: "Stamp", status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "firma_socios", label: "Firma de socios", description: "Los socios firman el acta constitutiva ante notario.", icon: "PenLine", status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "contratacion_linea", label: "Contratación de línea telefónica", description: "Contratar línea telefónica fija o móvil a nombre de la empresa para generar comprobante de domicilio requerido para la e.firma.", icon: "Phone", status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "recibo_comprobante", label: "Comprobante de domicilio generado", description: "Verificar que ya se generó el recibo de la línea contratada.", icon: "Home", status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "cita_rfc", label: "Agendar cita ante el SAT (RFC)", description: "El gestor solicita cita en el SAT para la inscripción al RFC.", icon: "CalendarClock", status: "pendiente", completed_at: null, notes: "", appointment_date: null, assigned_to: null, due_date: null, document_ids: [] },
  { key: "obtencion_rfc", label: "Obtención del RFC", description: "Acudir a la cita y completar la inscripción al Registro Federal de Contribuyentes ante el SAT.", icon: "Receipt", status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "cita_efirma", label: "Agendar cita ante el SAT (e.firma)", description: "El gestor solicita cita en el SAT para obtener la firma electrónica.", icon: "CalendarClock", status: "pendiente", completed_at: null, notes: "", appointment_date: null, assigned_to: null, due_date: null, document_ids: [] },
  { key: "firma_electronica", label: "Obtención de e.firma (FIEL)", description: "Acudir a la cita y completar el trámite de firma electrónica avanzada del SAT.", icon: "KeyRound", status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "cuenta_bancaria", label: "Alta de cuenta bancaria", description: "Apertura de cuenta bancaria corporativa.", icon: "Landmark", status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "registro_rpc", label: "Registro ante el RPC (boleta)", description: "Inscripción en el Registro Público de Comercio para obtener la boleta de registro.", icon: "BookOpen", status: "pendiente", completed_at: null, notes: "", assigned_to: null, due_date: null, document_ids: [] },
  { key: "inscripcion_rnie", label: "Inscripción al RNIE", description: "Registro Nacional de Inversiones Extranjeras (aplica cuando hay socios extranjeros).", icon: "Globe", status: "pendiente", completed_at: null, notes: "", conditional: true, assigned_to: null, due_date: null, document_ids: [] },
];

const ICON_MAP: Record<string, React.ElementType> = { FileText, Building2, Stamp, PenLine, Home, Receipt, KeyRound, Landmark, BookOpen, Globe, Phone, CalendarClock };

const STATUS_CONFIG = {
  pendiente: { label: "Pendiente", class: "bg-muted text-muted-foreground", icon: Clock },
  en_progreso: { label: "En progreso", class: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", icon: AlertCircle },
  completado: { label: "Completado", class: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", icon: CheckCircle2 },
};

interface Props {
  projectId: string;
  constitutionDetails: { steps: ConstitutionStep[]; has_foreign_partners: boolean } | null;
  responsibleUserId?: string | null;
}

export function ConstitutionDashboard({ projectId, constitutionDetails, responsibleUserId }: Props) {
  const queryClient = useQueryClient();
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const { data: profiles = [] } = useProfiles();

  const steps: ConstitutionStep[] = constitutionDetails?.steps ?? DEFAULT_STEPS;
  const hasForeignPartners = constitutionDetails?.has_foreign_partners ?? true;
  const visibleSteps = steps.filter((s) => !s.conditional || hasForeignPartners);
  const completedCount = visibleSteps.filter((s) => s.status === "completado").length;
  const progressPct = visibleSteps.length > 0 ? Math.round((completedCount / visibleSteps.length) * 100) : 0;

  const saveMutation = useMutation({
    mutationFn: async (updatedSteps: ConstitutionStep[]) => {
      const { error } = await supabase
        .from("projects")
        .update({ constitution_details: { steps: updatedSteps, has_foreign_partners: hasForeignPartners } } as any)
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

  const toggleForeignPartners = () => {
    supabase.from("projects").update({ constitution_details: { steps, has_foreign_partners: !hasForeignPartners } } as any).eq("id", projectId)
      .then(({ error }) => {
        if (error) toast.error(error.message);
        else { queryClient.invalidateQueries({ queryKey: ["project", projectId] }); toast.success(!hasForeignPartners ? "RNIE habilitado" : "RNIE deshabilitado"); }
      });
  };

  const updateStep = (key: string, updates: Partial<ConstitutionStep>) => {
    const updated = steps.map((s) =>
      s.key === key
        ? { ...s, ...updates, completed_at: updates.status === "completado" ? new Date().toISOString() : updates.status !== undefined ? null : s.completed_at }
        : s
    );
    saveMutation.mutate(updated);
  };

  const initializeSteps = () => saveMutation.mutate(DEFAULT_STEPS);

  if (!constitutionDetails) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <Building2 className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <div>
            <h3 className="font-semibold text-foreground">Módulo de Constitución</h3>
            <p className="text-sm text-muted-foreground mt-1">Inicia el seguimiento del proceso de constitución de empresa.</p>
          </div>
          <Button onClick={initializeSteps}><Building2 className="mr-2 h-4 w-4" /> Iniciar proceso de constitución</Button>
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
            <h3 className="font-semibold text-foreground">Progreso de constitución</h3>
            <span className="text-sm font-medium text-muted-foreground">{completedCount}/{visibleSteps.length} pasos</span>
          </div>
          <Progress value={progressPct} className="h-2" />
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={hasForeignPartners} onCheckedChange={toggleForeignPartners} />
              <span>Socios extranjeros (incluir RNIE)</span>
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {visibleSteps.map((step, idx) => {
          const IconComp = ICON_MAP[step.icon] || FileText;
          const statusCfg = STATUS_CONFIG[step.status];
          const StatusIcon = statusCfg.icon;
          const isOpen = expandedStep === step.key;
          const hasAppointment = step.appointment_date !== undefined;
          const assigneeName = getAssigneeName(step.assigned_to);

          return (
            <Collapsible key={step.key} open={isOpen} onOpenChange={() => setExpandedStep(isOpen ? null : step.key)}>
              <Card className={step.status === "completado" ? "opacity-75" : ""}>
                <CollapsibleTrigger asChild>
                  <CardContent className="p-4 cursor-pointer hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted shrink-0">
                        <span className="text-xs font-bold text-muted-foreground">{idx + 1}</span>
                      </div>
                      <IconComp className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-foreground truncate">{step.label}</h4>
                        <p className="text-xs text-muted-foreground truncate hidden sm:block">{step.description}</p>
                      </div>
                      {assigneeName && (
                        <Badge variant="outline" className="text-xs shrink-0 gap-1"><User className="h-3 w-3" />{assigneeName}</Badge>
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
                      <StepAssigneeSelect value={step.assigned_to || null} onChange={(userId) => updateStep(step.key, { assigned_to: userId })} disabled={saveMutation.isPending} />
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Fecha límite</label>
                        <div className="flex gap-2 items-center">
                          <Input type="date" className="text-sm h-8" defaultValue={step.due_date || ""} id={`const-due-${step.key}`} />
                          <Button size="sm" variant="outline" className="h-8" disabled={saveMutation.isPending}
                            onClick={() => { const el = document.getElementById(`const-due-${step.key}`) as HTMLInputElement; if (el) updateStep(step.key, { due_date: el.value || null }); }}>
                            <Save className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    {hasAppointment && (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><CalendarClock className="h-3 w-3" /> Fecha y hora de cita</label>
                        <div className="flex gap-2 items-center">
                          <Input type="datetime-local" className="text-sm w-auto" defaultValue={step.appointment_date || ""} id={`const-appointment-${step.key}`} />
                          <Button size="sm" variant="outline" disabled={saveMutation.isPending}
                            onClick={() => { const el = document.getElementById(`const-appointment-${step.key}`) as HTMLInputElement; if (el) updateStep(step.key, { appointment_date: el.value || null }); }}>
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
                        <Textarea className="text-sm min-h-[60px]" placeholder="Agregar notas..." defaultValue={step.notes} id={`const-notes-${step.key}`} />
                        <Button size="sm" variant="outline" className="shrink-0 self-end" disabled={saveMutation.isPending}
                          onClick={() => { const el = document.getElementById(`const-notes-${step.key}`) as HTMLTextAreaElement; if (el) updateStep(step.key, { notes: el.value }); }}>
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

                    {step.conditional && (
                      <p className="text-xs text-muted-foreground italic flex items-center gap-1">
                        <Globe className="h-3 w-3" /> Este paso aplica solo cuando hay socios extranjeros
                      </p>
                    )}
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
