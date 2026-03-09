import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  FileText, Receipt, KeyRound, Send, Save, ClipboardList, Phone, CalendarClock,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UnifiedStepRow } from "./UnifiedStepRow";
import { CriticalityDelayCard } from "./CriticalityDelayCard";

import type { AccountingStep } from "@/hooks/useAccountingPeriods";

interface GestoriaStep extends AccountingStep {
  description: string;
  icon: string;
  phase: number;
  status: "pendiente" | "en_progreso" | "completado";
  appointment_date?: string | null;
}

const PHASES = [
  { number: 1, label: "Documentación y requisitos previos" },
  { number: 2, label: "Trámite de RFC" },
  { number: 3, label: "Trámite de e.firma" },
  { number: 4, label: "Entrega" },
];

const DEFAULT_STEPS: GestoriaStep[] = [
  { key: "documentacion", label: "Recopilación de documentación", description: "Integrar documentos de identidad del contribuyente, acta constitutiva (persona moral), poder notarial y demás requisitos.", icon: "FileText", phase: 1, status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "comprobante_domicilio_rfc", label: "Comprobante de domicilio para RFC", description: "Estado de cuenta bancario a nombre del contribuyente o comprobante de teléfono.", icon: "FileText", phase: 1, status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "contratacion_linea", label: "Contratación de línea telefónica", description: "Contratar línea telefónica fija o móvil a nombre del contribuyente para generar el comprobante de domicilio.", icon: "Phone", phase: 1, status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "recibo_linea", label: "Recibo de línea telefónica generado", description: "Verificar que ya se generó el recibo/comprobante de la línea contratada.", icon: "FileText", phase: 1, status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "cita_rfc", label: "Agendar cita ante el SAT (RFC)", description: "Solicitar cita en el SAT a través del gestor.", icon: "CalendarClock", phase: 2, status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", appointment_date: null, assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "obtencion_rfc", label: "Obtención del RFC", description: "Acudir a la cita y completar la inscripción al RFC.", icon: "Receipt", phase: 2, status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "cita_efirma", label: "Agendar cita ante el SAT (e.firma)", description: "Solicitar cita en el SAT para obtener la firma electrónica.", icon: "CalendarClock", phase: 3, status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", appointment_date: null, assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "obtencion_efirma", label: "Obtención de e.firma (FIEL)", description: "Acudir a la cita y completar el trámite de firma electrónica avanzada.", icon: "KeyRound", phase: 3, status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "entrega_final", label: "Entrega de documentos y acuses", description: "Entregar al cliente los documentos, acuses, constancia de RFC y archivos de e.firma.", icon: "Send", phase: 4, status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
];

interface Props {
  projectId: string;
  gestoriaDetails: { steps: GestoriaStep[] } | null;
  responsibleUserId?: string | null;
  clientDropboxPath?: string;
}

export function GestoriaDashboard({ projectId, gestoriaDetails, responsibleUserId, clientDropboxPath }: Props) {
  const queryClient = useQueryClient();

  const steps: GestoriaStep[] = (gestoriaDetails?.steps ?? DEFAULT_STEPS).map((s) => ({
    ...s,
    completed: s.status === "completado",
    completed_by: s.completed_by ?? null,
    step_status: s.step_status || (s.status === "en_progreso" ? "en_progreso" : s.status === "completado" ? "completado" : "pendiente"),
  }));

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
    const updated = steps.map((s) => {
      if (s.key !== key) return s;
      const merged = { ...s, ...updates };
      const newStepStatus = updates.step_status || s.step_status;
      let newStatus: GestoriaStep["status"] = s.status;
      if (newStepStatus === "completado") newStatus = "completado";
      else if (newStepStatus === "en_progreso" || newStepStatus === "en_espera_cliente") newStatus = "en_progreso";
      else if (newStepStatus === "pendiente") newStatus = "pendiente";
      return {
        ...merged,
        status: newStatus,
        completed_at: newStatus === "completado" ? new Date().toISOString() : newStatus !== s.status ? null : s.completed_at,
      };
    });
    saveMutation.mutate(updated);
  };

  const initializeSteps = () => {
    const stepsWithResponsible = DEFAULT_STEPS.map((s) => ({
      ...s,
      assigned_to: responsibleUserId || null,
    }));
    saveMutation.mutate(stepsWithResponsible);
  };

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

  return (
    <div className="space-y-4">
      <CriticalityDelayCard projectId={projectId} />
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
              const globalIdx = steps.findIndex((s) => s.key === step.key);
              const hasAppointment = step.appointment_date !== undefined;

              return (
                <UnifiedStepRow
                  key={step.key}
                  step={step}
                  index={globalIdx}
                  projectId={projectId}
                  clientDropboxPath={clientDropboxPath}
                  showTimer={false}
                  showCheckbox={false}
                  onSave={(updates) => updateStep(step.key, updates as Partial<GestoriaStep>)}
                  saving={saveMutation.isPending}
                  extraFields={hasAppointment ? (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" /> Fecha y hora de cita
                      </label>
                      <div className="flex gap-2 items-center">
                        <Input
                          type="datetime-local"
                          className="text-sm h-8 w-auto"
                          defaultValue={step.appointment_date || ""}
                          id={`gestoria-appointment-${step.key}`}
                        />
                        <Button size="sm" variant="outline" className="h-8" disabled={saveMutation.isPending}
                          onClick={() => {
                            const el = document.getElementById(`gestoria-appointment-${step.key}`) as HTMLInputElement;
                            if (el) updateStep(step.key, { appointment_date: el.value || null });
                          }}>
                          <Save className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ) : undefined}
                />
              );
            })}
          </div>
        );
      })}
      {/* Comments */}
      <ProjectCommentsTab projectId={projectId} />
    </div>
  );
}
