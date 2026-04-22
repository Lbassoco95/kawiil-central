import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Loader2,
  Check,
  ChevronsUpDown,
  AlertCircle,
  Paperclip,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentList, type Agent } from "@/hooks/useAgentList";
import { useClients } from "@/hooks/useClients";
import type { Client } from "@/hooks/useClients";
import type { ChatAttachmentMeta } from "@/hooks/useChat";
import {
  mergeAgentAttachmentRefs,
} from "@/lib/buildAgentProjectKnowledgeDispatch";
import { supabase } from "@/integrations/supabase/client";

/**
 * Adjuntos del composer; compatible con `ChatAttachmentMeta` y campos opcionales extra.
 */
export type AttachmentRef = ChatAttachmentMeta & {
  size_bytes?: number;
  document_id?: string | null;
};

export interface DelegateToAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;

  /** Primera línea del composer del chat (sugerencia de título). */
  defaultTitle?: string;
  /** Adjuntos pendientes en el composer. */
  attachments?: AttachmentRef[];
  /** ID de la conversación activa en el chat. */
  conversationId?: string;

  /**
   * Contexto de cliente (p. ej. desde `ai_projects.client_id`).
   * `null` = tarea general del despacho.
   */
  defaultClientId?: string | null;

  /** `template_id` del agente (mismo valor que en `agent_task_ref.agent_id`). */
  defaultAgentTemplateId?: string | null;

  /** Proyecto IA activo; se envía en `input_context.ai_project_id` para la VM kawiil-agents. */
  aiProjectId?: string | null;

  /**
   * Tarea de agente previa en este hilo. La edge reenvía `input_context.previous_task_id`
   * a la VM para segunda búsqueda o seguimiento enlazado.
   */
  previousTaskId?: string | null;

  /** Tipo de seguimiento (metadata para la VM). */
  followUpKind?: "retry" | "continuation" | null;

  /**
   * Instrucciones del proyecto IA; se rellenan al abrir el modal y se envían
   * en el body como `instructions` a la VM (kawiil-agents), además de lo que ya vaya en el chat.
   */
  projectInstructions?: string | null;

  /**
   * Documentos del panel Conocimiento (proyecto): rutas de Storage y/o metadatos Dropbox
   * para que la VM no dependa solo de adjuntos del chat.
   */
  projectKnowledgeForAgent?: {
    supabaseRefs: ChatAttachmentMeta[];
    dropboxDocuments: { document_id: string; name: string; external_path: string }[];
  } | null;

  /**
   * Solo con seguimiento (`previousTaskId`): limpia el vínculo a la tarea anterior y
   * deja el mismo modal en modo "tarea nueva" (sin enlace a la tarea previa).
   */
  onStartFreshTask?: () => void;

  /** Tras un dispatch exitoso desde la VM (vía edge `dispatch-to-agent`). */
  onDelegated: (ref: {
    task_id: string;
    agent_id: string;
    agent_name: string;
    agent_display_name: string;
    agent_color: string;
    title: string;
  }) => void;
}

const AGENT_GROUPS = {
  LEGAL: ["amatl", "nelli", "tepantli", "tlahtoani", "tequitl"],
  CONTABLE_FISCAL: ["balam", "teocuitl", "metztli"],
  GESTORIA: ["yollotl", "atl"],
  DOCUMENTOS_COMUNICACION: ["tlahtolli", "coyolli"],
  INVESTIGACION_ANALISIS: ["tochtli", "ollin"],
} as const;

type AgentGroupKey = keyof typeof AGENT_GROUPS | "OTROS";

const GROUP_LABELS: Record<AgentGroupKey, string> = {
  LEGAL: "Legal",
  CONTABLE_FISCAL: "Contable y Fiscal",
  GESTORIA: "Gestoría",
  DOCUMENTOS_COMUNICACION: "Documentos y Comunicación",
  INVESTIGACION_ANALISIS: "Investigación y Análisis",
  OTROS: "Otros",
};

const MAX_DELEGATE_INSTRUCTIONS = 12_000;

const GROUP_ORDER: AgentGroupKey[] = [
  "LEGAL",
  "CONTABLE_FISCAL",
  "GESTORIA",
  "DOCUMENTOS_COMUNICACION",
  "INVESTIGACION_ANALISIS",
  "OTROS",
];

function groupAgents(agents: Agent[]): Record<AgentGroupKey, Agent[]> {
  const groups: Record<AgentGroupKey, Agent[]> = {
    LEGAL: [],
    CONTABLE_FISCAL: [],
    GESTORIA: [],
    DOCUMENTOS_COMUNICACION: [],
    INVESTIGACION_ANALISIS: [],
    OTROS: [],
  };

  for (const agent of agents) {
    let placed = false;
    for (const [groupKey, names] of Object.entries(AGENT_GROUPS)) {
      if ((names as readonly string[]).includes(agent.name)) {
        groups[groupKey as keyof typeof AGENT_GROUPS].push(agent);
        placed = true;
        break;
      }
    }
    if (!placed) groups.OTROS.push(agent);
  }

  for (const key of GROUP_ORDER) {
    groups[key].sort((a, b) =>
      a.display_name.localeCompare(b.display_name, "es"),
    );
  }

  return groups;
}

export function DelegateToAgentDialog({
  isOpen,
  onClose,
  defaultTitle = "",
  attachments,
  conversationId,
  defaultClientId = null,
  defaultAgentTemplateId = null,
  aiProjectId = null,
  previousTaskId = null,
  followUpKind = null,
  projectInstructions = null,
  projectKnowledgeForAgent = null,
  onStartFreshTask,
  onDelegated,
}: DelegateToAgentDialogProps) {
  const { data: clients = [], isLoading: clientsLoading } = useClients();
  const clientList = (clients ?? []) as Client[];

  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    defaultClientId ?? null,
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [title, setTitle] = useState<string>("");
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);
  const [agentPopoverOpen, setAgentPopoverOpen] = useState(false);
  const [agentInstructions, setAgentInstructions] = useState("");

  const agentList = useAgentList(selectedClientId);

  useEffect(() => {
    if (!isOpen) return;
    setDispatchError(null);
    setIsDispatching(false);
    setSelectedClientId(defaultClientId ?? null);
    setSelectedAgentId(defaultAgentTemplateId ?? null);
    setTitle((defaultTitle ?? "").trim().slice(0, 200));
    setClientPopoverOpen(false);
    setAgentPopoverOpen(false);
    setAgentInstructions((projectInstructions ?? "").trim());
  }, [isOpen, defaultClientId, defaultTitle, defaultAgentTemplateId, projectInstructions, previousTaskId]);

  const handleClientSelect = (id: string | null) => {
    setSelectedClientId((prev) => {
      if (prev !== id) setSelectedAgentId(null);
      return id;
    });
  };

  const groupedAgents = useMemo(
    () => groupAgents(agentList.agents),
    [agentList.agents],
  );

  const selectedAgent = useMemo(
    () => agentList.agents.find((a) => a.template_id === selectedAgentId),
    [agentList.agents, selectedAgentId],
  );

  const knowledgeSupabaseRefs = projectKnowledgeForAgent?.supabaseRefs ?? [];
  const knowledgeDropbox = projectKnowledgeForAgent?.dropboxDocuments ?? [];
  const knowledgeTotalCount = knowledgeSupabaseRefs.length + knowledgeDropbox.length;

  const isFollowUp = Boolean(previousTaskId);
  const instrTrim = agentInstructions.replace(/\r\n/g, "\n").trim();
  const hasDispatchBody = title.trim().length > 0 || instrTrim.length > 0;

  const canSubmit =
    selectedAgentId !== null &&
    hasDispatchBody &&
    !agentList.isLoading &&
    !agentList.error &&
    !clientsLoading;

  const handleDelegate = async () => {
    if (!selectedAgentId) return;

    const agent = agentList.agents.find((a) => a.template_id === selectedAgentId);
    if (!agent) {
      setDispatchError("Agente no encontrado. Recarga la lista.");
      return;
    }

    const tTrim = title.trim();
    const effectiveTitle = tTrim
      ? tTrim.slice(0, 200)
      : instrTrim
        ? instrTrim.slice(0, 200)
        : "";
    if (!effectiveTitle) {
      setDispatchError("Escribe un asunto o instrucciones.");
      return;
    }

    setIsDispatching(true);
    setDispatchError(null);

    try {
      const kConn = projectKnowledgeForAgent;
      const kSupa = kConn?.supabaseRefs ?? [];
      const fromChat = (attachments ?? []) as ChatAttachmentMeta[];
      const mergedAttachmentRefs = mergeAgentAttachmentRefs(kSupa, fromChat);

      const body: Record<string, unknown> = {
        agent_id: agent.template_id,
        title: effectiveTitle,
        attachment_refs: mergedAttachmentRefs,
      };

      if (selectedClientId) {
        body.client_id = selectedClientId;
      }

      const ctx: Record<string, unknown> = {};
      if (conversationId) ctx.conversation_id = conversationId;
      if (aiProjectId) ctx.ai_project_id = aiProjectId;
      /** Indicación para la VM: puede adjuntar extracto del hilo / memorias del proyecto (contrato kawiil-agents). */
      ctx.include_conversation_excerpt = true;
      if (kSupa.length) {
        ctx.knowledge_supabase_ref_count = kSupa.length;
      }
      if (kConn?.dropboxDocuments && kConn.dropboxDocuments.length > 0) {
        ctx.knowledge_dropbox_documents = kConn.dropboxDocuments;
      }
      if (previousTaskId) {
        ctx.previous_task_id = previousTaskId;
        if (followUpKind) ctx.follow_up_kind = followUpKind;
      }
      if (Object.keys(ctx).length > 0) {
        body.input_context = ctx;
      }

      const inst = agentInstructions.replace(/\r\n/g, "\n").trim();
      if (inst.length > 0) {
        body.instructions = inst.slice(0, MAX_DELEGATE_INSTRUCTIONS);
      }

      const { data, error } = await supabase.functions.invoke(
        "dispatch-to-agent",
        { body },
      );

      if (error) throw error;

      const payload = data as Record<string, unknown> | null;
      if (payload && typeof payload.error === "string") {
        throw new Error(payload.error);
      }

      const taskId = payload?.task_id;
      if (typeof taskId !== "string" || !taskId) {
        throw new Error("Respuesta inválida del servidor");
      }

      onDelegated({
        task_id: taskId,
        agent_id: agent.template_id,
        agent_name: agent.name,
        agent_display_name: agent.display_name,
        agent_color: agent.color,
        title: effectiveTitle,
      });

      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error desconocido al delegar";
      setDispatchError(message);
      console.error("[delegate-dialog] dispatch failed", err);
    } finally {
      setIsDispatching(false);
    }
  };

  const primaryCtaLabel = isFollowUp
    ? followUpKind === "retry"
      ? "Reenviar ajuste"
      : "Enviar seguimiento"
    : "Delegar tarea";
  const primaryLoadingLabel = isFollowUp ? "Enviando…" : "Delegando…";
  const dialogTitle = isFollowUp ? "Seguimiento con el agente" : "Delegar tarea a un agente";

  const sharedKnowledgeBlock =
    knowledgeTotalCount > 0 ? (
      <div className="space-y-1.5">
        <Label>Conocimiento del proyecto (incluido en el envío)</Label>
        <div className="rounded-md border border-sky-200/60 dark:border-sky-800/40 bg-sky-50/40 dark:bg-sky-950/20 px-2.5 py-2 text-[10.5px] text-muted-foreground space-y-1.5">
          <p>
            <span className="font-medium text-foreground/90">{knowledgeSupabaseRefs.length}</span> en Storage
            {knowledgeDropbox.length > 0 && (
              <>
                {" "}
                y <span className="font-medium text-foreground/90">{knowledgeDropbox.length}</span> en Dropbox
              </>
            )}
            . Documentos del proyecto y adjuntos del chat (sin duplicar ruta en Storage).
          </p>
          <ul className="max-h-20 overflow-y-auto space-y-0.5 list-none p-0 m-0 text-[10px]">
            {knowledgeSupabaseRefs.map((r, i) => (
              <li key={`ks-${i}-${r.path}`} className="truncate">
                {r.name}
              </li>
            ))}
            {knowledgeDropbox.map((d) => (
              <li key={d.document_id} className="truncate">
                {d.name} <span className="text-muted-foreground/80">(Dropbox)</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    ) : null;

  const followUpInfoShort = isFollowUp && (
    <div
      role="status"
      className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2 text-[11px] text-muted-foreground leading-snug"
    >
      {followUpKind === "retry" ? (
        <p>Reintento: mismo agente e historial; indica abajo el ajuste o la nueva búsqueda.</p>
      ) : (
        <p>
          Seguimiento al mismo agente: escribe qué necesitas ahora. Se incluyen documentos de conocimiento, adjuntos del
          chat y enlace a la tarea anterior.
        </p>
      )}
    </div>
  );

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isFollowUp ? (
            <>
              {followUpInfoShort}
              <div className="space-y-1.5">
                <Label htmlFor="agent-instructions" className="text-foreground">
                  Mensaje al agente
                </Label>
                <Textarea
                  id="agent-instructions"
                  value={agentInstructions}
                  onChange={(e) => setAgentInstructions(e.target.value.slice(0, MAX_DELEGATE_INSTRUCTIONS))}
                  placeholder="Instrucciones o preguntas para continuar con el mismo encargo. Puedes dejar en blanco el asunto si responde aquí."
                  className="min-h-[128px] max-h-56 text-sm resize-y"
                  rows={5}
                />
                <p className="text-[10.5px] text-muted-foreground">Opcional: complementa o resume con el asunto de abajo.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-title">Asunto breve (opcional)</Label>
                <Input
                  id="task-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, 200))}
                  placeholder="p. ej. Revisar anexo 2 del expediente"
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Cliente</Label>
                <ClientCombobox
                  clients={clientList}
                  selected={selectedClientId}
                  onSelect={handleClientSelect}
                  open={clientPopoverOpen}
                  onOpenChange={setClientPopoverOpen}
                  disabled={clientsLoading}
                />
                <p className="text-[11px] text-muted-foreground">Deja vacío si aplica tarea general del despacho.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Agente (este seguimiento)</Label>
                {selectedAgent ? (
                  <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                    <p className="text-sm font-medium">{selectedAgent.display_name}</p>
                    <p className="text-[11px] text-muted-foreground line-clamp-3 mt-0.5">
                      {selectedAgent.description ?? selectedAgent.role}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-destructive">Cargando agente…</p>
                )}
                {agentList.error && (
                  <p className="text-[11px] text-destructive">{agentList.error.message}</p>
                )}
              </div>
              {onStartFreshTask && (
                <div className="pt-0.5">
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-xs text-muted-foreground"
                    onClick={() => onStartFreshTask()}
                  >
                    Iniciar una tarea nueva (sin vincular a la anterior)
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Cliente</Label>
                <ClientCombobox
                  clients={clientList}
                  selected={selectedClientId}
                  onSelect={handleClientSelect}
                  open={clientPopoverOpen}
                  onOpenChange={setClientPopoverOpen}
                  disabled={clientsLoading}
                />
                <p className="text-[11px] text-muted-foreground">Deja vacío si es una tarea general del despacho.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Agente</Label>
                <AgentCombobox
                  grouped={groupedAgents}
                  isLoading={agentList.isLoading}
                  selected={selectedAgentId}
                  onSelect={setSelectedAgentId}
                  open={agentPopoverOpen}
                  onOpenChange={setAgentPopoverOpen}
                />
                {agentList.error && (
                  <p className="text-[11px] text-destructive">{agentList.error.message}</p>
                )}
                {selectedAgent && (
                  <p className="text-[11px] text-muted-foreground line-clamp-3">
                    {selectedAgent.description ?? selectedAgent.role}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-title">Título de la tarea</Label>
                <Input
                  id="task-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, 200))}
                  placeholder="Ej. Revisar contrato de arrendamiento"
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-instructions">Instrucciones (opcional)</Label>
                <Textarea
                  id="agent-instructions"
                  value={agentInstructions}
                  onChange={(e) => setAgentInstructions(e.target.value.slice(0, MAX_DELEGATE_INSTRUCTIONS))}
                  placeholder="Detalle, criterios o referencia a documentos. Pueden ampliar las instrucciones del proyecto de IA."
                  className="min-h-[100px] max-h-48 text-sm resize-y"
                  rows={4}
                />
                <p className="text-[10.5px] text-muted-foreground">
                  Si solo escribes instrucciones, se usarán como título abreviado.
                </p>
              </div>
            </>
          )}

          {sharedKnowledgeBlock}

          {attachments && attachments.length > 0 && (
            <div className="space-y-1.5">
              <Label>Archivos adjuntos ({attachments.length})</Label>
              <div className="rounded-md border border-border/50 bg-muted/30 p-2 max-h-24 overflow-auto space-y-1">
                {attachments.map((a, i) => (
                  <p
                    key={`${a.path}-${i}`}
                    className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5"
                  >
                    <Paperclip className="h-3 w-3 shrink-0 opacity-70" />
                    <span className="truncate">{a.name}</span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {dispatchError && (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{dispatchError}</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isDispatching}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void handleDelegate()}
            disabled={!canSubmit || isDispatching}
          >
            {isDispatching ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                {primaryLoadingLabel}
              </>
            ) : (
              primaryCtaLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientCombobox({
  clients,
  selected,
  onSelect,
  open,
  onOpenChange,
  disabled,
}: {
  clients: Client[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}) {
  const selectedClient = clients.find((c) => c.id === selected);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={disabled}
        >
          <span className="truncate">
            {selectedClient ? selectedClient.name : "Sin cliente específico"}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[130] w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Buscar cliente…" />
          <CommandList>
            <CommandEmpty>No se encontraron clientes.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__no_client__ sin cliente"
                onSelect={() => {
                  onSelect(null);
                  onOpenChange(false);
                }}
              >
                <Check
                  className={cn(
                    "h-4 w-4 mr-2 shrink-0",
                    selected === null ? "opacity-100" : "opacity-0",
                  )}
                />
                Sin cliente específico
              </CommandItem>
              {clients.map((client) => (
                <CommandItem
                  key={client.id}
                  value={`${client.name} ${client.id}`}
                  onSelect={() => {
                    onSelect(client.id);
                    onOpenChange(false);
                  }}
                >
                  <Check
                    className={cn(
                      "h-4 w-4 mr-2 shrink-0",
                      selected === client.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {client.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AgentCombobox({
  grouped,
  isLoading,
  selected,
  onSelect,
  open,
  onOpenChange,
}: {
  grouped: Record<AgentGroupKey, Agent[]>;
  isLoading: boolean;
  selected: string | null;
  onSelect: (templateId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const total = GROUP_ORDER.reduce((n, k) => n + grouped[k].length, 0);

  const selectedAgentRow = useMemo(
    () =>
      selected
        ? GROUP_ORDER.flatMap((k) => grouped[k]).find(
            (a) => a.template_id === selected,
          )
        : undefined,
    [grouped, selected],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={isLoading}
        >
          <span className="truncate">
            {isLoading
              ? "Cargando agentes…"
              : selectedAgentRow?.display_name ?? "Seleccionar agente"}
          </span>
          {isLoading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-70" />
          ) : (
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[130] w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Buscar agente…" />
          <CommandList>
            <CommandEmpty>
              {total === 0
                ? "No hay agentes disponibles."
                : "No se encontraron agentes."}
            </CommandEmpty>
            {GROUP_ORDER.map((groupKey) => {
              const groupAgents = grouped[groupKey];
              if (groupAgents.length === 0) return null;
              return (
                <CommandGroup
                  key={groupKey}
                  heading={GROUP_LABELS[groupKey]}
                >
                  {groupAgents.map((agent) => (
                    <CommandItem
                      key={`${groupKey}-${agent.template_id}`}
                      value={`${agent.display_name} ${agent.name} ${agent.description ?? ""}`}
                      onSelect={() => {
                        onSelect(agent.template_id);
                        onOpenChange(false);
                      }}
                      className="items-start py-2"
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 mr-2 mt-1 shrink-0",
                          selected === agent.template_id
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <span
                        className="h-6 w-6 rounded flex items-center justify-center text-white text-[10px] font-bold mr-2 shrink-0 mt-0.5"
                        style={{ backgroundColor: agent.color }}
                      >
                        {agent.display_name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span className="text-sm font-medium truncate">
                          {agent.display_name}
                        </span>
                        {agent.description && (
                          <span className="text-[11px] text-muted-foreground line-clamp-2 leading-tight">
                            {agent.description}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
