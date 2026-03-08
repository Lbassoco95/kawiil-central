import { useState } from "react";
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
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(project.description || "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [startDate, setStartDate] = useState(project.start_date || "");
  const [endDate, setEndDate] = useState(project.end_date || "");
  const [criticalityLevel, setCriticalityLevel] = useState((project as any).criticality_level || "normal");
  const [delayCategory, setDelayCategory] = useState((project as any).delay_category || "");
  const [delayNotes, setDelayNotes] = useState((project as any).delay_notes || "");

  const handleSave = () => {
    updateProject.mutate(
      {
        id: project.id,
        description: description || null,
        status,
        start_date: startDate || null,
        end_date: endDate || null,
      },
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
    setEditing(false);
  };

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
    </div>
  );
}
