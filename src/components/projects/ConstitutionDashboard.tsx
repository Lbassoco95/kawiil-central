import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Building2, Globe, Save, CalendarClock, Users, Plus, X, UserCheck } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UnifiedStepRow } from "./UnifiedStepRow";
import { CriticalityDelayCard } from "./CriticalityDelayCard";
import {
  buildDefaultConstitutionSteps,
  reconcileConstitutionSteps,
  type ConstitutionStep,
} from "@/lib/constitutionSteps";
import {
  buildSociosChecklist,
  partnerDocProgress,
  type ConstitutionPartner,
} from "@/lib/documentChecklist";
import { Badge } from "@/components/ui/badge";

const DEFAULT_STEPS: ConstitutionStep[] = buildDefaultConstitutionSteps(null);
const DOCS_STEP_KEY = "documentacion_socios";

interface ConstitutionDetails {
  steps: ConstitutionStep[];
  has_foreign_partners: boolean;
  socios?: ConstitutionPartner[];
}

interface Props {
  projectId: string;
  constitutionDetails: ConstitutionDetails | null;
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

  // Reconciliación de proyectos YA creados: al abrir el tablero inserta pasos
  // faltantes (p. ej. denominación social) y precarga checklists de la plantilla
  // vigente, conservando el progreso capturado. Se persiste una sola vez.
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (!constitutionDetails || reconciledRef.current) return;
    const existingSteps = (constitutionDetails.steps as ConstitutionStep[]) ?? [];
    const currentSocios = constitutionDetails.socios ?? [];
    const { steps: reconciled } = reconcileConstitutionSteps(existingSteps, responsibleUserId ?? null);
    // Migrar el checklist del paso de documentación al modelo por socio
    // (reconstruye info de empresa + bloques por socio, quita la semilla plana).
    const migrated = reconciled.map((s) =>
      s.key === DOCS_STEP_KEY ? { ...s, checklist: buildSociosChecklist(currentSocios, s.checklist ?? []) } : s,
    );
    if (JSON.stringify(existingSteps) === JSON.stringify(migrated)) return;
    reconciledRef.current = true;
    const payload: ConstitutionDetails = {
      steps: migrated,
      has_foreign_partners: constitutionDetails.has_foreign_partners,
      socios: currentSocios,
    };
    setLocalConstitution(payload);
    supabase
      .from("projects")
      .update({ constitution_details: payload } as any)
      .eq("id", projectId)
      .then(({ error }) => {
        if (!error) {
          queryClient.invalidateQueries({ queryKey: ["project", projectId] });
          queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
        }
      });
  }, [constitutionDetails, projectId, responsibleUserId, queryClient]);

  const steps: ConstitutionStep[] = (localConstitution?.steps ?? DEFAULT_STEPS).map((s) => ({
    ...s,
    completed: s.status === "completado",
    completed_by: s.completed_by ?? null,
    step_status: s.step_status || (s.status === "en_progreso" ? "en_progreso" : s.status === "completado" ? "completado" : "pendiente"),
  }));
  const hasForeignPartners = localConstitution?.has_foreign_partners ?? true;
  const socios: ConstitutionPartner[] = localConstitution?.socios ?? [];
  const docsStep = steps.find((s) => s.key === DOCS_STEP_KEY);
  const docsChecklist = docsStep?.checklist ?? [];
  const visibleSteps = steps.filter((s) => !s.conditional || hasForeignPartners);
  const completedCount = visibleSteps.filter((s) => s.status === "completado").length;
  const progressPct = visibleSteps.length > 0 ? Math.round((completedCount / visibleSteps.length) * 100) : 0;

  const [newSocioName, setNewSocioName] = useState("");
  const [newSocioMarried, setNewSocioMarried] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async (updatedSteps: ConstitutionStep[]) => {
      const payload: ConstitutionDetails = {
        steps: updatedSteps,
        has_foreign_partners: localConstitution?.has_foreign_partners ?? hasForeignPartners,
        socios: localConstitution?.socios ?? [],
      };
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

  /** Persiste constitution_details manteniendo steps, socios y has_foreign_partners. */
  const persistDetails = (partial: Partial<ConstitutionDetails>, successMsg?: string) => {
    const payload: ConstitutionDetails = {
      steps: partial.steps ?? localConstitution?.steps ?? steps,
      has_foreign_partners: partial.has_foreign_partners ?? (localConstitution?.has_foreign_partners ?? hasForeignPartners),
      socios: partial.socios ?? (localConstitution?.socios ?? []),
    };
    setLocalConstitution(payload);
    supabase.from("projects").update({ constitution_details: payload } as any).eq("id", projectId)
      .then(({ error }) => {
        if (error) toast.error(error.message);
        else {
          queryClient.invalidateQueries({ queryKey: ["project", projectId] });
          queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
          if (successMsg) toast.success(successMsg);
        }
      });
  };

  /** Reconstruye el checklist del paso 1 a partir de la lista de socios. */
  const applySocios = (nextSocios: ConstitutionPartner[], successMsg?: string) => {
    const currentSteps = localConstitution?.steps ?? steps;
    const nextSteps = currentSteps.map((s) =>
      s.key === DOCS_STEP_KEY ? { ...s, checklist: buildSociosChecklist(nextSocios, s.checklist ?? []) } : s,
    );
    persistDetails({ steps: nextSteps, socios: nextSocios }, successMsg);
  };

  const addSocio = () => {
    const name = newSocioName.trim();
    if (!name) return;
    const socio: ConstitutionPartner = { id: `socio-${Date.now()}`, name, married: newSocioMarried };
    applySocios([...socios, socio], `Socio "${name}" agregado`);
    setNewSocioName("");
    setNewSocioMarried(false);
  };

  const removeSocio = (id: string) => {
    applySocios(socios.filter((s) => s.id !== id), "Socio eliminado");
  };

  const toggleSocioMarried = (id: string) => {
    applySocios(socios.map((s) => (s.id === id ? { ...s, married: !s.married } : s)));
  };

  const toggleForeignPartners = () => {
    const newHasForeign = !hasForeignPartners;
    persistDetails({ has_foreign_partners: newHasForeign }, newHasForeign ? "RNIE habilitado" : "RNIE deshabilitado");
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
    saveMutation.mutate(buildDefaultConstitutionSteps(responsibleUserId || null));
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

      {/* Socios: registro por socio de documentos requeridos */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Users className="h-4 w-4" /> Socios
            </h3>
            <span className="text-sm font-medium text-muted-foreground">{socios.length} socio(s)</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Da de alta a cada socio para generar y rastrear su checklist de documentos dentro del paso «Recopilación de documentación de socios».
          </p>

          {socios.length > 0 && (
            <div className="space-y-2">
              {socios.map((s) => {
                const prog = partnerDocProgress(s, docsChecklist);
                const done = prog.total > 0 && prog.completed === prog.total;
                return (
                  <div key={s.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                    <UserCheck className={`h-4 w-4 shrink-0 ${done ? "text-emerald-600" : "text-muted-foreground"}`} />
                    <span className="text-sm font-medium flex-1 min-w-0 truncate">{s.name}</span>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0">
                      <Checkbox checked={!!s.married} onCheckedChange={() => toggleSocioMarried(s.id)} />
                      <span>Casado/a</span>
                    </label>
                    <Badge variant={done ? "default" : "outline"} className="text-[10px] shrink-0">
                      {prog.completed}/{prog.total} docs
                    </Badge>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      onClick={() => removeSocio(s.id)}
                      aria-label={`Eliminar socio ${s.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap rounded-md border border-dashed p-2">
            <Input
              value={newSocioName}
              onChange={(e) => setNewSocioName(e.target.value)}
              placeholder="Nombre del socio..."
              className="h-8 text-sm flex-1 min-w-[160px]"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSocio(); } }}
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <Checkbox checked={newSocioMarried} onCheckedChange={(v) => setNewSocioMarried(!!v)} />
              <span>Casado/a</span>
            </label>
            <Button size="sm" className="h-8" onClick={addSocio} disabled={!newSocioName.trim()}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Agregar socio
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">Pasos de constitución</h3>
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

    </div>
  );
}
