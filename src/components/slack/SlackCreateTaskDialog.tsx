import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, X, Plus, Link as LinkIcon, ChevronDown, ChevronUp } from "lucide-react";
import { useCreateTask, useProfiles } from "@/hooks/useTasks";
import { useClients } from "@/hooks/useClients";
import { useProjects } from "@/hooks/useProjects";
import { useAreaOptions } from "@/hooks/useAreaOptions";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import type { SlackMessage } from "@/lib/slackApi";
import { getDropboxLinkDisplayLabel } from "@/lib/dropboxLinkLabel";

const UNASSIGNED_VALUE = "__unassigned__";
const NONE_VALUE = "__none__";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: SlackMessage | null;
  channelId: string;
  channelTitle: string;
  authorLabel: string;
};

function compactSlackText(input: string | undefined): string {
  const raw = (input || "").trim();
  if (!raw) return "";
  return raw.replace(/\s+/g, " ").replace(/<@([A-Z0-9]+)>/g, "@$1");
}

function messageSeedTitle(message: SlackMessage | null): string {
  const base = compactSlackText(message?.text);
  if (!base) return "Tarea desde Slack";
  const clipped = base.length > 90 ? `${base.slice(0, 87)}...` : base;
  return `[Slack] ${clipped}`;
}

export function SlackCreateTaskDialog({
  open,
  onOpenChange,
  message,
  channelId,
  channelTitle,
  authorLabel,
}: Props) {
  const createTask = useCreateTask();
  const { data: profiles = [] } = useProfiles();
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const { areaOptions } = useAreaOptions();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("media");
  const [assignedTo, setAssignedTo] = useState(UNASSIGNED_VALUE);
  const [dueDate, setDueDate] = useState("");
  const [area, setArea] = useState("");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [additionalAssignees, setAdditionalAssignees] = useState<string[]>([]);
  const [dropboxLinks, setDropboxLinks] = useState<string[]>([]);
  const [newLink, setNewLink] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const messageLink = useMemo(() => {
    if (!message?.ts) return "";
    if (typeof window === "undefined") return `/comunicacion?channel=${channelId}&ts=${message.ts}`;
    const url = new URL("/comunicacion", window.location.origin);
    url.searchParams.set("channel", channelId);
    url.searchParams.set("ts", message.ts);
    return url.toString();
  }, [channelId, message?.ts]);

  useEffect(() => {
    if (!open || !message) return;
    setTitle(messageSeedTitle(message));
    const parts = [
      `Origen: Slack · ${channelTitle || channelId}`,
      `Autor: ${authorLabel || message.user || "desconocido"}`,
      message.ts ? `Timestamp: ${message.ts}` : "",
      messageLink ? `Mensaje: ${messageLink}` : "",
      "",
      compactSlackText(message.text),
    ].filter(Boolean);
    setDescription(parts.join("\n"));
    setPriority("media");
    setAssignedTo(UNASSIGNED_VALUE);
    setDueDate("");
    setArea("");
    setClientId("");
    setProjectId("");
    setAdditionalAssignees([]);
    setDropboxLinks([]);
    setNewLink("");
    setShowAdvanced(false);
  }, [open, message, channelTitle, channelId, authorLabel, messageLink]);

  const sortedAreaOptions = useMemo(
    () => [...areaOptions].sort((a, b) => a.label.localeCompare(b.label, "es")),
    [areaOptions],
  );

  const profileOptions = useMemo(
    () =>
      profiles
        .map((p) => ({ value: p.user_id, label: p.full_name }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    [profiles],
  );

  const clientOptions = useMemo(
    () => [
      { value: NONE_VALUE, label: "Sin cliente (interna)" },
      ...(clients ?? [])
        .map((c) => ({ value: c.id, label: c.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    ],
    [clients],
  );

  const projectOptions = useMemo(() => {
    const filtered = clientId
      ? projects?.filter((p: any) => p.client_id === clientId)
      : projects;
    return [
      { value: NONE_VALUE, label: "Sin proyecto" },
      ...(filtered ?? [])
        .map((p) => ({ value: p.id, label: p.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    ];
  }, [projects, clientId]);

  const availableAssignees = useMemo(
    () =>
      profileOptions.filter(
        (p) => p.value !== assignedTo && p.value !== UNASSIGNED_VALUE && !additionalAssignees.includes(p.value),
      ),
    [profileOptions, assignedTo, additionalAssignees],
  );

  const handleProjectChange = (value: string) => {
    const nextProjectId = value === NONE_VALUE ? "" : value;
    setProjectId(nextProjectId);
    if (nextProjectId && !clientId) {
      const proj = projects?.find((p: any) => p.id === nextProjectId);
      if (proj?.client_id) setClientId(proj.client_id);
    }
  };

  const handleClientChange = (value: string) => {
    const nextClientId = value === NONE_VALUE ? "" : value;
    setClientId(nextClientId);
    if (projectId) {
      const proj = projects?.find((p: any) => p.id === projectId);
      if (proj && nextClientId && proj.client_id !== nextClientId) {
        setProjectId("");
      }
    }
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
    const trimmed = newLink.trim();
    if (trimmed) {
      setDropboxLinks([...dropboxLinks, trimmed]);
      setNewLink("");
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
        area: area || undefined,
        client_id: clientId || undefined,
        project_id: projectId || undefined,
        additional_assignees: additionalAssignees,
        dropbox_links: dropboxLinks,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Crear tarea desde mensaje de Slack</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="slack-task-title">Título</Label>
            <Input
              id="slack-task-title"
              name="slack_task_title"
              autoComplete="off"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título de la tarea"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="slack-task-description">Descripción</Label>
            <Textarea
              id="slack-task-description"
              name="slack_task_description"
              autoComplete="off"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={7}
              placeholder="Contexto del mensaje de Slack"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Prioridad</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baja">Baja</SelectItem>
                  <SelectItem value="media">Media</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Asignar a</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED_VALUE}>Sin asignar</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="slack-task-due">Fecha límite (opcional)</Label>
            <Input
              id="slack-task-due"
              name="slack_task_due_date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Cliente (opcional)</Label>
              <SearchableSelect
                options={clientOptions}
                value={clientId || NONE_VALUE}
                onValueChange={handleClientChange}
                placeholder="Tarea interna"
                searchPlaceholder="Buscar cliente..."
              />
            </div>
            <div>
              <Label className="text-xs">Proyecto (opcional)</Label>
              <SearchableSelect
                options={projectOptions}
                value={projectId || NONE_VALUE}
                onValueChange={handleProjectChange}
                placeholder="Sin proyecto"
                searchPlaceholder="Buscar proyecto..."
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-1.5 transition-colors"
          >
            {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showAdvanced ? "Menos opciones" : "Más opciones (célula, colaboradores, enlaces Dropbox...)"}
          </button>

          {showAdvanced && (
            <div className="space-y-4 pt-1 border-t border-border/40 animate-fade-in">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Label className="text-xs mb-0">Célula</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                      >
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
                  placeholder="Seleccionar célula"
                  searchPlaceholder="Buscar célula..."
                />
              </div>

              <div>
                <Label className="text-xs">Colaboradores adicionales</Label>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {additionalAssignees.map((uid) => {
                    const p = profiles.find((pr) => pr.user_id === uid);
                    return (
                      <Badge key={uid} variant="secondary" className="text-xs gap-1">
                        {p?.full_name || uid}
                        <X
                          className="h-2.5 w-2.5 cursor-pointer"
                          onClick={() => removeAssignee(uid)}
                        />
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

              <div>
                <Label className="text-xs flex items-center gap-1">
                  <LinkIcon className="h-3 w-3" /> Enlaces de Dropbox
                </Label>
                <div className="space-y-1.5 mb-1.5">
                  {dropboxLinks.map((link, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline truncate flex-1"
                        title={link}
                      >
                        {getDropboxLinkDisplayLabel(link)}
                      </a>
                      <X
                        className="h-3 w-3 cursor-pointer text-muted-foreground hover:text-destructive"
                        onClick={() => setDropboxLinks(dropboxLinks.filter((_, j) => j !== i))}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newLink}
                    onChange={(e) => setNewLink(e.target.value)}
                    placeholder="https://www.dropbox.com/..."
                    className="flex-1 h-8 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addLink();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={addLink}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={createTask.isPending || !title.trim()}>
            {createTask.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Crear tarea
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
