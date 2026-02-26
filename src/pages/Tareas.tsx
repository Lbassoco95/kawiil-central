import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, CheckSquare, Calendar, User, Flag } from "lucide-react";
import { useTasks } from "@/hooks/useTasks";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { format } from "date-fns";
import { es } from "date-fns/locale";

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

const Tareas = () => {
  const [area, setArea] = useState("todas");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

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
            <Plus className="mr-2 h-4 w-4" />
            Nueva tarea
          </Button>
        </div>

        <Tabs value={area} onValueChange={setArea}>
          <TabsList>
            <TabsTrigger value="todas">Todas</TabsTrigger>
            <TabsTrigger value="contabilidad">Contabilidad</TabsTrigger>
            <TabsTrigger value="legal">Legal</TabsTrigger>
            <TabsTrigger value="softlanding">Softlanding</TabsTrigger>
            <TabsTrigger value="pld_ft">PLD/FT</TabsTrigger>
            <TabsTrigger value="juicios">Juicios</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar tareas..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <Card><CardContent className="p-6 text-center text-muted-foreground">Cargando tareas...</CardContent></Card>
        ) : tasks && tasks.length > 0 ? (
          <div className="space-y-2">
            {tasks.map((task) => (
              <Card
                key={task.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => setSelectedTaskId(task.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-foreground truncate">{task.title}</h3>
                        <Badge className={priorityColors[task.priority]} variant="secondary">
                          {task.priority}
                        </Badge>
                        <Badge className={statusLabels[task.status]?.color} variant="secondary">
                          {statusLabels[task.status]?.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {task.area && <span className="capitalize">{task.area.replace("_", "/")}</span>}
                        {(task as any).clients?.name && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />{(task as any).clients.name}
                          </span>
                        )}
                        {(task as any).projects?.name && (
                          <span>{(task as any).projects.name}</span>
                        )}
                        {task.due_date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(task.due_date), "dd MMM yyyy", { locale: es })}
                          </span>
                        )}
                      </div>
                    </div>
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
                <p className="mt-1 text-sm text-muted-foreground">
                  Crea tu primera tarea para comenzar a organizar el trabajo.
                </p>
                <Button className="mt-4" onClick={() => setShowCreate(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Crear tarea
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <TaskFormDialog open={showCreate} onOpenChange={setShowCreate} />
      <TaskDetailDialog taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
    </AppLayout>
  );
};

export default Tareas;
