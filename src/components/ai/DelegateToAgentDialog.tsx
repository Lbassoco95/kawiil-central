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
  }, [isOpen, defaultClientId, defaultTitle, defaultAgentTemplateId, projectInstructions]);

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

  const canSubmit =
    selectedAgentId !== null &&
    title.trim().length > 0 &&
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

    setIsDispatching(true);
    setDispatchError(null);

    try {
      const kConn = projectKnowledgeForAgent;
      const kSupa = kConn?.supabaseRefs ?? [];
      const fromChat = (attachments ?? []) as ChatAttachmentMeta[];
      const mergedAttachmentRefs = mergeAgentAttachmentRefs(kSupa, fromChat);

      const body: Record<string, unknown> = {
        agent_id: agent.template_id,
        title: title.trim(),
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
        title: title.trim(),
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

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Delegar tarea a un agente</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
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
            <p className="text-[11px] text-muted-foreground">
              Deja vacío si es una tarea general del despacho.
            </p>
          </div>

          {previousTaskId && (
            <div
              role="status"
              className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2 text-[11px] text-muted-foreground leading-snug"
            >
              Segunda búsqueda o seguimiento: se envía el id de la tarea anterior (
              <span className="font-mono text-[10px] opacity-90">{previousTaskId.slice(0, 8)}…</span>
              ) a la VM junto con el hilo. Puedes <span className="text-foreground/85">cambiar el título y las
              instrucciones</span> abajo para acotar el enfoque; también se reenvían los documentos del conocimiento
              (proyecto) y los adjuntos del chat, si aplica.
              {followUpKind === "retry" && (
                <span className="block mt-1 text-foreground/80">Modo: reintento de búsqueda.</span>
              )}
              {followUpKind === "continuation" && (
                <span className="block mt-1 text-foreground/80">Modo: nueva solicitud enlazada.</span>
              )}
            </div>
          )}

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
              <p className="text-[11px] text-destructive">
                {agentList.error.message}
              </p>
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
            <Label htmlFor="agent-instructions">Instrucciones para el agente (opcional)</Label>
            <Textarea
              id="agent-instructions"
              value={agentInstructions}
              onChange={(e) => setAgentInstructions(e.target.value.slice(0, MAX_DELEGATE_INSTRUCTIONS))}
              placeholder="Se envían a la VM con la tarea. Pueden repetir o ampliar las instrucciones del proyecto de IA."
              className="min-h-[100px] max-h-48 text-sm resize-y"
              rows={4}
            />
            <p className="text-[10.5px] text-muted-foreground leading-snug">
              El asistente Kawiil en este hilo ya usa el proyecto, memorias e índice semántico. El agente en servidor
              recibe este texto, referencias a archivos y <span className="text-foreground/80">input_context</span> (hilo,
              proyecto, Dropbox si aplica); el uso final depende de kawiil-agents.
            </p>
          </div>

          {knowledgeTotalCount > 0 && (
            <div className="space-y-1.5">
              <Label>Conocimiento del proyecto (incluido en la tarea)</Label>
              <div className="rounded-md border border-sky-200/60 dark:border-sky-800/40 bg-sky-50/40 dark:bg-sky-950/20 px-2.5 py-2 text-[10.5px] text-muted-foreground space-y-1.5">
                <p>
                  <span className="font-medium text-foreground/90">
                    {knowledgeSupabaseRefs.length}
                  </span>{" "}
                  en Storage
                  {knowledgeDropbox.length > 0 && (
                    <>
                      {" "}
                      y{" "}
                      <span className="font-medium text-foreground/90">
                        {knowledgeDropbox.length}
                      </span>{" "}
                      en Dropbox
                    </>
                  )}{" "}
                  (además de los adjuntos del chat, sin duplicar ruta en Storage).
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
          )}

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
                Delegando…
              </>
            ) : (
              "Delegar tarea"
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
