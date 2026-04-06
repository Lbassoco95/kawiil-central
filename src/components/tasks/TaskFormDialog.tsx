import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { defaultDueDatePlusThreeBusinessDays } from "@/lib/quickTaskParse";
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
import { X, Plus, Link, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { AIDescriptionButton } from "@/components/tasks/AIDescriptionButton";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
  defaultClientId?: string;
  defaultArea?: string;
  defaultPhaseKey?: string;
}

export function TaskFormDialog({ open, onOpenChange, defaultProjectId, defaultClientId, defaultArea, defaultPhaseKey }: Props) {
  const { user } = useAuth();
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
  /** Al abrir el modal mostramos todas las opciones (descripción, cliente, proyecto…); la rápida queda en QuickTaskInput. */
  const [showAdvanced, setShowAdvanced] = useState(true);

  const createTask = useCreateTask();
  const { data: profiles } = useProfiles();
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const { areaOptions } = useAreaOptions();

  const sortedAreaOptions = useMemo(
    () => [...areaOptions].sort((a, b) => a.label.localeCompare(b.label, "es")),
    [areaOptions]
  );

  useEffect(() => {
    if (!open) return;
    setShowAdvanced(true);
    if (user?.id) setAssignedTo(user.id);
    setDueDate(defaultDueDatePlusThreeBusinessDays());
    if (defaultArea !== undefined) setArea(defaultArea || "");
    if (defaultClientId !== undefined) setClientId(defaultClientId || "");
    if (defaultProjectId !== undefined) setProjectId(defaultProjectId || "");
  }, [open, user?.id, defaultArea, defaultClientId, defaultProjectId]);

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
        phase_key: defaultPhaseKey || undefined,
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
    setShowAdvanced(true);
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
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva tarea — formulario completo</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Essential fields */}
          <div>
            <Label>Título *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="¿Qué hay que hacer?" autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Responsable</Label>
              <SearchableSelect
                options={profileOptions}
                value={assignedTo}
                onValueChange={setAssignedTo}
                placeholder="Asignar a..."
                searchPlaceholder="Buscar..."
              />
            </div>
            <div>
              <Label>Fecha límite</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Prioridad</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {priorityOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Label className="mb-0">Célula</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-[10px] text-muted-foreground underline-offset-2 hover:underline">
                      ¿Qué es?
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[240px] text-xs">
                    La célula es el equipo o área interna responsable (p. ej. Legal, Contabilidad). Ayuda a filtrar y repartir trabajo.
                  </TooltipContent>
                </Tooltip>
              </div>
              <SearchableSelect
                options={sortedAreaOptions}
                value={area}
                onValueChange={setArea}
                placeholder="Seleccionar"
                searchPlaceholder="Buscar célula..."
              />
            </div>
          </div>

          {/* Expandable advanced section */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-1.5 transition-colors"
          >
            {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showAdvanced ? "Menos opciones" : "Más opciones (descripción, cliente, proyecto, enlaces...)"}
          </button>

          {showAdvanced && (
            <div className="space-y-4 pt-1 border-t border-border/40 animate-fade-in">
              <div>
                <div className="flex items-center justify-between">
                  <Label>Descripción</Label>
                  <AIDescriptionButton title={title} onGenerated={setDescription} />
                </div>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalle adicional de la tarea..." rows={3} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Cliente</Label>
                  <SearchableSelect
                    options={clientOptions}
                    value={clientId || "__none__"}
                    onValueChange={(v) => setClientId(v === "__none__" ? "" : v)}
                    placeholder="Tarea interna"
                    searchPlaceholder="Buscar..."
                  />
                </div>
                <div>
                  <Label className="text-xs">Proyecto</Label>
                  <SearchableSelect
                    options={projectOptions}
                    value={projectId || "__none__"}
                    onValueChange={(v) => setProjectId(v === "__none__" ? "" : v)}
                    placeholder="Opcional"
                    searchPlaceholder="Buscar..."
                  />
                </div>
              </div>

              {/* Additional assignees */}
              <div>
                <Label className="text-xs">Colaboradores adicionales</Label>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {additionalAssignees.map((uid) => {
                    const p = profiles?.find((pr) => pr.user_id === uid);
                    return (
                      <Badge key={uid} variant="secondary" className="text-xs gap-1">
                        {p?.full_name || uid}
                        <X className="h-2.5 w-2.5 cursor-pointer" onClick={() => removeAssignee(uid)} />
                      </Badge>
                    );
                  })}
                </div>
                <SearchableSelect
                  options={availableAssignees}
                  value=""
                  onValueChange={addAssignee}
                  placeholder="Agregar colaborador..."
                  searchPlaceholder="Buscar..."
                />
              </div>

              {/* Dropbox links */}
              <div>
                <Label className="text-xs flex items-center gap-1"><Link className="h-3 w-3" /> Enlaces de Dropbox</Label>
                <div className="space-y-1.5 mb-1.5">
                  {dropboxLinks.map((link, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <a href={link} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate flex-1">{link}</a>
                      <X className="h-3 w-3 cursor-pointer text-muted-foreground hover:text-destructive" onClick={() => setDropboxLinks(dropboxLinks.filter((_, j) => j !== i))} />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input value={newLink} onChange={(e) => setNewLink(e.target.value)} placeholder="https://www.dropbox.com/..." className="flex-1 h-8 text-xs" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }} />
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={addLink}><Plus className="h-3 w-3" /></Button>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={createTask.isPending || !title.trim()}>
              {createTask.isPending ? "Creando..." : "Crear tarea"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
