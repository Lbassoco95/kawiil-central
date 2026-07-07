import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateTask } from "@/hooks/useTasks";
import { useClients } from "@/hooks/useClients";
import { useProjects } from "@/hooks/useProjects";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { CheckSquare, Loader2, MapPin, Clock } from "lucide-react";
import { toast } from "sonner";
import { formatMX } from "@/lib/dateUtils";
import { parseISO } from "date-fns";

const UNASSIGNED_VALUE = "__unassigned__";
const NO_CLIENT_VALUE = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Evento de Outlook/Graph (o el evento cacheado del calendario). */
  event: {
    subject?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    location?: { displayName?: string } | null;
    body?: { content?: string };
    attendees?: Array<{ emailAddress?: { address?: string; name?: string } }>;
    categories?: string[];
  } | null;
}

function stripHtml(content: unknown): string {
  if (typeof content !== "string") return "";
  try {
    return content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

export function CreateTaskFromEventDialog({ open, onOpenChange, event }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("media");
  const [assignedTo, setAssignedTo] = useState(UNASSIGNED_VALUE);
  const [clientId, setClientId] = useState(NO_CLIENT_VALUE);
  const [projectId, setProjectId] = useState("");
  const [dueDate, setDueDate] = useState("");

  const createTask = useCreateTask();
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const { data: users } = useOrgUsers();

  const startRaw = event?.start?.dateTime || event?.start?.date;
  const startDate = useMemo(() => {
    if (!startRaw) return null;
    try {
      const d = parseISO(startRaw);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }, [startRaw]);

  const eventLocation = event?.location?.displayName || "";

  const derivedDescription = useMemo(() => {
    const parts: string[] = [];
    if (startDate) parts.push(`Evento: ${formatMX(startDate, "EEEE d 'de' MMMM, yyyy · HH:mm")}`);
    if (eventLocation) parts.push(`Lugar: ${eventLocation}`);
    const attendees = (event?.attendees || [])
      .map((a) => a?.emailAddress?.name || a?.emailAddress?.address)
      .filter(Boolean);
    if (attendees.length) parts.push(`Invitados: ${attendees.join(", ")}`);
    const body = stripHtml(event?.body?.content);
    if (body) parts.push(`\n${body.substring(0, 500)}`);
    return parts.join("\n");
  }, [startDate, eventLocation, event]);

  // Prellenar al abrir
  useEffect(() => {
    if (!open) return;
    setTitle(event?.subject ? event.subject : "Actividad de evento");
    setDescription(derivedDescription);
    setPriority("media");
    setAssignedTo(UNASSIGNED_VALUE);
    setClientId(NO_CLIENT_VALUE);
    setProjectId("");
    setDueDate(startDate ? formatMX(startDate, "yyyy-MM-dd") : "");
  }, [open, event, derivedDescription, startDate]);

  const projectOptions = useMemo(() => {
    const filtered =
      clientId !== NO_CLIENT_VALUE
        ? projects?.filter((p) => p.client_id === clientId)
        : projects;
    return [
      { value: NO_CLIENT_VALUE, label: "Sin proyecto" },
      ...(filtered ?? [])
        .map((p) => ({ value: p.id, label: p.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    ];
  }, [projects, clientId]);

  const clientOptions = useMemo(
    () => [
      { value: NO_CLIENT_VALUE, label: "Sin cliente" },
      ...(clients ?? [])
        .map((c) => ({ value: c.id, label: c.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    ],
    [clients],
  );

  const handleClientChange = (value: string) => {
    setClientId(value);
    if (!projectId) return;
    const proj = projects?.find((p) => p.id === projectId);
    const nextClient = value === NO_CLIENT_VALUE ? "" : value;
    if (proj && nextClient && proj.client_id !== nextClient) setProjectId("");
  };

  const handleProjectChange = (value: string) => {
    const nextProjectId = value === NO_CLIENT_VALUE ? "" : value;
    setProjectId(nextProjectId);
    if (nextProjectId && clientId === NO_CLIENT_VALUE) {
      const proj = projects?.find((p) => p.id === nextProjectId);
      if (proj?.client_id) setClientId(proj.client_id);
    }
  };

  const handleCreate = () => {
    if (!title.trim()) return;
    createTask.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        due_date: dueDate || undefined,
        assigned_to: assignedTo === UNASSIGNED_VALUE ? undefined : assignedTo,
        client_id: clientId === NO_CLIENT_VALUE ? undefined : clientId,
        project_id: projectId || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Tarea creada desde el evento");
          onOpenChange(false);
        },
        onError: () => toast.error("No se pudo crear la tarea"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckSquare className="h-4 w-4" /> Crear tarea desde el evento
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {(startDate || eventLocation) && (
            <div className="rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground space-y-1">
              {startDate && (
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>{formatMX(startDate, "EEEE d 'de' MMMM · HH:mm")}</span>
                </div>
              )}
              {eventLocation && (
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{eventLocation}</span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Título de la actividad</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Acudir a emplazamiento" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Vencimiento</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Prioridad</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="baja">Baja</SelectItem>
                  <SelectItem value="media">Media</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Cliente</Label>
            <SearchableSelect
              value={clientId}
              onValueChange={handleClientChange}
              options={clientOptions}
              placeholder="Sin cliente"
            />
          </div>

          <div className="space-y-2">
            <Label>Proyecto</Label>
            <SearchableSelect
              value={projectId || NO_CLIENT_VALUE}
              onValueChange={handleProjectChange}
              options={projectOptions}
              placeholder="Sin proyecto"
            />
          </div>

          <div className="space-y-2">
            <Label>Responsable</Label>
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED_VALUE}>Sin asignar</SelectItem>
                {(users ?? []).map((u: any) => (
                  <SelectItem key={u.user_id || u.id} value={u.user_id || u.id}>
                    {u.full_name || u.email || "Usuario"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Notas</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleCreate} disabled={createTask.isPending || !title.trim()}>
            {createTask.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crear tarea
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
