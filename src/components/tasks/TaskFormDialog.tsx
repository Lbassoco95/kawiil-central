import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { defaultDueDatePlusThreeBusinessDays } from "@/lib/quickTaskParse";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCreateTask, useProfiles } from "@/hooks/useTasks";
import { useClients } from "@/hooks/useClients";
import { useProjects } from "@/hooks/useProjects";
import { useAreaOptions } from "@/hooks/useAreaOptions";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { findSimilarTasks, type SimilarTaskCandidate } from "@/lib/taskSimilarity";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Link, ChevronDown, ChevronUp, RefreshCw, AlertTriangle, Forward } from "lucide-react";
import { toast } from "sonner";
import { AIDescriptionButton } from "@/components/tasks/AIDescriptionButton";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getDropboxLinkDisplayLabel } from "@/lib/dropboxLinkLabel";
import {
  RECURRENCE_PATTERN_OPTIONS,
  RECURRENCE_TYPE_OPTIONS,
  calculateNextOccurrenceDate,
  formatRecurrenceDate,
} from "@/lib/recurrenceUtils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
  defaultClientId?: string;
  defaultArea?: string;
  defaultPhaseKey?: string;
  /** Valores iniciales opcionales (p. ej. al crear una tarea desde un correo). */
  defaultTitle?: string;
  defaultDescription?: string;
  defaultDueDate?: string;
  defaultPriority?: string;
  /** Origen: correo desde el que se crea la tarea (para vincularla y mostrarla como relacionada). */
  sourceEmailId?: string;
  sourceEmailSubject?: string;
  sourceEmailFrom?: string;
  /** Si se provee (contexto de correo), habilita el botón "Reenviar correo" al derivar. */
  onForwardEmail?: () => void;
  /** Callback tras crear la tarea con éxito (además de cerrar el diálogo). */
  onCreated?: () => void;
}

const ACTION_TYPE_OPTIONS = [
  { value: "propia", label: "La hacemos nosotros", hint: "Kawiil ejecuta la tarea (normal)." },
  { value: "seguimiento", label: "Seguimiento (un tercero la hace)", hint: "No la ejecutamos; solo monitoreamos y actualizamos." },
  { value: "derivar", label: "Derivar / reenviar a alguien", hint: "La acción es mandar el correo a otra persona." },
  { value: "registro", label: "Solo registrar en lista", hint: "Anotar en una lista interna, sin dueño de ejecución." },
];

export function TaskFormDialog({ open, onOpenChange, defaultProjectId, defaultClientId, defaultArea, defaultPhaseKey, defaultTitle, defaultDescription, defaultDueDate, defaultPriority, sourceEmailId, sourceEmailSubject, sourceEmailFrom, onForwardEmail, onCreated }: Props) {
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
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<string>("weekly");
  const [recurrenceType, setRecurrenceType] = useState<string>("on_complete");
  const [actionType, setActionType] = useState<string>("propia");
  const [followUpDate, setFollowUpDate] = useState<string>("");
  const [derivedTo, setDerivedTo] = useState<string>("");
  /** Al abrir el modal mostramos todas las opciones (descripción, cliente, proyecto…); la rápida queda en QuickTaskInput. */
  const [showAdvanced, setShowAdvanced] = useState(true);
  /** Tareas existentes similares detectadas al intentar crear (aviso de posible duplicado). */
  const [dupeMatches, setDupeMatches] = useState<Array<SimilarTaskCandidate & { score: number }>>([]);

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
    setActionType("propia");
    setFollowUpDate("");
    setDerivedTo("");
    if (user?.id) setAssignedTo(user.id);
    setDueDate(defaultDueDate || defaultDueDatePlusThreeBusinessDays());
    if (defaultArea !== undefined) setArea(defaultArea || "");
    if (defaultClientId !== undefined) setClientId(defaultClientId || "");
    if (defaultProjectId !== undefined) setProjectId(defaultProjectId || "");
    if (defaultTitle !== undefined) setTitle(defaultTitle || "");
    if (defaultDescription !== undefined) setDescription(defaultDescription || "");
    if (defaultPriority !== undefined) setPriority(defaultPriority || "media");
  }, [open, user?.id, defaultArea, defaultClientId, defaultProjectId, defaultTitle, defaultDescription, defaultDueDate, defaultPriority]);

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

  const nextRecurrencePreview = useMemo(() => {
    if (!isRecurring || !dueDate) return null;
    return calculateNextOccurrenceDate(dueDate, recurrencePattern);
  }, [isRecurring, dueDate, recurrencePattern]);

  // Candidatos para detección de duplicados: tareas abiertas del mismo proyecto
  // (o del mismo cliente si no hay proyecto). Base para el aviso de "posible duplicado".
  const { data: dupeCandidates = [] } = useQuery({
    queryKey: ["dupe-candidates", projectId || null, clientId || null],
    enabled: open && (!!projectId || !!clientId),
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from("tasks")
        .select("id, title, status, area, is_recurring")
        .in("status", ["pendiente", "en_progreso", "en_revision"]);
      if (projectId) q = q.eq("project_id", projectId);
      else if (clientId) q = q.eq("client_id", clientId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SimilarTaskCandidate[];
    },
  });

  const doCreate = () => {
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
        is_recurring: isRecurring || undefined,
        recurrence_pattern: isRecurring ? recurrencePattern : undefined,
        recurrence_type: isRecurring ? recurrenceType : undefined,
        next_recurrence_date:
          isRecurring && dueDate
            ? calculateNextOccurrenceDate(dueDate, recurrencePattern)
            : undefined,
        source_email_id: sourceEmailId || undefined,
        source_email_subject: sourceEmailSubject || undefined,
        source_email_from: sourceEmailFrom || undefined,
        action_type: actionType,
        follow_up_date: actionType === "seguimiento" && followUpDate ? followUpDate : undefined,
        derived_to: actionType === "derivar" && derivedTo.trim() ? derivedTo.trim() : undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          resetForm();
          onCreated?.();
        },
      }
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Aviso de posible duplicado antes de crear (no aplica a recurrentes ni Contabilidad).
    const matches = findSimilarTasks(title, dupeCandidates, {
      area: area || null,
      isRecurring,
      threshold: 0.7,
    });
    if (matches.length > 0) {
      setDupeMatches(matches);
      return;
    }
    doCreate();
  };

  const resetForm = () => {
    setTitle(""); setDescription(""); setArea(""); setPriority("media");
    setDueDate(""); setAssignedTo(""); setAdditionalAssignees([]);
    setClientId(""); setProjectId(""); setDropboxLinks([]); setNewLink("");
    setIsRecurring(false); setRecurrencePattern("weekly"); setRecurrenceType("on_complete");
    setActionType("propia"); setFollowUpDate(""); setDerivedTo("");
    setShowAdvanced(true); setDupeMatches([]);
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
            <Input
              value={title}
              onChange={(e) => { setTitle(e.target.value); if (dupeMatches.length) setDupeMatches([]); }}
              required
              placeholder="¿Qué hay que hacer?"
              autoFocus
            />
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

          {/* ── Recurrencia (siempre visible) ── */}
          <div className="rounded-lg border border-border/60 px-3 py-2.5 space-y-2.5 bg-muted/10">
            <div className="flex items-center justify-between">
              <Label className="text-sm flex items-center gap-1.5 cursor-pointer font-normal" htmlFor="recurrence-toggle">
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                Tarea recurrente
              </Label>
              <Switch
                id="recurrence-toggle"
                checked={isRecurring}
                onCheckedChange={setIsRecurring}
              />
            </div>

            {isRecurring && (
              <div className="space-y-2 pt-0.5">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-xs text-muted-foreground block mb-1">Frecuencia</span>
                    <Select value={recurrencePattern} onValueChange={setRecurrencePattern}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {RECURRENCE_PATTERN_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block mb-1">Siguiente ocurrencia</span>
                    <Select value={recurrenceType} onValueChange={setRecurrenceType}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {RECURRENCE_TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {RECURRENCE_TYPE_OPTIONS.find((o) => o.value === recurrenceType)?.description}
                  {nextRecurrencePreview && (
                    <> · Próxima: <span className="text-foreground font-medium">{formatRecurrenceDate(nextRecurrencePreview)}</span></>
                  )}
                </p>
              </div>
            )}
          </div>

          {/* ── Tipo de acción: qué hay que hacer con esto ── */}
          <div className="rounded-lg border border-border/60 px-3 py-2.5 space-y-2 bg-muted/10">
            <Label className="text-sm font-normal">¿Qué hay que hacer con esto?</Label>
            <Select value={actionType} onValueChange={setActionType}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTION_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {ACTION_TYPE_OPTIONS.find((o) => o.value === actionType)?.hint}
            </p>

            {actionType === "seguimiento" && (
              <div className="pt-1">
                <Label className="text-xs">Fecha de revisión / recordatorio</Label>
                <Input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className="h-9" />
                <p className="text-[10.5px] text-muted-foreground mt-1">Para revisar cómo va y actualizar el estatus.</p>
              </div>
            )}

            {actionType === "derivar" && (
              <div className="space-y-2 pt-1">
                <div>
                  <Label className="text-xs">Derivar a (persona o correo)</Label>
                  <Input value={derivedTo} onChange={(e) => setDerivedTo(e.target.value)} placeholder="nombre@ejemplo.com" className="h-9" />
                </div>
                {onForwardEmail && (
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={onForwardEmail}>
                    <Forward className="h-3.5 w-3.5" /> Reenviar correo
                  </Button>
                )}
              </div>
            )}
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
                      <a href={link} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate flex-1" title={link}>
                        {getDropboxLinkDisplayLabel(link)}
                      </a>
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

          {dupeMatches.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Ya existe{dupeMatches.length > 1 ? "n" : ""} {dupeMatches.length} tarea{dupeMatches.length > 1 ? "s" : ""} parecida{dupeMatches.length > 1 ? "s" : ""} en este {projectId ? "proyecto" : "cliente"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    ¿Es la misma tarea o una distinta? Si es otra, puedes crearla de todas formas.
                  </p>
                </div>
              </div>
              <ul className="space-y-1 pl-6">
                {dupeMatches.slice(0, 5).map((m) => (
                  <li key={m.id} className="text-xs text-foreground flex items-center gap-2">
                    <span className="truncate" title={m.title}>• {m.title}</span>
                    {m.status && <span className="text-[10px] text-muted-foreground shrink-0">({m.status})</span>}
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" size="sm" onClick={() => setDupeMatches([])}>
                  Revisar
                </Button>
                <Button type="button" size="sm" disabled={createTask.isPending} onClick={doCreate}>
                  {createTask.isPending ? "Creando..." : "Es otra, crear de todas formas"}
                </Button>
              </div>
            </div>
          )}

          {dupeMatches.length === 0 && (
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={createTask.isPending || !title.trim()}>
                {createTask.isPending ? "Creando..." : "Crear tarea"}
              </Button>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
