import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  FileText, Building2, Stamp, PenLine, Home, Receipt, KeyRound,
  Landmark, BookOpen, Globe, Save, Phone, CalendarClock,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UnifiedStepRow } from "./UnifiedStepRow";
import { CriticalityDelayCard } from "./CriticalityDelayCard";

import type { AccountingStep } from "@/hooks/useAccountingPeriods";

interface ConstitutionStep extends AccountingStep {
  description: string;
  icon: string;
  status: "pendiente" | "en_progreso" | "completado";
  conditional?: boolean;
  appointment_date?: string | null;
}

const DEFAULT_STEPS: ConstitutionStep[] = [
  { key: "documentacion_socios", label: "Recopilación de documentación de socios", description: "Integrar documentos de identidad, poderes y datos de los socios/accionistas.", icon: "FileText", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "envio_notaria", label: "Envío de información a notaría", description: "Enviar la documentación completa de socios a la notaría.", icon: "Building2", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "proyecto_constitucion", label: "Proyecto de constitución", description: "La notaría prepara el proyecto de acta constitutiva para revisión.", icon: "Stamp", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "firma_socios", label: "Firma de socios", description: "Los socios firman el acta constitutiva ante notario.", icon: "PenLine", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "contratacion_linea", label: "Contratación de línea telefónica", description: "Contratar línea telefónica a nombre de la empresa para comprobante de domicilio.", icon: "Phone", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "recibo_comprobante", label: "Comprobante de domicilio generado", description: "Verificar que ya se generó el recibo de la línea contratada.", icon: "Home", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "cita_rfc", label: "Agendar cita ante el SAT (RFC)", description: "El gestor solicita cita en el SAT para la inscripción al RFC.", icon: "CalendarClock", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", appointment_date: null, assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "obtencion_rfc", label: "Obtención del RFC", description: "Acudir a la cita y completar la inscripción al RFC.", icon: "Receipt", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "cita_efirma", label: "Agendar cita ante el SAT (e.firma)", description: "El gestor solicita cita para obtener la firma electrónica.", icon: "CalendarClock", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", appointment_date: null, assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "firma_electronica", label: "Obtención de e.firma (FIEL)", description: "Acudir a la cita y completar el trámite de firma electrónica avanzada.", icon: "KeyRound", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "cuenta_bancaria", label: "Alta de cuenta bancaria", description: "Apertura de cuenta bancaria corporativa.", icon: "Landmark", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "registro_rpc", label: "Registro ante el RPC (boleta)", description: "Inscripción en el Registro Público de Comercio.", icon: "BookOpen", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
  { key: "inscripcion_rnie", label: "Inscripción al RNIE", description: "Registro Nacional de Inversiones Extranjeras (socios extranjeros).", icon: "Globe", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", conditional: true, assigned_to: null, due_date: null, document_ids: [], collaborators: [] },
];

interface Props {
  projectId: string;
  constitutionDetails: { steps: ConstitutionStep[]; has_foreign_partners: boolean } | null;
  responsibleUserId?: string | null;
  clientDropboxPath?: string;
  clientId?: string;
}

export function ConstitutionDashboard({ projectId, constitutionDetails, responsibleUserId, clientDropboxPath, clientId }: Props) {
  const queryClient = useQueryClient();

  // Local source of truth — useState so UI re-renders from it
  const [localConstitution, setLocalConstitution] = useState(constitutionDetails);

  // Sync from props only when no mutation is in flight
  useEffect(() => {
    if (!saveMutation.isPending) {
      setLocalConstitution(constitutionDetails);
    }
  }, [constitutionDetails]);

  const steps: ConstitutionStep[] = (localConstitution?.steps ?? DEFAULT_STEPS).map((s) => ({
    ...s,
    completed: s.status === "completado",
    completed_by: s.completed_by ?? null,
    step_status: s.step_status || (s.status === "en_progreso" ? "en_progreso" : s.status === "completado" ? "completado" : "pendiente"),
  }));
  const hasForeignPartners = localConstitution?.has_foreign_partners ?? true;
  const visibleSteps = steps.filter((s) => !s.conditional || hasForeignPartners);
  const completedCount = visibleSteps.filter((s) => s.status === "completado").length;
  const progressPct = visibleSteps.length > 0 ? Math.round((completedCount / visibleSteps.length) * 100) : 0;

  const saveMutation = useMutation({
    mutationFn: async (updatedSteps: ConstitutionStep[]) => {
      const payload = { steps: updatedSteps, has_foreign_partners: localConstitution?.has_foreign_partners ?? hasForeignPartners };
      setLocalConstitution(payload);
      const { error } = await supabase
        .from("projects")
        .update({ constitution_details: payload } as any)
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
    const currentSteps = localConstitution?.steps ?? steps;
    const newHasForeign = !hasForeignPartners;
    const payload = { steps: currentSteps, has_foreign_partners: newHasForeign };
    setLocalConstitution(payload);
    supabase.from("projects").update({ constitution_details: payload } as any).eq("id", projectId)
      .then(({ error }) => {
        if (error) toast.error(error.message);
        else { queryClient.invalidateQueries({ queryKey: ["project", projectId] }); toast.success(newHasForeign ? "RNIE habilitado" : "RNIE deshabilitado"); }
      });
  };

  const updateStep = (key: string, updates: Partial<ConstitutionStep>) => {
    const currentSteps = localConstitution?.steps ?? steps;
    const updated = currentSteps.map((s) => {
      if (s.key !== key) return s;
      const merged = { ...s, ...updates };
      const newStepStatus = updates.step_status || s.step_status;
      let newStatus: ConstitutionStep["status"] = s.status;
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

  return (
    <div className="space-y-4">
      <CriticalityDelayCard projectId={projectId} />
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
          const hasAppointment = step.appointment_date !== undefined;

          return (
            <UnifiedStepRow
              key={step.key}
              step={step}
              index={idx}
              projectId={projectId}
              clientDropboxPath={clientDropboxPath}
              clientId={clientId}
              showTimer={false}
              showCheckbox={false}
              onSave={(updates) => updateStep(step.key, updates as Partial<ConstitutionStep>)}
              saving={saveMutation.isPending}
              extraFields={
                <>
                  {hasAppointment && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" /> Fecha y hora de cita
                      </label>
                      <div className="flex gap-2 items-center">
                        <Input type="datetime-local" className="text-sm h-8 w-auto" defaultValue={step.appointment_date || ""} id={`const-appointment-${step.key}`} />
                        <Button size="sm" variant="outline" className="h-8" disabled={saveMutation.isPending}
                          onClick={() => { const el = document.getElementById(`const-appointment-${step.key}`) as HTMLInputElement; if (el) updateStep(step.key, { appointment_date: el.value || null }); }}>
                          <Save className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                  {step.conditional && (
                    <p className="text-xs text-muted-foreground italic flex items-center gap-1">
                      <Globe className="h-3 w-3" /> Este paso aplica solo cuando hay socios extranjeros
                    </p>
                  )}
                </>
              }
            />
          );
        })}
      </div>

    </div>
  );
}
