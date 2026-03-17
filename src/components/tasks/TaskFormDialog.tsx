import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateTask, useProfiles } from "@/hooks/useTasks";
import { useClients } from "@/hooks/useClients";
import { useProjects } from "@/hooks/useProjects";
import { useAreaOptions } from "@/hooks/useAreaOptions";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Link } from "lucide-react";
import { toast } from "sonner";
import { AIDescriptionButton } from "@/components/tasks/AIDescriptionButton";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
  defaultClientId?: string;
  defaultArea?: string;
}

export function TaskFormDialog({ open, onOpenChange, defaultProjectId, defaultClientId, defaultArea }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [area, setArea] = useState<string>(defaultArea || "");
  const [priority, setPriority] = useState("media");
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [additionalAssignees, setAdditionalAssignees] = useState<string[]>([]);
  const [clientId, setClientId] = useState(defaultClientId || "");
  const [projectId, setProjectId] = useState(defaultProjectId || "");
  const [dropboxLinks, setDropboxLinks] = useState<string[]>([]);
  const [newLink, setNewLink] = useState("");

  const createTask = useCreateTask();
  const { data: profiles } = useProfiles();
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const { areaOptions } = useAreaOptions();

  const sortedAreaOptions = useMemo(
    () => [...areaOptions].sort((a, b) => a.label.localeCompare(b.label, "es")),
    [areaOptions]
  );

  const profileOptions = useMemo(
    () =>
      (profiles ?? [])
        .map((p) => ({ value: p.user_id, label: p.full_name }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    [profiles]
  );

  const clientOptions = useMemo(
    () => [
      { value: "__none__", label: "Sin cliente (interna)" },
      ...(clients ?? [])
        .map((c) => ({ value: c.id, label: c.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    ],
    [clients]
  );

  const projectOptions = useMemo(
    () => {
      const filtered = clientId
        ? projects?.filter((p: any) => p.client_id === clientId)
        : projects;
      return [
        { value: "__none__", label: "Sin proyecto" },
        ...(filtered ?? [])
          .map((p) => ({ value: p.id, label: p.name }))
          .sort((a, b) => a.label.localeCompare(b.label, "es")),
      ];
    },
    [projects, clientId]
  );

  const availableAssignees = useMemo(
    () => profileOptions.filter((p) => p.value !== assignedTo && !additionalAssignees.includes(p.value)),
    [profileOptions, assignedTo, additionalAssignees]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignedTo) {
      toast.error("Debes asignar un responsable");
      return;
    }
    if (!description.trim()) {
      toast.error("La descripción es obligatoria");
      return;
    }
    createTask.mutate(
      {
        title,
        description,
        area: area || undefined,
        priority,
        due_date: dueDate || undefined,
        assigned_to: assignedTo,
        client_id: clientId || undefined,
        project_id: projectId || undefined,
        additional_assignees: additionalAssignees,
        dropbox_links: dropboxLinks,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          resetForm();
        },
      }
    );
  };

  const resetForm = () => {
    setTitle(""); setDescription(""); setArea(""); setPriority("media");
    setDueDate(""); setAssignedTo(""); setAdditionalAssignees([]);
    setClientId(""); setProjectId(""); setDropboxLinks([]); setNewLink("");
  };

  const addAssignee = (userId: string) => {
    if (userId && !additionalAssignees.includes(userId) && userId !== assignedTo) {
      setAdditionalAssignees([...additionalAssignees, userId]);
    }
  };

  const removeAssignee = (userId: string) => {
    setAdditionalAssignees(additionalAssignees.filter((a) => a !== userId));
  };

  const addLink = () => {
    if (newLink.trim()) {
      setDropboxLinks([...dropboxLinks, newLink.trim()]);
      setNewLink("");
    }
  };

  const priorityOptions = [
    { value: "urgente", label: "🔴 Urgente" },
    { value: "alta", label: "🟠 Alta" },
    { value: "media", label: "🟡 Media" },
    { value: "baja", label: "🟢 Baja" },
  ];


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva tarea</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Título *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Describe la tarea..." />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Descripción *</Label>
              <AIDescriptionButton title={title} onGenerated={setDescription} />
            </div>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe de qué se trata esta tarea..." rows={3} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Célula</Label>
              <SearchableSelect
                options={sortedAreaOptions}
                value={area}
                onValueChange={setArea}
                placeholder="Seleccionar célula"
                searchPlaceholder="Buscar célula..."
              />
            </div>
            <div>
              <Label>Prioridad</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {priorityOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>


          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Fecha límite</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <Label>Responsable principal *</Label>
              <SearchableSelect
                options={profileOptions}
                value={assignedTo}
                onValueChange={setAssignedTo}
                placeholder="Asignar a..."
                searchPlaceholder="Buscar persona..."
              />
            </div>
          </div>

          {/* Additional assignees */}
          <div>
            <Label>Colaboradores adicionales</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {additionalAssignees.map((uid) => {
                const p = profiles?.find((pr) => pr.user_id === uid);
                return (
                  <Badge key={uid} variant="secondary" className="gap-1">
                    {p?.full_name || uid}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => removeAssignee(uid)} />
                  </Badge>
                );
              })}
            </div>
            <SearchableSelect
              options={availableAssignees}
              value=""
              onValueChange={addAssignee}
              placeholder="Agregar colaborador..."
              searchPlaceholder="Buscar colaborador..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Cliente <span className="text-xs text-muted-foreground">(dejar vacío para tarea interna)</span></Label>
              <SearchableSelect
                options={clientOptions}
                value={clientId || "__none__"}
                onValueChange={(v) => setClientId(v === "__none__" ? "" : v)}
                placeholder="Tarea interna"
                searchPlaceholder="Buscar cliente..."
              />
            </div>
            <div>
              <Label>Proyecto</Label>
              <SearchableSelect
                options={projectOptions}
                value={projectId || "__none__"}
                onValueChange={(v) => setProjectId(v === "__none__" ? "" : v)}
                placeholder="Opcional"
                searchPlaceholder="Buscar proyecto..."
              />
            </div>
          </div>

          {/* Dropbox links */}
          <div>
            <Label className="flex items-center gap-1"><Link className="h-4 w-4" /> Enlaces de Dropbox</Label>
            <div className="space-y-2 mb-2">
              {dropboxLinks.map((link, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <a href={link} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate flex-1">{link}</a>
                  <X className="h-4 w-4 cursor-pointer text-muted-foreground hover:text-destructive" onClick={() => setDropboxLinks(dropboxLinks.filter((_, j) => j !== i))} />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={newLink} onChange={(e) => setNewLink(e.target.value)} placeholder="https://www.dropbox.com/..." className="flex-1" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }} />
              <Button type="button" variant="outline" size="sm" onClick={addLink}><Plus className="h-4 w-4" /></Button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={createTask.isPending}>
              {createTask.isPending ? "Creando..." : "Crear tarea"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
