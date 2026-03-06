import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, CheckSquare, Calendar, User, Trash2, ClipboardList, ArrowRight } from "lucide-react";
import { useTasks, useDeleteTask } from "@/hooks/useTasks";
import { useAssignedSteps } from "@/hooks/useAssignedSteps";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { useAreaOptions } from "@/hooks/useAreaOptions";
import { formatMX } from "@/lib/dateUtils";

const priorityColors: Record<string, string> = {
  urgente: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  alta: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  media: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  baja: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

const statusLabels: Record<string, { label: string; color: string }> = {
  pendiente: { label: "Pendiente", color: "bg-muted text-muted-foreground" },
  en_progreso: { label: "En progreso", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  en_revision: { label: "En revisión", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  completada: { label: "Completada", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  cancelada: { label: "Cancelada", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
};

const stepStatusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  en_espera_cliente: "Esperando cliente",
  completado: "Completado",
};

const Tareas = () => {
  const navigate = useNavigate();
  const [area, setArea] = useState("todas");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const deleteTask = useDeleteTask();
  const { areaOptions, areaLabelMap } = useAreaOptions();
  const { data: assignedSteps = [] } = useAssignedSteps();

  const { data: tasks, isLoading } = useTasks({
    area: area !== "todas" ? area : undefined,
    search: search || undefined,
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Tareas</h1>
            <p className="text-sm text-muted-foreground">Gestión de tareas y actividades internas</p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" /> Nueva tarea
          </Button>
        </div>

        {/* Assigned project steps */}
        {assignedSteps.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                Mis pasos de proyecto asignados
                <Badge variant="secondary">{assignedSteps.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-1">
                {assignedSteps.slice(0, 10).map((step) => (
                  <div
                    key={step.id}
                    className="flex items-center gap-3 text-sm cursor-pointer hover:bg-muted/50 rounded-md px-3 py-2 transition-colors"
                    onClick={() => navigate(`/proyectos/${step.projectId}`)}
                  >
                    <Badge variant="outline" className="text-xs shrink-0">{step.sourceLabel}</Badge>
                    <span className="flex-1 truncate font-medium">{step.stepLabel}</span>
                    {step.clientName && (
                      <span className="text-xs text-muted-foreground shrink-0">{step.clientName}</span>
                    )}
                    {step.dueDate && (
                      <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatMX(step.dueDate, "dd MMM")}
                      </span>
                    )}
                    <Badge variant="outline" className="text-xs shrink-0">
                      {stepStatusLabels[step.status] || step.status}
                    </Badge>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  </div>
                ))}
                {assignedSteps.length > 10 && (
                  <p className="text-xs text-muted-foreground text-center py-1">
                    +{assignedSteps.length - 10} pasos más
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={area} onValueChange={setArea}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="todas">Todas</TabsTrigger>
            {areaOptions.map((a) => (
              <TabsTrigger key={a.value} value={a.value}>{a.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar tareas..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {isLoading ? (
          <Card><CardContent className="p-6 text-center text-muted-foreground">Cargando tareas...</CardContent></Card>
        ) : tasks && tasks.length > 0 ? (
          <div className="space-y-2">
            {tasks.map((task) => (
              <Card key={task.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedTaskId(task.id)}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-foreground truncate">{task.title}</h3>
                        <Badge className={priorityColors[task.priority]} variant="secondary">{task.priority}</Badge>
                        <Badge className={statusLabels[task.status]?.color} variant="secondary">{statusLabels[task.status]?.label}</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {task.area && <span className="capitalize">{areaLabelMap[task.area] || task.area}</span>}
                        {(task as any).clients?.name && (
                          <span className="flex items-center gap-1"><User className="h-3 w-3" />{(task as any).clients.name}</span>
                        )}
                        {(task as any).projects?.name && <span>{(task as any).projects.name}</span>}
                        {task.due_date && (
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatMX(task.due_date, "dd MMM yyyy")}</span>
                        )}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: task.id, title: task.title }); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-6">
              <div className="text-center py-12">
                <CheckSquare className="mx-auto h-12 w-12 text-muted-foreground/50" />
                <h3 className="mt-4 text-lg font-medium text-foreground">Sin tareas aún</h3>
                <p className="mt-1 text-sm text-muted-foreground">Crea tu primera tarea para comenzar a organizar el trabajo.</p>
                <Button className="mt-4" onClick={() => setShowCreate(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Crear tarea
                </Button>
              </div>
            </CardContent>
          </Card>
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
