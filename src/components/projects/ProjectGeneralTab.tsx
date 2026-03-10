import { useState, useMemo } from "react";
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
import { Save, Pencil, X, AlertTriangle, Sparkles } from "lucide-react";
import { useUpdateProject, type Project } from "@/hooks/useProjects";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AISummaryCard } from "@/components/shared/AISummaryCard";
import { formatDateMX } from "@/lib/dateUtils";
import type { Database } from "@/integrations/supabase/types";
import { MeetingMinutesDialog } from "./MeetingMinutesDialog";
import { CRITICALITY_OPTIONS, DELAY_CATEGORIES } from "./CriticalityDelayCard";

type ProjectStatus = Database["public"]["Enums"]["project_status"];

const STATUS_STYLES: Record<ProjectStatus, string> = {
  activo: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  pausado: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  completado: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  cancelado: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  activo: "Activo",
  pausado: "Pausado",
  completado: "Completado",
  cancelado: "Cancelado",
};

const SERVICE_LABELS: Record<string, string> = {
  contabilidad: "Contabilidad",
  legal: "Legal",
  softlanding: "Soft Landing",
  pld_ft: "PLD/FT",
  juicios: "Juicios",
};

interface Props {
  project: Project & { clients?: { name: string } | null };
}

export function ProjectGeneralTab({ project }: Props) {
  const updateProject = useUpdateProject();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(project.description || "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [startDate, setStartDate] = useState(project.start_date || "");
  const [endDate, setEndDate] = useState(project.end_date || "");
  const [criticalityLevel, setCriticalityLevel] = useState((project as any).criticality_level || "normal");
  const [delayCategory, setDelayCategory] = useState((project as any).delay_category || "");
  const [delayNotes, setDelayNotes] = useState((project as any).delay_notes || "");
  const [clientId, setClientId] = useState(project.client_id || "");
  const [showMeetingDialog, setShowMeetingDialog] = useState(false);

  // Fetch clients for selector
  const { data: clients } = useQuery({
    queryKey: ["clients-for-project-edit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .eq("status", "activo")
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user && editing,
  });

  // Fetch project tasks for AI summary
  const { data: projectTasks } = useQuery({
    queryKey: ["project-tasks-summary", project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("title, status, priority, due_date, area, assigned_to")
        .eq("project_id", project.id)
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Fetch accounting periods for this project
  const { data: accountingPeriods } = useQuery({
    queryKey: ["project-accounting-summary", project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounting_periods")
        .select("month, year, status, steps")
        .eq("project_id", project.id)
        .order("year", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user && project.area === "contabilidad",
  });

  // Fetch annual declarations for this project
  const { data: annualDeclarations } = useQuery({
    queryKey: ["project-annual-summary", project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("annual_declarations")
        .select("year, status, steps")
        .eq("project_id", project.id)
        .order("year", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user && project.area === "contabilidad",
  });

  const clientName = (project as any).clients?.name || "Interno";
  const areaLabel = SERVICE_LABELS[project.area || ""] || project.area || "Sin área";

  const projectSummaryPrompt = useMemo(() => {
    const tasks = projectTasks ?? [];
    const pending = tasks.filter(t => ["pendiente", "en_progreso", "en_revision"].includes(t.status));
    const completed = tasks.filter(t => t.status === "completada");
    const overdue = pending.filter(t => t.due_date && new Date(t.due_date) < new Date());
    const totalPct = tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0;

    // Build area-specific context
    let areaContext = "";

    // Lawsuit details (juicios)
    if (project.area === "juicios" && (project as any).lawsuit_details) {
      const ld = (project as any).lawsuit_details;
      const stages = Array.isArray(ld.stages) ? ld.stages : [];
      const completedStages = stages.filter((s: any) => s.status === "completado");
      const inProgressStages = stages.filter((s: any) => s.status === "en_progreso" || s.step_status === "en_progreso");
      const pendingStages = stages.filter((s: any) => s.status !== "completado" && s.status !== "no_aplica");
      
      const deadlines = Array.isArray(ld.deadlines) ? ld.deadlines : [];
      const upcomingDeadlines = deadlines
        .filter((d: any) => !d.completed && d.date)
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const overdueDeadlines = upcomingDeadlines.filter((d: any) => new Date(d.date) < new Date());
      
      areaContext = `
DATOS DEL JUICIO:
- Tipo: ${ld.lawsuit_type || "no especificado"}
- Juzgado: ${ld.court || "no especificado"}
- No. Expediente: ${ld.case_number || "no especificado"}
- Actor/Demandante: ${ld.plaintiff || "no especificado"}
- Demandado: ${ld.defendant || "no especificado"}
- Abogado Patrono: ${ld.lead_attorney || "no especificado"}
- Abogado Sustituto: ${ld.substitute_attorney || "no especificado"}
- Etapas procesales: ${completedStages.length} completadas / ${stages.length} total
- En progreso: ${inProgressStages.length > 0 ? inProgressStages.map((s: any) => s.label).join(", ") : "ninguna"}
- Etapas pendientes: ${pendingStages.slice(0, 5).map((s: any) => `${s.label} (${s.step_status || s.status})`).join(", ") || "ninguna"}

TÉRMINOS Y FECHAS CLAVE (${deadlines.length} total, ${overdueDeadlines.length} vencidos):
${upcomingDeadlines.slice(0, 6).map((d: any) => {
  const isOverdue = new Date(d.date) < new Date();
  return `  ${isOverdue ? "⚠️" : "📅"} ${d.title} — ${d.date}${d.time ? ` ${d.time}` : ""} [${d.type || "término"}]${d.notes ? ` (${d.notes})` : ""}`;
}).join("\n")}`;
    }

    // Constitution details (softlanding / constitucion_nacional)
    if ((project.area === "softlanding" || project.area === "constitucion_nacional") && (project as any).constitution_details) {
      const cd = (project as any).constitution_details;
      const allSteps = Array.isArray(cd.steps) ? cd.steps : [];
      const completedSteps = allSteps.filter((s: any) => s.status === "completado" || s.completed);
      const inProgressSteps = allSteps.filter((s: any) => s.step_status === "en_progreso" || s.status === "en_progreso");
      const waitingSteps = allSteps.filter((s: any) => s.step_status === "en_espera_cliente");
      const pendingSteps = allSteps.filter((s: any) => s.status !== "completado" && !s.completed && s.status !== "no_aplica");
      
      areaContext = `
DATOS DE CONSTITUCIÓN:
- Pasos completados: ${completedSteps.length}/${allSteps.length} (${allSteps.length > 0 ? Math.round((completedSteps.length / allSteps.length) * 100) : 0}%)
- En progreso: ${inProgressSteps.length > 0 ? inProgressSteps.map((s: any) => s.label || s.key).join(", ") : "ninguno"}
- En espera de cliente: ${waitingSteps.length > 0 ? waitingSteps.map((s: any) => s.label || s.key).join(", ") : "ninguno"}
- Pendientes: ${pendingSteps.slice(0, 5).map((s: any) => `${s.label || s.key} (${s.step_status || s.status || "pendiente"})`).join(", ") || "ninguno"}`;
    }

    // Gestoría details
    if (project.area === "gestoria" && (project as any).constitution_details) {
      const cd = (project as any).constitution_details;
      const allSteps = Array.isArray(cd.steps) ? cd.steps : [];
      const completedSteps = allSteps.filter((s: any) => s.status === "completado" || s.completed);
      const inProgressSteps = allSteps.filter((s: any) => s.step_status === "en_progreso" || s.status === "en_progreso");
      const waitingSteps = allSteps.filter((s: any) => s.step_status === "en_espera_cliente");
      const pendingSteps = allSteps.filter((s: any) => s.status !== "completado" && !s.completed && s.status !== "no_aplica");
      
      areaContext = `
DATOS DE GESTORÍA:
- Pasos completados: ${completedSteps.length}/${allSteps.length} (${allSteps.length > 0 ? Math.round((completedSteps.length / allSteps.length) * 100) : 0}%)
- En progreso: ${inProgressSteps.length > 0 ? inProgressSteps.map((s: any) => s.label || s.key).join(", ") : "ninguno"}
- En espera de cliente: ${waitingSteps.length > 0 ? waitingSteps.map((s: any) => s.label || s.key).join(", ") : "ninguno"}
- Pendientes: ${pendingSteps.slice(0, 5).map((s: any) => `${s.label || s.key} (${s.step_status || s.status || "pendiente"})`).join(", ") || "ninguno"}`;
    }

    // Accounting periods
    if (project.area === "contabilidad" && accountingPeriods && accountingPeriods.length > 0) {
      const completedPeriods = accountingPeriods.filter(p => p.status === "completado");
      const pendingPeriods = accountingPeriods.filter(p => p.status !== "completado");
      // Include step-level detail for pending periods
      const periodDetails = pendingPeriods.slice(0, 3).map(p => {
        const steps = Array.isArray(p.steps) ? p.steps : [];
        const inProgress = steps.filter((s: any) => s.step_status === "en_progreso");
        const waiting = steps.filter((s: any) => s.step_status === "en_espera_cliente");
        const doneSteps = steps.filter((s: any) => s.completed || s.step_status === "completado");
        let detail = `${p.month}/${p.year} (${p.status}) — ${doneSteps.length}/${steps.length} pasos`;
        if (inProgress.length > 0) detail += ` | En progreso: ${inProgress.map((s: any) => s.label).join(", ")}`;
        if (waiting.length > 0) detail += ` | Esperando cliente: ${waiting.map((s: any) => s.label).join(", ")}`;
        return detail;
      });
      areaContext += `
PERÍODOS CONTABLES:
- Total: ${accountingPeriods.length} | Completados: ${completedPeriods.length} | Pendientes: ${pendingPeriods.length}
${periodDetails.map(d => `- ${d}`).join("\n")}`;
    }

    // Annual declarations
    if (project.area === "contabilidad" && annualDeclarations && annualDeclarations.length > 0) {
      areaContext += `
DECLARACIONES ANUALES:
${annualDeclarations.slice(0, 3).map(d => {
  const steps = Array.isArray(d.steps) ? d.steps : [];
  const done = steps.filter((s: any) => s.completed || s.step_status === "completado").length;
  const inProgress = steps.filter((s: any) => s.step_status === "en_progreso");
  let line = `- Año ${d.year}: ${d.status} (${done}/${steps.length} pasos)`;
  if (inProgress.length > 0) line += ` | En progreso: ${inProgress.map((s: any) => s.label).join(", ")}`;
  return line;
}).join("\n")}`;
    }

    // Compliance (cumplimiento) — tasks contain the compliance data
    if (project.area === "cumplimiento") {
      const complianceTasks = tasks.filter(t => t.area === "cumplimiento" || t.area === "pld_ft");
      const compPending = complianceTasks.filter(t => ["pendiente", "en_progreso"].includes(t.status));
      const compOverdue = compPending.filter(t => t.due_date && new Date(t.due_date) < new Date());
      areaContext = `
CUMPLIMIENTO:
- Obligaciones totales: ${complianceTasks.length}
- Pendientes: ${compPending.length}
- Vencidas: ${compOverdue.length}`;
    }

    return `Genera un resumen ejecutivo breve del proyecto. Español mexicano, tono profesional, emojis.

PROYECTO: ${project.name}
CLIENTE: ${clientName}
ÁREA: ${areaLabel}
ESTADO: ${project.status}
SEMÁFORO: ${(project as any).criticality_level || "normal"}
MOTIVO DE ATRASO: ${(project as any).delay_category || "ninguno"}
NOTAS DE ATRASO: ${(project as any).delay_notes || "sin notas"}
INICIO: ${project.start_date || "no definido"}
FIN ESTIMADO: ${project.end_date || "no definido"}
DESCRIPCIÓN: ${project.description || "sin descripción"}
${areaContext}

TAREAS:
- Total: ${tasks.length}
- Completadas: ${completed.length} (${totalPct}%)
- Pendientes: ${pending.length}
- Vencidas: ${overdue.length}
${pending.slice(0, 8).map(t => `  • ${t.title} [${t.priority}] ${t.due_date ? `vence: ${t.due_date}` : ""}`).join("\n")}

INSTRUCCIONES:
1. Resume en 3-4 puntos el estado actual del proyecto con emojis, incluyendo los datos específicos del área (juicio, constitución, contabilidad, etc.).
2. Indica el porcentaje de avance y qué falta por hacer.
3. Si hay tareas vencidas o semáforo en atención/crítico, destácalo.
4. Si hay motivo de atraso, explícalo con contexto.
5. Sugiere la siguiente acción prioritaria.
6. Máximo 120 palabras. Usa markdown.`;
  }, [project, projectTasks, accountingPeriods, annualDeclarations, clientName, areaLabel]);

  const handleSave = () => {
    updateProject.mutate(
      {
        id: project.id,
        description: description || null,
        status,
        start_date: startDate || null,
        end_date: endDate || null,
        criticality_level: criticalityLevel,
        delay_category: delayCategory || null,
        delay_notes: delayNotes || null,
        client_id: clientId || null,
      } as any,
      {
        onSuccess: () => setEditing(false),
      }
    );
  };

  const handleCancel = () => {
    setDescription(project.description || "");
    setStatus(project.status);
    setStartDate(project.start_date || "");
    setEndDate(project.end_date || "");
    setCriticalityLevel((project as any).criticality_level || "normal");
    setDelayCategory((project as any).delay_category || "");
    setDelayNotes((project as any).delay_notes || "");
    setClientId(project.client_id || "");
    setEditing(false);
  };

  const currentCriticality = CRITICALITY_OPTIONS.find(c => c.value === ((project as any).criticality_level || "normal"));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">Detalles del proyecto</CardTitle>
          {!editing ? (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4 mr-1" />
              Editar
            </Button>
          ) : (
            <div className="flex gap-1">
              <Button
                variant="default"
                size="sm"
                onClick={handleSave}
                disabled={updateProject.isPending}
              >
                <Save className="h-4 w-4 mr-1" />
                Guardar
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {/* Status */}
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Estado</span>
            {editing ? (
              <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                <SelectTrigger className="w-40 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="outline" className={STATUS_STYLES[project.status]}>
                {STATUS_LABELS[project.status]}
              </Badge>
            )}
          </div>

          {/* Area */}
          {project.area && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Célula</span>
              <span>{SERVICE_LABELS[project.area] || project.area}</span>
            </div>
          )}

          {/* Start date */}
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Inicio</span>
            {editing ? (
              <Input
                type="date"
                className="w-40 h-8 text-xs"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            ) : (
              <span>{project.start_date ? formatDateMX(project.start_date) : "—"}</span>
            )}
          </div>

          {/* End date */}
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Fin</span>
            {editing ? (
              <Input
                type="date"
                className="w-40 h-8 text-xs"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            ) : (
              <span>{project.end_date ? formatDateMX(project.end_date) : "—"}</span>
            )}
          </div>

          {/* Criticality level */}
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Semáforo</span>
            {editing ? (
              <Select value={criticalityLevel} onValueChange={setCriticalityLevel}>
                <SelectTrigger className="w-40 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRITICALITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="outline" className={currentCriticality?.color}>
                {currentCriticality?.label}
              </Badge>
            )}
          </div>

          {/* Delay category */}
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Motivo de atraso</span>
            {editing ? (
              <Select value={delayCategory || "__none__"} onValueChange={(v) => setDelayCategory(v === "__none__" ? "" : v)}>
                <SelectTrigger className="w-40 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELAY_CATEGORIES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-sm">
                {(project as any).delay_category
                  ? DELAY_CATEGORIES.find(d => d.value === (project as any).delay_category)?.label || (project as any).delay_category
                  : "—"}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Description / Notes card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Descripción y notas</CardTitle>
        </CardHeader>
        <CardContent>
          {editing ? (
            <Textarea
              className="min-h-[120px] text-sm"
              placeholder="Agrega una descripción o notas del proyecto..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          ) : (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {project.description || "Sin descripción. Haz clic en Editar para agregar notas."}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Delay notes card - only show if there's a delay category */}
      {(editing || (project as any).delay_category) && (
        <Card className="md:col-span-2 border-warning/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Notas de atraso / situación
            </CardTitle>
          </CardHeader>
          <CardContent>
            {editing ? (
              <Textarea
                className="min-h-[80px] text-sm"
                placeholder="Describe la situación: motivo del atraso, factores externos, plan de acción..."
                value={delayNotes}
                onChange={(e) => setDelayNotes(e.target.value)}
              />
            ) : (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {(project as any).delay_notes || "Sin notas de atraso."}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* AI Project Summary */}
      <div className="md:col-span-2">
        <AISummaryCard
          cacheKey={`project-${project.id}`}
          contextPrompt={projectSummaryPrompt}
          title="Resumen del proyecto — Kawiil AI"
          ready={!!projectTasks}
          userId={user?.id}
        />
      </div>

      {/* Meeting Minutes Button */}
      <div className="md:col-span-2">
        <Card className="border-dashed border-primary/20 hover:border-primary/40 transition-colors">
          <CardContent className="py-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Minutas de reunión → Tareas
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sube o pega una minuta y AI propondrá las tareas a crear automáticamente
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowMeetingDialog(true)}>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Analizar minuta
            </Button>
          </CardContent>
        </Card>
      </div>

      <MeetingMinutesDialog
        open={showMeetingDialog}
        onOpenChange={setShowMeetingDialog}
        projectId={project.id}
        clientId={project.client_id}
        area={project.area}
        projectName={project.name}
      />
    </div>
  );
}
