import { useState, useMemo, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import {
  Plus, AlertTriangle, BookTemplate, Sparkles, ChevronRight, ChevronLeft,
  Layers, Users, CheckCircle2, Loader2, Wand2, X,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useClients";
import { useClientComplianceConfig } from "@/hooks/useCompliance";
import { useProjectTemplates, useCreateProjectTemplate } from "@/hooks/useProjectTemplates";
import { ComplianceTaskGeneratorModal } from "@/components/compliance/ComplianceTaskGeneratorModal";
import { toast } from "sonner";
import { useAreaOptions } from "@/hooks/useAreaOptions";
import { useProfiles } from "@/hooks/useTasks";
import type { Database } from "@/integrations/supabase/types";
import type { Phase } from "@/components/projects/PhaseManager";

type ServiceArea = Database["public"]["Enums"]["service_area"];

export const TAX_OBLIGATION_OPTIONS = [
  { key: "isr_provisional", label: "ISR (mensual provisional)" },
  { key: "iva_mensual", label: "IVA (mensual)" },
  { key: "diot", label: "DIOT" },
  { key: "isr_retenciones", label: "ISR retenciones (sueldos/honorarios)" },
  { key: "ieps", label: "IEPS" },
];

type WizardStep = "type" | "phases" | "team" | "review";
const STEPS: WizardStep[] = ["type", "phases", "team", "review"];
const STEP_LABELS: Record<WizardStep, string> = {
  type: "Tipo y cliente",
  phases: "Fases y tareas",
  team: "Equipo",
  review: "Revisión",
};

interface TaskLine {
  title: string;
  phaseKey?: string;
  assignedTo?: string;
  priority?: string;
}

export function ProjectCreationDialog() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"quick" | "wizard">("quick");
  const [step, setStep] = useState<WizardStep>("type");

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState("");
  const [area, setArea] = useState("");
  const [serviceTags, setServiceTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [selectedObligations, setSelectedObligations] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [phases, setPhases] = useState<Phase[]>([]);
  const [taskLines, setTaskLines] = useState<TaskLine[]>([]);
  const [taskText, setTaskText] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [complianceGenOpen, setComplianceGenOpen] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);

  const { user } = useAuth();
  const { data: clients } = useClients();
  const { areaOptions } = useAreaOptions();
  const { data: profiles } = useProfiles();
  const queryClient = useQueryClient();
  const { data: templates } = useProjectTemplates(area || undefined);
  const createTemplate = useCreateProjectTemplate();

  const isCumplimiento = area === "cumplimiento";
  const isAccounting = area === "contabilidad" || area === "softlanding";

  const { data: complianceConfigs } = useClientComplianceConfig(
    isCumplimiento && clientId ? clientId : undefined
  );
  const hasComplianceConfig = (complianceConfigs || []).length > 0;
  const complianceEntityTypeIds = (complianceConfigs || []).map((c) => c.entity_type_id);

  const selectedClient = clients?.find((c) => c.id === clientId);
  const autoName = isCumplimiento && selectedClient
    ? `Cumplimiento — ${selectedClient.name}`
    : name;

  const profileOptions = useMemo(() =>
    (profiles || []).map((p) => ({ value: p.user_id, label: p.full_name })),
  [profiles]);

  const applyTemplate = (tplId: string) => {
    setSelectedTemplateId(tplId);
    const tpl = templates?.find((t) => t.id === tplId);
    if (!tpl) return;
    if (tpl.area && !area) setArea(tpl.area);
    if (tpl.description && !description) setDescription(tpl.description);
    if (tpl.phases?.length) {
      setPhases(tpl.phases.map((p: any, i: number) => ({
        key: p.key || `phase_${i}`,
        name: p.name || `Fase ${i + 1}`,
        order: p.order ?? i,
      })));
    }
    if (tpl.suggested_tasks?.length) {
      const text = tpl.suggested_tasks.map((t: any) => t.title || t).join("\n");
      setTaskText(text);
    }
  };

  const addTag = () => {
    const tag = newTag.trim().toLowerCase();
    if (tag && !serviceTags.includes(tag)) {
      setServiceTags([...serviceTags, tag]);
    }
    setNewTag("");
  };

  const createProject = useMutation({
    mutationFn: async () => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      const obligations = isAccounting
        ? TAX_OBLIGATION_OPTIONS.filter((o) => selectedObligations.includes(o.key))
        : [];

      const { data, error } = await supabase
        .from("projects")
        .insert({
          name: isCumplimiento ? autoName : name,
          description: description || null,
          client_id: clientId || null,
          area: (area as ServiceArea) || null,
          organization_id: orgId!,
          created_by: user!.id,
          responsible_user_id: responsibleUserId || user!.id,
          tax_obligations: obligations,
          phases: phases.length > 0 ? phases : [],
          service_tags: serviceTags.length > 0 ? serviceTags : [],
        } as any)
        .select()
        .single();
      if (error) throw error;

      if (data) {
        const lines = taskText.split("\n").map((l) => l.trim()).filter(Boolean);
        for (const title of lines) {
          await supabase.from("tasks").insert({
            title,
            project_id: data.id,
            client_id: clientId || null,
            organization_id: orgId!,
            created_by: user!.id,
            assigned_to: responsibleUserId || user!.id,
            area: area || null,
            priority: "media",
            status: "pendiente",
          } as any);
        }
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Proyecto creado exitosamente");

      if (isCumplimiento && hasComplianceConfig && data) {
        setCreatedProjectId(data.id);
        setComplianceGenOpen(true);
      } else {
        resetForm();
      }
    },
    onError: (error) => {
      toast.error("Error al crear proyecto: " + error.message);
    },
  });

  const resetForm = () => {
    setOpen(false);
    setMode("quick");
    setStep("type");
    setName("");
    setDescription("");
    setClientId("");
    setArea("");
    setServiceTags([]);
    setNewTag("");
    setSelectedObligations([]);
    setCreatedProjectId(null);
    setSelectedTemplateId("");
    setPhases([]);
    setTaskLines([]);
    setTaskText("");
    setResponsibleUserId("");
  };

  const canAdvance = () => {
    if (step === "type") {
      if (isCumplimiento) return !!clientId && hasComplianceConfig;
      return !!name.trim();
    }
    return true;
  };

  const nextStep = () => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };

  const prevStep = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  const stepIdx = STEPS.indexOf(step);
  const progressValue = ((stepIdx + 1) / STEPS.length) * 100;

  const addPhase = () => {
    const maxOrder = phases.reduce((m, p) => Math.max(m, p.order), 0);
    setPhases([...phases, { key: `phase_${Date.now()}`, name: `Fase ${phases.length + 1}`, order: maxOrder + 1 }]);
  };

  // Quick mode render
  const renderQuickForm = () => (
    <div className="space-y-4">
      {templates && templates.length > 0 && (
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5"><BookTemplate className="h-3.5 w-3.5" /> Plantilla</Label>
          <div className="flex flex-wrap gap-1.5">
            {templates.map((tpl) => (
              <button
                type="button" key={tpl.id}
                onClick={() => applyTemplate(tpl.id)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  selectedTemplateId === tpl.id ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 hover:bg-secondary border-border"
                }`}
              >
                {tpl.is_ai_generated && <Sparkles className="h-3 w-3 inline mr-1" />}
                {tpl.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isCumplimiento && (
        <div className="space-y-2">
          <Label htmlFor="project-name">Nombre *</Label>
          <Input id="project-name" placeholder="Nombre del proyecto" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Cliente</Label>
          <SearchableSelect
            options={(clients || []).map((c) => ({ value: c.id, label: c.name }))}
            value={clientId} onValueChange={setClientId}
            placeholder="Seleccionar cliente" searchPlaceholder="Buscar cliente..."
          />
        </div>
        <div className="space-y-2">
          <Label>Célula de servicio</Label>
          <SearchableSelect
            options={areaOptions} value={area}
            onValueChange={(v) => { setArea(v); setSelectedObligations([]); }}
            placeholder="Seleccionar célula" searchPlaceholder="Buscar célula..."
          />
        </div>
      </div>

      {/* Service tags */}
      <div className="space-y-2">
        <Label>Etiquetas de servicio</Label>
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {serviceTags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs gap-1">
              {tag}
              <button onClick={() => setServiceTags(serviceTags.filter((t) => t !== tag))} className="hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Input
            value={newTag} onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            placeholder="Ej: auditoria_interna, control_interno..." className="h-8 text-xs"
          />
          <Button size="sm" variant="outline" onClick={addTag} disabled={!newTag.trim()} className="h-8 text-xs">Agregar</Button>
        </div>
      </div>

      {isCumplimiento && clientId && !hasComplianceConfig && (
        <div className="flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 dark:text-yellow-400 rounded-md p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Este cliente no tiene tipo de entidad regulada configurado. <Link to={`/clientes/${clientId}`} className="underline font-medium">Configurar ahora</Link></span>
        </div>
      )}

      {isAccounting && (
        <div className="space-y-3 rounded-md border p-4">
          <Label className="text-sm font-semibold">Obligaciones fiscales</Label>
          <div className="space-y-2">
            {TAX_OBLIGATION_OPTIONS.map((opt) => (
              <label key={opt.key} className="flex items-center gap-3 rounded-md px-2 py-2 text-sm cursor-pointer hover:bg-muted/50 transition-colors">
                <Checkbox checked={selectedObligations.includes(opt.key)} onCheckedChange={() => setSelectedObligations((prev) => prev.includes(opt.key) ? prev.filter((k) => k !== opt.key) : [...prev, opt.key])} />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>Descripción</Label>
        <Textarea placeholder="Descripción del proyecto (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label>Tareas iniciales (una por línea)</Label>
        <Textarea
          placeholder={"Revisión de documentos\nAnálisis fiscal\nEntrega de reporte"}
          value={taskText} onChange={(e) => setTaskText(e.target.value)} rows={4} className="text-sm"
        />
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setMode("wizard")} className="text-xs gap-1.5">
          <Wand2 className="h-3.5 w-3.5" /> Modo guiado
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button
            onClick={() => createProject.mutate()}
            disabled={(!isCumplimiento && !name.trim()) || (isCumplimiento && (!clientId || !hasComplianceConfig)) || createProject.isPending || (isAccounting && selectedObligations.length === 0)}
          >
            {createProject.isPending ? "Creando..." : "Crear proyecto"}
          </Button>
        </div>
      </div>
    </div>
  );

  // Wizard mode render
  const renderWizard = () => (
    <div className="space-y-4">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Paso {stepIdx + 1} de {STEPS.length}: {STEP_LABELS[step]}</span>
          <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => setMode("quick")}>
            Modo rápido
          </Button>
        </div>
        <Progress value={progressValue} className="h-1.5" />
        <div className="flex gap-1">
          {STEPS.map((s, i) => (
            <button
              key={s}
              onClick={() => i <= stepIdx && setStep(s)}
              className={`flex-1 h-1 rounded-full transition-colors ${i <= stepIdx ? "bg-primary" : "bg-border"}`}
            />
          ))}
        </div>
      </div>

      {/* Step 1: Type & Client */}
      {step === "type" && (
        <div className="space-y-4">
          {templates && templates.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><BookTemplate className="h-3.5 w-3.5" /> Usar plantilla</Label>
              <div className="flex flex-wrap gap-1.5">
                {templates.map((tpl) => (
                  <button
                    type="button" key={tpl.id} onClick={() => applyTemplate(tpl.id)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                      selectedTemplateId === tpl.id ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-card hover:bg-secondary border-border"
                    }`}
                  >
                    {tpl.is_ai_generated && <Sparkles className="h-3 w-3 inline mr-1" />}
                    {tpl.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isCumplimiento && (
            <div className="space-y-2">
              <Label>Nombre del proyecto *</Label>
              <Input placeholder="Ej: Contabilidad mensual Grupo Dazon" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Cliente</Label>
              <SearchableSelect options={(clients || []).map((c) => ({ value: c.id, label: c.name }))} value={clientId} onValueChange={setClientId} placeholder="Seleccionar cliente" searchPlaceholder="Buscar..." />
            </div>
            <div className="space-y-2">
              <Label>Célula</Label>
              <SearchableSelect options={areaOptions} value={area} onValueChange={(v) => { setArea(v); setSelectedObligations([]); }} placeholder="Seleccionar célula" searchPlaceholder="Buscar..." />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Etiquetas de servicio</Label>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {serviceTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs gap-1">
                  {tag} <button onClick={() => setServiceTags(serviceTags.filter((t) => t !== tag))}><X className="h-2.5 w-2.5" /></button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-1.5">
              <Input value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} placeholder="Ej: cumplimiento_financiero..." className="h-8 text-xs" />
              <Button size="sm" variant="outline" onClick={addTag} disabled={!newTag.trim()} className="h-8 text-xs">+</Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Descripción</Label>
            <Textarea placeholder="Descripción breve del proyecto" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
        </div>
      )}

      {/* Step 2: Phases & Tasks */}
      {step === "phases" && (
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" /> Fases del proyecto</Label>
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={addPhase}>
                <Plus className="h-3 w-3 mr-1" /> Agregar fase
              </Button>
            </div>
            {phases.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4 border rounded-lg border-dashed">Sin fases definidas. Puedes agregar fases o crear tareas sin fases.</p>
            )}
            {phases.map((phase, idx) => (
              <div key={phase.key} className="flex items-center gap-2 px-3 py-2 border rounded-lg bg-card">
                <span className="text-xs text-muted-foreground w-6">{idx + 1}.</span>
                <Input
                  value={phase.name}
                  onChange={(e) => setPhases(phases.map((p) => p.key === phase.key ? { ...p, name: e.target.value } : p))}
                  className="h-8 text-sm flex-1"
                />
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive/50 hover:text-destructive" onClick={() => setPhases(phases.filter((p) => p.key !== phase.key))}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label>Tareas (una por línea)</Label>
            <Textarea
              placeholder={"Revisión de documentos\nAnálisis fiscal\nEntrega de reporte\n\nUsa [Fase] para agrupar:\n[Análisis] Revisión de docs\n[Análisis] Entrevista con cliente"}
              value={taskText} onChange={(e) => setTaskText(e.target.value)} rows={6} className="text-sm"
            />
            <p className="text-[10px] text-muted-foreground">Tip: usa [Nombre de fase] al inicio para agrupar tareas automáticamente.</p>
          </div>
        </div>
      )}

      {/* Step 3: Team */}
      {step === "team" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Responsable del proyecto</Label>
            <SearchableSelect
              options={profileOptions}
              value={responsibleUserId || user?.id || ""}
              onValueChange={setResponsibleUserId}
              placeholder="Seleccionar responsable"
              searchPlaceholder="Buscar..."
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Las tareas se asignarán por defecto al responsable del proyecto. Podrás cambiar la asignación individual después de crear.
          </p>
        </div>
      )}

      {/* Step 4: Review */}
      {step === "review" && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="font-semibold text-sm">{isCumplimiento ? autoName : name}</h3>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
            <div className="flex flex-wrap gap-2">
              {selectedClient && <Badge variant="outline" className="text-xs">Cliente: {selectedClient.name}</Badge>}
              {area && <Badge variant="secondary" className="text-xs">{area}</Badge>}
              {serviceTags.map((tag) => <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>)}
            </div>
            {phases.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Fases ({phases.length}):</p>
                {phases.map((p, i) => (
                  <div key={p.key} className="text-xs flex items-center gap-2 pl-2">
                    <span className="text-muted-foreground">{i + 1}.</span> {p.name}
                  </div>
                ))}
              </div>
            )}
            {taskText.trim() && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Tareas ({taskText.split("\n").filter(Boolean).length}):</p>
                {taskText.split("\n").filter(Boolean).slice(0, 10).map((line, i) => (
                  <div key={i} className="text-xs text-muted-foreground pl-2">• {line}</div>
                ))}
                {taskText.split("\n").filter(Boolean).length > 10 && (
                  <p className="text-[10px] text-muted-foreground pl-2">... y {taskText.split("\n").filter(Boolean).length - 10} más</p>
                )}
              </div>
            )}
            {responsibleUserId && (
              <p className="text-xs text-muted-foreground">Responsable: {profileOptions.find((p) => p.value === responsibleUserId)?.label || "—"}</p>
            )}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2 border-t">
        <Button variant="ghost" size="sm" onClick={stepIdx === 0 ? () => setOpen(false) : prevStep} className="gap-1.5">
          <ChevronLeft className="h-3.5 w-3.5" />
          {stepIdx === 0 ? "Cancelar" : "Anterior"}
        </Button>
        {step === "review" ? (
          <Button onClick={() => createProject.mutate()} disabled={createProject.isPending} className="gap-1.5">
            {createProject.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {createProject.isPending ? "Creando..." : "Crear proyecto"}
          </Button>
        ) : (
          <Button onClick={nextStep} disabled={!canAdvance()} className="gap-1.5">
            Siguiente <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" /> Nuevo proyecto
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {mode === "wizard" ? <Wand2 className="h-4 w-4 text-primary" /> : <Plus className="h-4 w-4" />}
              {mode === "wizard" ? "Crear proyecto (modo guiado)" : "Crear proyecto"}
            </DialogTitle>
          </DialogHeader>
          {mode === "quick" ? renderQuickForm() : renderWizard()}
        </DialogContent>
      </Dialog>

      {createdProjectId && (
        <ComplianceTaskGeneratorModal
          open={complianceGenOpen}
          onOpenChange={(o) => { setComplianceGenOpen(o); if (!o) resetForm(); }}
          projectId={createdProjectId}
          entityTypeIds={complianceEntityTypeIds}
          responsibleUserId={user!.id}
          onGenerated={() => {
            queryClient.invalidateQueries({ queryKey: ["project-tasks", createdProjectId] });
            resetForm();
          }}
        />
      )}
    </>
  );
}
