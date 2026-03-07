import { useState } from "react";
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createTask.mutate(
      {
        title,
        description: description || undefined,
        area: area || undefined,
        priority,
        due_date: dueDate || undefined,
        assigned_to: assignedTo || undefined,
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
    setTitle("");
    setDescription("");
    setArea("");
    setPriority("media");
    setDueDate("");
    setAssignedTo("");
    setAdditionalAssignees([]);
    setClientId("");
    setProjectId("");
    setDropboxLinks([]);
    setNewLink("");
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
            <Label>Descripción</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalles adicionales..." rows={3} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Área</Label>
              <Select value={area} onValueChange={setArea}>
                <SelectTrigger><SelectValue placeholder="Seleccionar área" /></SelectTrigger>
                <SelectContent>
                  {areaOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Label>Responsable principal</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger><SelectValue placeholder="Asignar a..." /></SelectTrigger>
                <SelectContent>
                  {profiles?.map((p) => (
                    <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Select onValueChange={addAssignee} value="">
              <SelectTrigger><SelectValue placeholder="Agregar colaborador..." /></SelectTrigger>
              <SelectContent>
                {profiles
                  ?.filter((p) => p.user_id !== assignedTo && !additionalAssignees.includes(p.user_id))
                  .map((p) => (
                    <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Cliente <span className="text-xs text-muted-foreground">(dejar vacío para tarea interna)</span></Label>
              <Select value={clientId} onValueChange={(v) => { setClientId(v === "__none__" ? "" : v); }}>
                <SelectTrigger><SelectValue placeholder="Tarea interna" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin cliente (interna)</SelectItem>
                  {clients?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Proyecto</Label>
              <Select value={projectId} onValueChange={(v) => { setProjectId(v === "__none__" ? "" : v); }}>
                <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin proyecto</SelectItem>
                  {(clientId
                    ? projects?.filter((p: any) => p.client_id === clientId)
                    : projects
                  )?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
