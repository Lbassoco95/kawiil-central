import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, CheckSquare, Calendar, User, Trash2, ClipboardList, ArrowRight } from "lucide-react";
import { useTasks, useDeleteTask } from "@/hooks/useTasks";
import { useUserRole } from "@/hooks/useUserRole";
import { useAssignedSteps } from "@/hooks/useAssignedSteps";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { AISummaryCard } from "@/components/shared/AISummaryCard";
import { useAreaOptions } from "@/hooks/useAreaOptions";
import { useAuth } from "@/contexts/AuthContext";
import { formatMX } from "@/lib/dateUtils";

const priorityColors: Record<string, string> = {
  urgente: "bg-destructive/10 text-destructive",
  alta: "bg-warning/10 text-warning",
  media: "bg-primary/10 text-primary",
  baja: "bg-success/10 text-success",
};

const statusLabels: Record<string, { label: string; color: string }> = {
  pendiente: { label: "Pendiente", color: "bg-muted text-muted-foreground" },
  en_progreso: { label: "En progreso", color: "bg-primary/10 text-primary" },
  en_revision: { label: "En revisión", color: "bg-warning/10 text-warning" },
  completada: { label: "Completada", color: "bg-success/10 text-success" },
  cancelada: { label: "Cancelada", color: "bg-destructive/10 text-destructive" },
};

const stepStatusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  en_espera_cliente: "Esperando cliente",
  completado: "Completado",
};

const Tareas = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [area, setArea] = useState("todas");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const deleteTask = useDeleteTask();
  const { isAdminOrManager } = useUserRole();
  const { areaOptions, areaLabelMap } = useAreaOptions();
  const { data: assignedSteps = [] } = useAssignedSteps();

  const { data: tasks, isLoading } = useTasks({
    area: area !== "todas" ? area : undefined,
    search: search || undefined,
  });

  const tasksSummaryPrompt = useMemo(() => {
    if (!tasks) return "";
    const pending = tasks.filter((t: any) => ["pendiente", "en_progreso", "en_revision"].includes(t.status));
    const overdue = pending.filter((t: any) => t.due_date && new Date(t.due_date) < new Date());
    const critical = tasks.filter((t: any) => (t as any).criticality_level === "critico");
    const byPriority: Record<string, number> = {};
    const byArea: Record<string, number> = {};
    pending.forEach((t: any) => {
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      if (t.area) byArea[areaLabelMap[t.area] || t.area] = (byArea[areaLabelMap[t.area] || t.area] || 0) + 1;
    });

    return `Genera un resumen breve del estado de las tareas del equipo. Español mexicano, tono profesional, emojis.

DATOS:
- Total tareas visibles: ${tasks.length}
- Pendientes: ${pending.length}
- Vencidas: ${overdue.length}
- Críticas (semáforo rojo): ${critical.length}
- Pasos de proyecto asignados a mí: ${assignedSteps.length}

POR PRIORIDAD: ${Object.entries(byPriority).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}
POR CÉLULA: ${Object.entries(byArea).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}

TAREAS VENCIDAS MÁS ANTIGUAS:
${overdue.slice(0, 5).map((t: any) => `- ${t.title} (${t.priority}, vence: ${t.due_date})`).join("\n") || "Ninguna"}

INSTRUCCIONES:
1. Resume en 3-4 puntos el panorama de tareas con emojis.
2. Si hay vencidas, menciona las más urgentes.
3. Si hay críticas, destácalas.
4. Sugiere por dónde empezar hoy.
5. Máximo 100 palabras. Usa markdown.`;
  }, [tasks, assignedSteps, areaLabelMap]);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Tareas</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Gestión de tareas y actividades internas</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Nueva tarea
          </Button>
        </div>

        {/* AI Tasks Summary */}
        <AISummaryCard
          cacheKey={`tasks-${user?.id}-${area}`}
          contextPrompt={tasksSummaryPrompt}
          title="Panorama de tareas — Kawiil AI"
          ready={!!tasks && tasks.length > 0}
          userId={user?.id}
        />

        {/* Assigned project steps */}
        {assignedSteps.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Mis pasos de proyecto asignados</h2>
              <span className="text-[10px] text-muted-foreground">{assignedSteps.length}</span>
            </div>
            <div className="space-y-px">
              {assignedSteps.slice(0, 10).map((step) => (
                <div
                  key={step.id}
                  className="flex items-center gap-3 text-sm cursor-pointer hover:bg-secondary/40 rounded-lg px-3 py-2.5 transition-colors"
                  onClick={() => navigate(`/proyectos/${step.projectId}`)}
                >
                  <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded shrink-0">{step.sourceLabel}</span>
                  <span className="flex-1 truncate text-[13px] font-medium text-foreground">{step.stepLabel}</span>
                  {step.clientName && (
                    <span className="text-[11px] text-muted-foreground shrink-0">{step.clientName}</span>
                  )}
                  {step.dueDate && (
                    <span className="text-[11px] text-muted-foreground shrink-0 flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatMX(step.dueDate, "dd MMM")}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded shrink-0">
                    {stepStatusLabels[step.status] || step.status}
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                </div>
              ))}
              {assignedSteps.length > 10 && (
                <p className="text-[11px] text-muted-foreground text-center py-1">
                  +{assignedSteps.length - 10} pasos más
                </p>
              )}
            </div>
          </section>
        )}

        {/* Area filter pills */}
        <div className="flex flex-wrap gap-1.5">
          {[{ value: "todas", label: "Todas" }, ...areaOptions].map((a) => {
            const isActive = area === a.value;
            return (
              <button
                key={a.value}
                onClick={() => setArea(a.value)}
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {a.label}
              </button>
            );
          })}
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar tareas..."
            className="pl-9 h-9 text-sm bg-secondary/30 border-0 focus-visible:ring-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isLoading ? (
          <p className="text-center text-muted-foreground py-12 text-sm">Cargando tareas...</p>
        ) : tasks && tasks.length > 0 ? (
          <div className="divide-y divide-border/40">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between gap-4 py-3 px-2 -mx-2 rounded-lg hover:bg-secondary/30 transition-colors cursor-pointer"
                onClick={() => setSelectedTaskId(task.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-[13px] font-medium text-foreground truncate">{task.title}</h3>
                    <Badge className={`text-[10px] border-0 px-1.5 py-0 ${priorityColors[task.priority]}`} variant="secondary">{task.priority}</Badge>
                    <Badge className={`text-[10px] border-0 px-1.5 py-0 ${statusLabels[task.status]?.color}`} variant="secondary">{statusLabels[task.status]?.label}</Badge>
                    {(task as any).criticality_level === "critico" && <span className="text-[10px]" title="Crítico">🔴</span>}
                    {(task as any).criticality_level === "atencion" && <span className="text-[10px]" title="Atención">🟡</span>}
                    {(task as any).delay_category && <Badge variant="outline" className="text-[9px] px-1 py-0 border-warning/50 text-warning">⚠ Atraso</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    {task.area && <span>{areaLabelMap[task.area] || task.area}</span>}
                    {(task as any).clients?.name && (
                      <span className="flex items-center gap-1"><User className="h-3 w-3" />{(task as any).clients.name}</span>
                    )}
                    {(task as any).projects?.name && <span>{(task as any).projects.name}</span>}
                    {task.due_date && (
                      <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatMX(task.due_date, "dd MMM yyyy")}</span>
                    )}
                  </div>
                </div>
                {isAdminOrManager && (
                  <button
                    className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: task.id, title: task.title }); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <CheckSquare className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <h3 className="mt-3 text-sm font-medium text-foreground">Sin tareas aún</h3>
            <p className="mt-1 text-xs text-muted-foreground">Crea tu primera tarea para comenzar a organizar el trabajo.</p>
            <Button className="mt-3" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Crear tarea
            </Button>
          </div>
        )}
      </div>

      <TaskFormDialog open={showCreate} onOpenChange={setShowCreate} />
      <TaskDetailDialog taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`¿Eliminar tarea "${deleteTarget?.title}"?`}
        description="Se eliminará la tarea permanentemente junto con sus comentarios y asignaciones."
        onConfirm={async () => { if (deleteTarget) { await deleteTask.mutateAsync(deleteTarget.id); setDeleteTarget(null); } }}
        isPending={deleteTask.isPending}
      />
    </AppLayout>
  );
};

export default Tareas;
