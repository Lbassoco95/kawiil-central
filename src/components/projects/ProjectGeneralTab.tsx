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
import { Save, Pencil, X, AlertTriangle } from "lucide-react";
import { useUpdateProject, type Project } from "@/hooks/useProjects";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AISummaryCard } from "@/components/shared/AISummaryCard";
import { formatDateMX } from "@/lib/dateUtils";
import type { Database } from "@/integrations/supabase/types";

const CRITICALITY_OPTIONS = [
  { value: "normal", label: "🟢 Normal", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  { value: "atencion", label: "🟡 Atención", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  { value: "critico", label: "🔴 Crítico", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
];

const DELAY_CATEGORIES = [
  { value: "__none__", label: "Sin atraso" },
  { value: "atraso_cliente", label: "Atraso del cliente" },
  { value: "atraso_sat", label: "Atraso del SAT / autoridad" },
  { value: "recurso_interno", label: "Recurso interno" },
  { value: "dependencia_externa", label: "Dependencia externa" },
  { value: "otro", label: "Otro" },
];

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

  const clientName = (project as any).clients?.name || "Interno";
  const areaLabel = SERVICE_LABELS[project.area || ""] || project.area || "Sin área";

  const projectSummaryPrompt = useMemo(() => {
    const tasks = projectTasks ?? [];
    const pending = tasks.filter(t => ["pendiente", "en_progreso", "en_revision"].includes(t.status));
    const completed = tasks.filter(t => t.status === "completada");
    const overdue = pending.filter(t => t.due_date && new Date(t.due_date) < new Date());
    const totalPct = tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0;

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

TAREAS:
- Total: ${tasks.length}
- Completadas: ${completed.length} (${totalPct}%)
- Pendientes: ${pending.length}
- Vencidas: ${overdue.length}
${pending.slice(0, 8).map(t => `  • ${t.title} [${t.priority}] ${t.due_date ? `vence: ${t.due_date}` : ""}`).join("\n")}

INSTRUCCIONES:
1. Resume en 3-4 puntos el estado actual del proyecto con emojis.
2. Indica el porcentaje de avance y qué falta por hacer.
3. Si hay tareas vencidas o semáforo en atención/crítico, destácalo.
4. Si hay motivo de atraso, explícalo con contexto.
5. Sugiere la siguiente acción prioritaria.
6. Máximo 100 palabras. Usa markdown.`;
  }, [project, projectTasks, clientName, areaLabel]);

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
    </div>
  );
}
