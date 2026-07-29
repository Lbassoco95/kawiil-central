import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Plus, Pencil, Trash2, ListChecks } from "lucide-react";
import { formatDateMX } from "@/lib/dateUtils";
import { TASK_STATUS_CONFIG, PRIORITY_CONFIG } from "@/lib/statusStyles";
import { useProfiles, useCreateTask, useUpdateTask, useDeleteTask } from "@/hooks/useTasks";
import { useActivityTasks, type ActivityTask } from "@/hooks/useActivities";

type TaskStatus = keyof typeof TASK_STATUS_CONFIG;

const STATUS_OPTIONS = (Object.entries(TASK_STATUS_CONFIG) as [TaskStatus, { label: string }][])
  .map(([value, cfg]) => ({ value, label: cfg.label }));
const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG)
  .map(([value, cfg]) => ({ value, label: cfg.label }));

const isClosed = (s: string) => s === "completada" || s === "cancelada";

function TaskDialog({
  activityId, task, trigger,
}: { activityId: string; task?: ActivityTask; trigger: React.ReactNode }) {
  const isEdit = !!task;
  const [open, setOpen] = useState(false);
  const { data: profiles } = useProfiles();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

  const [title, setTitle] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("media");
  const [status, setStatus] = useState<string>("pendiente");

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setAssignedTo(task?.assigned_to ?? "");
    setDueDate(task?.due_date ?? "");
    setPriority(task?.priority ?? "media");
    setStatus(task?.status ?? "pendiente");
  }, [open, task]);

  const profileOptions = (profiles || []).map((p) => ({ value: p.user_id, label: p.full_name }));
  const isPending = createTask.isPending || updateTask.isPending;

  const handleSubmit = () => {
    if (isEdit) {
      updateTask.mutate(
        {
          id: task!.id,
          title: title.trim(),
          assigned_to: assignedTo || null,
          due_date: dueDate || null,
          priority,
          status,
        },
        { onSuccess: () => setOpen(false) },
      );
    } else {
      createTask.mutate(
        {
          title: title.trim(),
          assigned_to: assignedTo || undefined,
          due_date: dueDate || undefined,
          priority,
          status,
          activity_id: activityId,
        },
        { onSuccess: () => setOpen(false) },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar pendiente" : "Nuevo pendiente"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="task-title">Pendiente *</Label>
            <Input id="task-title" placeholder="Ej: Buscar casa / sede"
              value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Responsable</Label>
            <SearchableSelect
              options={profileOptions} value={assignedTo}
              onValueChange={setAssignedTo}
              placeholder="Sin responsable" searchPlaceholder="Buscar persona..."
            />
            <p className="text-xs text-muted-foreground">
              Aparecerá en las tareas y el perfil de la persona asignada.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="task-due">Fecha límite</Label>
              <Input id="task-due" type="date"
                value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Prioridad</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {isEdit && (
            <div className="space-y-2">
              <Label>Estatus</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!title.trim() || isPending}>
            {isEdit ? "Guardar" : "Agregar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ActivityTasksCard({ activityId }: { activityId: string }) {
  const { data: tasks, isLoading } = useActivityTasks(activityId);
  const { data: profiles } = useProfiles();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const list = tasks ?? [];
  const done = list.filter((t) => t.status === "completada").length;
  const nameFor = (uid: string | null) =>
    uid ? (profiles || []).find((p) => p.user_id === uid)?.full_name || "—" : "—";

  const todayYmd = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ListChecks className="h-4 w-4" />
          Pendientes y seguimiento
          {list.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {done}/{list.length} hechos
            </span>
          )}
        </CardTitle>
        <TaskDialog
          activityId={activityId}
          trigger={
            <Button size="sm" variant="outline">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Agregar
            </Button>
          }
        />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Cargando...</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Sin pendientes aún. Agrega el primero: se crea como tarea con responsable y
            fecha límite, y aparece en el perfil de esa persona.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pendiente</TableHead>
                  <TableHead>Responsable</TableHead>
                  <TableHead>Estatus</TableHead>
                  <TableHead>Fecha límite</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((t) => {
                  const overdue = !!t.due_date && t.due_date < todayYmd && !isClosed(t.status);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.title}</TableCell>
                      <TableCell>{nameFor(t.assigned_to)}</TableCell>
                      <TableCell>
                        <Select
                          value={t.status}
                          onValueChange={(v) => updateTask.mutate({ id: t.id, status: v })}
                        >
                          <SelectTrigger className="h-8 w-[140px] text-xs">
                            <Badge variant="outline" className={TASK_STATUS_CONFIG[t.status as TaskStatus]?.color}>
                              {TASK_STATUS_CONFIG[t.status as TaskStatus]?.label ?? t.status}
                            </Badge>
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className={overdue ? "text-destructive font-medium" : ""}>
                        {t.due_date ? formatDateMX(t.due_date) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <TaskDialog
                            activityId={activityId}
                            task={t}
                            trigger={
                              <Button size="icon" variant="ghost" className="h-7 w-7">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            }
                          />
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                            onClick={() => deleteTask.mutate(t.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
