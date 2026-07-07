import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Building2, Globe, Save, CalendarClock, Users, Plus, X, UserCheck, ChevronDown } from "lucide-react";
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
  buildPartnerDocs,
  ensurePartnerDocs,
  companyInfoStepChecklist,
  partnerDocProgress,
  type ConstitutionPartner,
  type PartnerDoc,
} from "@/lib/documentChecklist";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

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
    const existingSocios = constitutionDetails.socios ?? [];
    const { steps: reconciled } = reconcileConstitutionSteps(existingSteps, responsibleUserId ?? null);
    // El paso 1 se queda SOLO con la info de empresa; los documentos por socio
    // se rastrean en el panel de Socios (quita la semilla plana anterior).
    const migratedSteps = reconciled.map((s) =>
      s.key === DOCS_STEP_KEY ? { ...s, checklist: companyInfoStepChecklist(s.checklist ?? []) } : s,
    );
    // Asegurar que cada socio tenga su lista de documentos poblada.
    const migratedSocios = existingSocios.map(ensurePartnerDocs);
    const stepsChanged = JSON.stringify(existingSteps) !== JSON.stringify(migratedSteps);
    const sociosChanged = JSON.stringify(existingSocios) !== JSON.stringify(migratedSocios);
    if (!stepsChanged && !sociosChanged) return;
    reconciledRef.current = true;
    const payload: ConstitutionDetails = {
      steps: migratedSteps,
      has_foreign_partners: constitutionDetails.has_foreign_partners,
      socios: migratedSocios,
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
  const visibleSteps = steps.filter((s) => !s.conditional || hasForeignPartners);
  const completedCount = visibleSteps.filter((s) => s.status === "completado").length;
  const progressPct = visibleSteps.length > 0 ? Math.round((completedCount / visibleSteps.length) * 100) : 0;

  const [newSocioName, setNewSocioName] = useState("");
  const [newSocioMarried, setNewSocioMarried] = useState(false);
  const [expandedSocioId, setExpandedSocioId] = useState<string | null>(null);
  const [newDocLabel, setNewDocLabel] = useState<Record<string, string>>({});

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

  const applySocios = (nextSocios: ConstitutionPartner[], successMsg?: string) => {
    persistDetails({ socios: nextSocios }, successMsg);
  };

  /** Aplica un cambio a un socio específico por id. */
  const updateSocio = (id: string, fn: (s: ConstitutionPartner) => ConstitutionPartner, successMsg?: string) => {
    applySocios(socios.map((s) => (s.id === id ? fn(s) : s)), successMsg);
  };

  /** Aplica un cambio a un documento específico de un socio. */
  const updateSocioDocs = (id: string, fn: (docs: PartnerDoc[]) => PartnerDoc[], successMsg?: string) => {
    updateSocio(id, (s) => ({ ...s, docs: fn(s.docs ?? buildPartnerDocs(!!s.married)) }), successMsg);
  };

  const addSocio = () => {
    const name = newSocioName.trim();
    if (!name) return;
    const socio: ConstitutionPartner = {
      id: `socio-${Date.now()}`,
      name,
      married: newSocioMarried,
      docs: buildPartnerDocs(newSocioMarried),
    };
    applySocios([...socios, socio], `Socio "${name}" agregado`);
    setExpandedSocioId(socio.id);
    setNewSocioName("");
    setNewSocioMarried(false);
  };

  const removeSocio = (id: string) => {
    applySocios(socios.filter((s) => s.id !== id), "Socio eliminado");
  };

  const toggleSocioMarried = (id: string) => {
    updateSocio(id, (s) => {
      const married = !s.married;
      return { ...s, married, docs: buildPartnerDocs(married, s.docs ?? []) };
    });
  };

  const toggleDoc = (socioId: string, docKey: string) => {
    updateSocioDocs(socioId, (docs) => docs.map((d) => (d.key === docKey ? { ...d, completed: !d.completed } : d)));
  };

  const setDocNote = (socioId: string, docKey: string, note: string) => {
    updateSocioDocs(socioId, (docs) => docs.map((d) => (d.key === docKey ? { ...d, note } : d)));
  };

  const removeDoc = (socioId: string, docKey: string) => {
    updateSocioDocs(socioId, (docs) => docs.filter((d) => d.key !== docKey));
  };

  const addCustomDoc = (socioId: string) => {
    const label = (newDocLabel[socioId] || "").trim();
    if (!label) return;
    updateSocioDocs(socioId, (docs) => [...docs, { key: `custom-${Date.now()}`, label, completed: false, custom: true }]);
    setNewDocLabel((m) => ({ ...m, [socioId]: "" }));
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
            Da de alta a cada socio y expándelo para rastrear su checklist de documentos. Puedes ajustar la lista (agregar/quitar documentos) y dejar un comentario en cada uno.
          </p>

          {socios.length > 0 && (
            <div className="space-y-2">
              {socios.map((s) => {
                const prog = partnerDocProgress(s);
                const done = prog.total > 0 && prog.completed === prog.total;
                const open = expandedSocioId === s.id;
                const docs = s.docs ?? [];
                return (
                  <Collapsible key={s.id} open={open} onOpenChange={(o) => setExpandedSocioId(o ? s.id : null)}>
                    <div className="rounded-md border">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <CollapsibleTrigger asChild>
                          <button type="button" className="flex items-center gap-2 flex-1 min-w-0 text-left">
                            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", open && "rotate-180")} />
                            <UserCheck className={cn("h-4 w-4 shrink-0", done ? "text-emerald-600" : "text-muted-foreground")} />
                            <span className="text-sm font-medium truncate">{s.name}</span>
                          </button>
                        </CollapsibleTrigger>
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
                      <CollapsibleContent>
                        <div className="border-t px-3 py-2 space-y-1.5">
                          {docs.map((d) => (
                            <div key={d.key} className="group flex items-start gap-2 py-0.5">
                              <Checkbox
                                className="mt-0.5"
                                checked={d.completed}
                                onCheckedChange={() => toggleDoc(s.id, d.key)}
                              />
                              <div className="flex-1 min-w-0 space-y-1">
                                <span className={cn("text-xs block", d.completed && "line-through text-muted-foreground")}>
                                  {d.label}
                                </span>
                                <Input
                                  defaultValue={d.note || ""}
                                  placeholder="Comentario..."
                                  className="h-6 text-[11px]"
                                  onBlur={(e) => { if ((e.target.value || "") !== (d.note || "")) setDocNote(s.id, d.key, e.target.value); }}
                                />
                              </div>
                              <button
                                type="button"
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity mt-0.5"
                                onClick={() => removeDoc(s.id, d.key)}
                                aria-label={`Quitar documento ${d.label}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                          <div className="flex items-center gap-2 pt-1">
                            <Input
                              value={newDocLabel[s.id] || ""}
                              onChange={(e) => setNewDocLabel((m) => ({ ...m, [s.id]: e.target.value }))}
                              placeholder="Agregar documento..."
                              className="h-7 text-xs"
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomDoc(s.id); } }}
                            />
                            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => addCustomDoc(s.id)} disabled={!(newDocLabel[s.id] || "").trim()}>
                              <Plus className="h-3 w-3 mr-0.5" /> Documento
                            </Button>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
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
