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

  const agentList = useAgentList(selectedClientId);

  useEffect(() => {
    if (!isOpen) return;
    setDispatchError(null);
    setIsDispatching(false);
    setSelectedClientId(defaultClientId ?? null);
    setSelectedAgentId(null);
    setTitle((defaultTitle ?? "").trim().slice(0, 200));
    setClientPopoverOpen(false);
    setAgentPopoverOpen(false);
  }, [isOpen, defaultClientId, defaultTitle]);

  useEffect(() => {
    setSelectedAgentId(null);
  }, [selectedClientId]);

  const groupedAgents = useMemo(
    () => groupAgents(agentList.agents),
    [agentList.agents],
  );

  const selectedAgent = useMemo(
    () => agentList.agents.find((a) => a.template_id === selectedAgentId),
    [agentList.agents, selectedAgentId],
  );

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
      const body: Record<string, unknown> = {
        agent_id: agent.template_id,
        title: title.trim(),
        attachment_refs: attachments ?? [],
      };

      if (selectedClientId) {
        body.client_id = selectedClientId;
      }

      if (conversationId) {
        body.input_context = { conversation_id: conversationId };
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
              onSelect={setSelectedClientId}
              open={clientPopoverOpen}
              onOpenChange={setClientPopoverOpen}
              disabled={clientsLoading}
            />
            <p className="text-[11px] text-muted-foreground">
              Deja vacío si es una tarea general del despacho.
            </p>
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
        className="w-[--radix-popover-trigger-width] p-0"
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
        className="w-[--radix-popover-trigger-width] p-0"
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
                      value={`${agent.display_name} ${agent.name} ${agent.role}`}
                      onSelect={() => {
                        onSelect(agent.template_id);
                        onOpenChange(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 mr-2 shrink-0",
                          selected === agent.template_id
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <span
                        className="h-5 w-5 rounded flex items-center justify-center text-white text-[9px] font-bold mr-2 shrink-0"
                        style={{ backgroundColor: agent.color }}
                      >
                        {agent.display_name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="flex-1 min-w-0 truncate">
                        {agent.display_name}
                      </span>
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
