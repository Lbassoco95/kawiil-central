import { Fragment, useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
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
import { Plus, Pencil, Trash2, ListChecks, Images, UserCheck } from "lucide-react";
import { formatDateMX } from "@/lib/dateUtils";
import { TASK_STATUS_CONFIG, PRIORITY_CONFIG } from "@/lib/statusStyles";
import { useProfiles, useCreateTask, useUpdateTask, useDeleteTask } from "@/hooks/useTasks";
import { useActivityTasks, useActivity, useUpdateActivity, type ActivityTask } from "@/hooks/useActivities";
import { useActivityFileCounts } from "@/hooks/useActivityFiles";
import { TaskFilesDialog } from "@/components/actividades/TaskFilesDialog";
import { RubroSelect } from "@/components/actividades/RubroSelect";
import {
  useActivityProviders, useActivityAttendees, useCreateAttendeeConfirmationTasks,
  useCreateActivityProvider, useUpdateActivityProvider,
  type ActivityProvider, type ActivityAttendee,
} from "@/hooks/useActivityExtras";
import { buildRubroOptions, rubroLabel, providerStatusLabel, pendienteSuggestions } from "@/lib/activityTypes";

type TaskStatus = keyof typeof TASK_STATUS_CONFIG;

const STATUS_OPTIONS = (Object.entries(TASK_STATUS_CONFIG) as [TaskStatus, { label: string }][])
  .map(([value, cfg]) => ({ value, label: cfg.label }));
const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG)
  .map(([value, cfg]) => ({ value, label: cfg.label }));

const isClosed = (s: string) => s === "completada" || s === "cancelada";

/** A qué se refiere el pendiente: un rubro (y su proveedor), los invitados, o nada en particular. */
type TaskScope = "rubro" | "asistentes" | "general";
const SCOPE_OPTIONS: { value: TaskScope; label: string }[] = [
  { value: "rubro", label: "Rubro / proveedor" },
  { value: "asistentes", label: "Asistentes" },
  { value: "general", label: "General" },
];
const ATTENDEE_SUGGESTIONS = ["Confirmar asistencia", "Confirmar acompañante (+1)", "Pedir restricciones alimentarias"];

function TaskDialog({
  activityId, task, trigger, providers, rubros, attendees, defaultCategory = "", defaultProviderId = "", defaultAttendeeId = "", defaultScope, activityLocation,
}: {
  activityId: string; task?: ActivityTask; trigger: React.ReactNode;
  providers: ActivityProvider[]; rubros: { value: string; label: string }[];
  attendees: ActivityAttendee[];
  defaultCategory?: string; defaultProviderId?: string; defaultAttendeeId?: string;
  defaultScope?: TaskScope; activityLocation?: string | null;
}) {
  const isEdit = !!task;
  const [open, setOpen] = useState(false);
  const { data: profiles } = useProfiles();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const createProvider = useCreateActivityProvider();
  const updateProvider = useUpdateActivityProvider();
  const updateActivity = useUpdateActivity();

  const [newProvOpen, setNewProvOpen] = useState(false);
  const [newProvName, setNewProvName] = useState("");
  const [newProvDesc, setNewProvDesc] = useState("");
  const [isVenue, setIsVenue] = useState(false);

  const [title, setTitle] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("media");
  const [status, setStatus] = useState<string>("pendiente");
  const [category, setCategory] = useState("");
  const [providerId, setProviderId] = useState("");
  const [attendeeId, setAttendeeId] = useState("");
  const [scope, setScope] = useState<TaskScope>("general");

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setAssignedTo(task?.assigned_to ?? "");
    setDueDate(task?.due_date ?? "");
    setPriority(task?.priority ?? "media");
    setStatus(task?.status ?? "pendiente");
    setCategory(task ? (task.activity_category ?? "") : defaultCategory);
    setProviderId(task ? (task.activity_provider_id ?? "") : defaultProviderId);
    setAttendeeId(task ? (task.activity_attendee_id ?? "") : defaultAttendeeId);
    if (task) {
      setScope(task.activity_attendee_id ? "asistentes"
        : task.activity_category || task.activity_provider_id ? "rubro" : "general");
    } else {
      setScope(defaultScope ?? (defaultAttendeeId ? "asistentes" : "rubro"));
    }
    setNewProvOpen(false); setNewProvName(""); setNewProvDesc("");
    const pv = providers.find((x) => x.id === (task ? task.activity_provider_id : defaultProviderId));
    setIsVenue(!!pv && !!activityLocation && activityLocation.startsWith(pv.name));
    // Solo al abrir: si dependiera de `providers`, crear un proveedor aquí reiniciaría el formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task, defaultCategory, defaultProviderId, defaultAttendeeId, defaultScope]);

  const providerOptions = providers
    .filter((p) => !category || p.category === category)
    .map((p) => ({ value: p.id, label: p.name }));
  const changeCategory = (c: string) => {
    setCategory(c);
    const cur = providers.find((p) => p.id === providerId);
    if (cur && c && cur.category !== c) setProviderId("");
  };
  const changeProvider = (id: string) => {
    setProviderId(id);
    const p = providers.find((x) => x.id === id);
    if (p) setCategory(p.category);
  };

  const isCasas = category === "casas";
  const selectedProvider = providers.find((x) => x.id === providerId);
  const venueText = selectedProvider
    ? [selectedProvider.name, selectedProvider.description].filter(Boolean).join(" — ") : "";

  const createInlineProvider = () => {
    const name = newProvName.trim();
    if (!name) return;
    createProvider.mutate(
      {
        activity_id: activityId, category: category || "otro", name,
        description: newProvDesc.trim() || null, status: "cotizacion",
      },
      { onSuccess: (p) => {
        setProviderId(p.id); setCategory(p.category);
        setNewProvOpen(false); setNewProvName(""); setNewProvDesc("");
      } },
    );
  };

  // Confirmar la sede: se muestra en Detalles de la actividad y el proveedor pasa a "Elegido".
  const applyVenue = () => {
    if (!(scope === "rubro" && isCasas && isVenue && selectedProvider)) return;
    updateActivity.mutate({ id: activityId, location: venueText });
    if (selectedProvider.status === "cotizacion") {
      updateProvider.mutate({ id: selectedProvider.id, status: "elegido" });
    }
  };

  const profileOptions = (profiles || []).map((p) => ({ value: p.user_id, label: p.full_name }));
  const isPending = createTask.isPending || updateTask.isPending;

  const handleSubmit = () => {
    applyVenue();
    if (isEdit) {
      updateTask.mutate(
        {
          id: task!.id,
          title: title.trim(),
          assigned_to: assignedTo || null,
          due_date: dueDate || null,
          priority,
          status,
          activity_category: scope === "rubro" ? category || null : null,
          activity_provider_id: scope === "rubro" ? providerId || null : null,
          activity_attendee_id: scope === "asistentes" ? attendeeId || null : null,
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
          activity_category: scope === "rubro" ? category || null : null,
          activity_provider_id: scope === "rubro" ? providerId || null : null,
          activity_attendee_id: scope === "asistentes" ? attendeeId || null : null,
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
            <Input id="task-title" placeholder={
                scope === "rubro" && category ? `Ej: ${pendienteSuggestions(category)[0]}`
                  : scope === "asistentes" ? "Ej: Confirmar asistencia" : "Ej: Armar la agenda del evento"
              }
              value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Relacionado con</Label>
            <div className="flex flex-wrap gap-1.5">
              {SCOPE_OPTIONS.filter((o) => o.value !== "asistentes" || attendees.length > 0).map((o) => (
                <Button
                  key={o.value} type="button" size="sm" className="h-8"
                  variant={scope === o.value ? "default" : "outline"}
                  onClick={() => setScope(o.value)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>
          {scope === "rubro" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Rubro</Label>
                  <RubroSelect value={category} onChange={changeCategory} options={rubros} />
                </div>
                <div className="space-y-2">
                  <Label>Proveedor (opcional)</Label>
                  <SearchableSelect
                    options={providerOptions} value={providerId} onValueChange={changeProvider}
                    placeholder="Todo el rubro" searchPlaceholder="Buscar proveedor..."
                  />
                  {category && (
                    <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs"
                      onClick={() => setNewProvOpen((v) => !v)}>
                      ＋ {isCasas ? "Crear sede / proveedor" : "Crear proveedor"}
                    </Button>
                  )}
                </div>
              </div>
              {newProvOpen && (
                <div className="rounded-md border p-3 space-y-2">
                  <Input
                    autoFocus placeholder={isCasas ? "Nombre de la sede (ej: Casa Chinaco)" : "Nombre del proveedor"}
                    value={newProvName} onChange={(e) => setNewProvName(e.target.value)}
                  />
                  <Input
                    placeholder={isCasas ? "Dirección o datos de la sede (opcional)" : "Descripción (opcional)"}
                    value={newProvDesc} onChange={(e) => setNewProvDesc(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setNewProvOpen(false)}>Cancelar</Button>
                    <Button type="button" size="sm" onClick={createInlineProvider}
                      disabled={!newProvName.trim() || createProvider.isPending}>
                      Crear y usar
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Se agrega también en la pestaña Proveedores (en cotización).
                  </p>
                </div>
              )}
              {isCasas && selectedProvider && (
                <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div>
                    <Label htmlFor="task-venue">Es la sede del evento</Label>
                    <p className="text-xs text-muted-foreground">
                      Al guardar, “{venueText}” se muestra como Sede / Lugar en Detalles para confirmarla a
                      los invitados, y el proveedor pasa a Elegido.
                    </p>
                  </div>
                  <Switch id="task-venue" checked={isVenue} onCheckedChange={setIsVenue} />
                </div>
              )}
              {!isEdit && category && (
                <div className="flex flex-wrap gap-1.5">
                  {pendienteSuggestions(category).map((sug) => (
                    <Button key={sug} type="button" size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => setTitle(sug)}>
                      {sug}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          {scope === "asistentes" && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Invitado (opcional)</Label>
                <SearchableSelect
                  options={attendees.map((a) => ({ value: a.id, label: a.name }))}
                  value={attendeeId} onValueChange={setAttendeeId}
                  placeholder="Todos los invitados" searchPlaceholder="Buscar invitado..."
                />
                <p className="text-xs text-muted-foreground">
                  Los asistentes son las personas invitadas. Déjalo vacío si aplica a todos.
                </p>
              </div>
              {!isEdit && (
                <div className="flex flex-wrap gap-1.5">
                  {ATTENDEE_SUGGESTIONS.map((sug) => {
                    const who = attendees.find((a) => a.id === attendeeId)?.name;
                    return (
                      <Button key={sug} type="button" size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => setTitle(who ? `${sug} de ${who}` : sug)}>
                        {sug}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label>Responsable (quién lo hace)</Label>
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

  const { data: fileCounts } = useActivityFileCounts(activityId);
  const { data: providersData } = useActivityProviders(activityId);
  const providers = providersData ?? [];
  const { data: activityData } = useActivity(activityId);
  const { data: attendeesData } = useActivityAttendees(activityId);
  const attendees = attendeesData ?? [];
  const attendeeById = new Map(attendees.map((a) => [a.id, a]));
  const createConfirmations = useCreateAttendeeConfirmationTasks();
  const list = tasks ?? [];
  const providerById = new Map(providers.map((p) => [p.id, p]));
  const catOf = (t: ActivityTask) =>
    t.activity_attendee_id ? "__asistentes__" : t.activity_category || (t.activity_provider_id ? providerById.get(t.activity_provider_id)?.category : "") || "";
  const rubros = buildRubroOptions([...providers.map((p) => p.category), ...list.map((t) => t.activity_category)]);
  const groups: { key: string; label: string; tasks: ActivityTask[]; providers: ActivityProvider[] }[] = [];
  const keys = [...rubros.map((r) => r.value)];
  for (const k of keys) {
    const gt = list.filter((t) => catOf(t).toLowerCase() === k.toLowerCase());
    const gp = providers.filter((p) => p.category.toLowerCase() === k.toLowerCase());
    if (gt.length || gp.length) groups.push({ key: k, label: rubroLabel(k), tasks: gt, providers: gp });
  }
  const attTasks = list.filter((t) => catOf(t) === "__asistentes__");
  if (attTasks.length || attendees.length) {
    groups.push({ key: "__asistentes__", label: "Asistentes", tasks: attTasks, providers: [] });
  }
  const general = list.filter((t) => !catOf(t));

  const pedirConfirmaciones = () => {
    const titles = new Set(list.filter((t) => t.activity_attendee_id).map((t) => `${t.activity_attendee_id}|${t.title}`));
    const rows: { attendeeId: string; title: string }[] = [];
    for (const a of attendees) {
      const own = `Confirmar asistencia de ${a.name}`;
      if (a.confirmed === "pendiente" && !titles.has(`${a.id}|${own}`)) rows.push({ attendeeId: a.id, title: own });
      const plus = `Confirmar acompañante de ${a.name}`;
      if (a.has_plus_one && a.plus_one_confirmed === "pendiente" && !titles.has(`${a.id}|${plus}`)) {
        rows.push({ attendeeId: a.id, title: plus });
      }
    }
    createConfirmations.mutate({ activityId, rows });
  };
  if (general.length) groups.push({ key: "", label: "General", tasks: general, providers: [] });
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
          providers={providers} rubros={rubros} attendees={attendees} activityLocation={activityData?.location}
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
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Sin pendientes aún. Agrega el primero y asígnalo a un rubro y proveedor (ej. Alimentos →
            DELIFOOD → “Comida lista”): se crea como tarea con responsable y fecha límite, y
            aparece en el perfil de esa persona.
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
                  <TableHead>Cotizaciones</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => {
                  const gDone = g.tasks.filter((x) => x.status === "completada").length;
                  const active = g.providers.filter((p) => p.status !== "descartado" && p.status !== "cotizacion");
                  return (
                  <Fragment key={g.key || "__general__"}>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={6}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{g.label}</span>
                            {g.tasks.length > 0 && (
                              <span className="text-xs text-muted-foreground">{gDone}/{g.tasks.length} hechos</span>
                            )}
                            {g.providers.length > 0 && (
                              <span className="text-xs text-muted-foreground">
                                · {active.length > 0
                                  ? active.map((p) => `${p.name} (${providerStatusLabel(p.status)})`).join(", ")
                                  : `${g.providers.length} en cotización`}
                              </span>
                            )}
                          </div>
                          {g.key === "__asistentes__" && attendees.length > 0 && (
                            <Button
                              size="sm" variant="outline" className="h-7 text-xs"
                              onClick={pedirConfirmaciones} disabled={createConfirmations.isPending}
                            >
                              <UserCheck className="mr-1 h-3 w-3" />Pedir confirmaciones
                            </Button>
                          )}
                          <TaskDialog
                            activityId={activityId}
                            providers={providers} rubros={rubros} attendees={attendees} activityLocation={activityData?.location}
                            defaultCategory={g.key === "__asistentes__" ? "" : g.key}
                            defaultScope={g.key === "__asistentes__" ? "asistentes" : g.key ? "rubro" : "general"}
                            trigger={
                              <Button size="sm" variant="ghost" className="h-7 text-xs">
                                <Plus className="mr-1 h-3 w-3" />Pendiente
                              </Button>
                            }
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                    {g.tasks.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-xs text-muted-foreground">
                          Sin pendientes todavía.
                        </TableCell>
                      </TableRow>
                    )}
                {g.tasks.map((t) => {
                  const overdue = !!t.due_date && t.due_date < todayYmd && !isClosed(t.status);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        {t.title}
                        {t.activity_attendee_id && attendeeById.get(t.activity_attendee_id) && (
                          <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                            {attendeeById.get(t.activity_attendee_id)!.name}
                          </Badge>
                        )}
                        {t.activity_provider_id && providerById.get(t.activity_provider_id) && (
                          <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                            {providerById.get(t.activity_provider_id)!.name}
                          </Badge>
                        )}
                      </TableCell>
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
                        <TaskFilesDialog
                          activityId={activityId}
                          taskId={t.id}
                          taskTitle={t.title}
                          trigger={
                            <Button size="sm" variant="outline" className="h-8 gap-1.5">
                              <Images className="h-3.5 w-3.5" />
                              {fileCounts?.[t.id] ? fileCounts[t.id] : "Subir"}
                            </Button>
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <TaskDialog
                            activityId={activityId}
                            task={t}
                            providers={providers} rubros={rubros} attendees={attendees} activityLocation={activityData?.location}
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
                  </Fragment>
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
