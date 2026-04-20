import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Loader2,
  Hash,
  Lock,
  MessageCircle,
  Users,
  Search,
  ChevronDown,
  Star,
  GripVertical,
  Sparkles,
  Bell,
  BellOff,
} from "lucide-react";
import type { SlackConversation } from "@/lib/slackApi";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";
import { groupSlackConversations, conversationTitle, type ConversationTitleOpts } from "./slackGrouping";
import { cn } from "@/lib/utils";
import {
  DndContext,
  closestCenter,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export type SlackCommPrefRow = {
  /** Legacy en BD; en UI siempre se maneja como false. */
  is_vip: boolean;
  is_starred: boolean;
  sort_order: number;
  /** Silenciar avisos Kawiil en esta conversación (siguen las @menciones). */
  notifications_muted: boolean;
};

type Props = {
  conversations: SlackConversation[];
  userMap: Record<string, SlackUserProfile | undefined>;
  selectedChannel: string;
  onSelect: (channelId: string) => void;
  isLoading: boolean;
  error: Error | null;
  titleOpts?: ConversationTitleOpts;
  /** Preferencias por canal (destacado/silencio). */
  commPrefsByChannel: Record<string, SlackCommPrefRow>;
  onToggleStar: (channelId: string) => void;
  onToggleNotificationsMuted: (channelId: string) => void;
  onReorderStarred: (orderedChannelIds: string[]) => void;
  /** Grupos personalizados (tras destacados). */
  customGroups?: Array<{ id: string; title: string; conversations: SlackConversation[] }>;
  channelsInCustomGroups?: Set<string>;
  onReorderCustomGroup?: (groupId: string, orderedChannelIds: string[]) => void;
  /**
   * Arrastrar-y-soltar cross-zone (v2.4): se invoca cuando el usuario suelta
   * cualquier conversación (canal público/privado/DM/destacado) encima del
   * cuerpo de un grupo personalizado. La mutación debe ser idempotente:
   * si el canal ya está en el grupo, no hace nada.
   */
  onAddChannelToGroup?: (groupId: string, channelId: string) => void;
  /** Quitar un canal de un grupo custom (opcional). */
  onRemoveChannelFromGroup?: (groupId: string, channelId: string) => void;
  headerActions?: ReactNode;
  /** Notificaciones Slack no leídas por channel_id (Kawiil). */
  unreadByChannel?: Record<string, number>;
};

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count > 99 ? "99+" : String(count);
  return (
    <span
      className="shrink-0 min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center tabular-nums leading-none"
      aria-label={`${count} sin leer`}
    >
      {label}
    </span>
  );
}

function SectionHeader({
  label,
  unreadInSection = 0,
  sectionId,
}: {
  label: string;
  unreadInSection?: number;
  /** Para comprobar en el DOM que el despliegue trae la lista sin bloque «VIP». */
  sectionId?: string;
}) {
  return (
    <CollapsibleTrigger
      id={sectionId}
      data-slack-section={sectionId}
      className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-200/75 hover:text-white [&[data-state=closed]_svg]:-rotate-90 min-w-0 transition-colors"
    >
      <ChevronDown className="h-3 w-3 shrink-0 transition-transform" />
      <span className="truncate min-w-0 flex-1 text-left">{label}</span>
      <UnreadBadge count={unreadInSection} />
    </CollapsibleTrigger>
  );
}

/**
 * Fila sortable (dentro de Destacados o de un grupo custom). Permite reordenar
 * con el handle y también funciona como fuente para drag cross-zone: el padre
 * detecta el drop sobre un droppable de otro grupo y hace la mutación
 * correspondiente.
 */
function SortableConvRow(
  props: Parameters<typeof ConvRow>[0] & {
    id: string;
    unreadCount?: number;
    /** Id del SortableContext al que pertenece (para decidir reorder vs. cross-zone). */
    listId: string;
    /** Channel id puro, útil para el payload cross-zone. */
    channelId: string;
  },
) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
    data: { type: "conv", listId: props.listId, channelId: props.channelId },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const u = props.unreadCount ?? 0;
  const rowHighlight = u > 0 && !props.selected;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={cn(
        "flex items-stretch gap-0 rounded-md",
        rowHighlight && "bg-accent/50 text-foreground ring-1 ring-border shadow-sm",
      )}
    >
      <button
        type="button"
        className={cn(
          "px-0.5 flex items-center cursor-grab active:cursor-grabbing touch-none",
          rowHighlight ? "text-muted-foreground/80 hover:text-foreground" : "text-muted-foreground/60 hover:text-foreground",
        )}
        {...listeners}
        aria-label="Arrastrar para mover o reordenar"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="flex-1 min-w-0">
        <ConvRow {...props} embedUnreadChrome={rowHighlight} />
      </div>
    </div>
  );
}

/**
 * Fila draggable (solo origen) para canales/DMs/privados fuera de Destacados
 * y de grupos custom. Al arrastrar al cuerpo de un grupo custom, se asigna.
 */
function DraggableConvRow(
  props: Parameters<typeof ConvRow>[0] & {
    id: string;
    unreadCount?: number;
    channelId: string;
  },
) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: props.id,
    data: { type: "conv", listId: "__flat__", channelId: props.channelId },
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="rounded-md cursor-grab active:cursor-grabbing touch-none"
      title="Arrastra a un grupo personalizado para organizarlo"
    >
      <ConvRow {...props} />
    </div>
  );
}

/**
 * Wrapper droppable alrededor del cuerpo de un grupo custom: acepta drops
 * desde cualquier parte del sidebar para asignar el canal al grupo.
 */
function CustomGroupDropZone({
  groupId,
  disabled,
  children,
}: {
  groupId: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `group-${groupId}`,
    data: { type: "customGroup", groupId },
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-md transition-colors",
        isOver && "bg-sky-50 ring-1 ring-sky-300 dark:bg-sky-500/10 dark:ring-sky-700/50",
      )}
    >
      {children}
    </div>
  );
}

function ConvRow({
  c,
  selected,
  onClick,
  title,
  isPublicChannel,
  starred,
  onToggleStar,
  notificationsMuted = false,
  onToggleNotificationsMuted,
  unreadCount = 0,
  embedUnreadChrome = false,
}: {
  c: SlackConversation;
  selected: boolean;
  onClick: () => void;
  title: string;
  isPublicChannel: boolean;
  starred?: boolean;
  onToggleStar?: () => void;
  notificationsMuted?: boolean;
  onToggleNotificationsMuted?: () => void;
  unreadCount?: number;
  /** Si true, el contenedor padre (p. ej. fila sortable) ya pinta el fondo de no leído. */
  embedUnreadChrome?: boolean;
}) {
  const hasUnread = unreadCount > 0;
  const highlightUnread = hasUnread && !selected && !embedUnreadChrome;
  const unreadInEmbed = hasUnread && !selected && embedUnreadChrome;

  return (
    <div
      className={cn(
        "relative w-full flex items-center gap-0 rounded-md transition-colors group/row",
        selected
          ? "bg-primary/12 text-foreground ring-1 ring-primary/25"
          : highlightUnread
            ? "bg-accent/50 text-foreground ring-1 ring-border shadow-sm"
            : "hover:bg-accent/40",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "relative flex-1 text-left pl-3 pr-1 py-1.5 rounded-md text-[13px] flex items-center gap-2 min-w-0",
          selected
            ? "font-semibold text-white"
            : highlightUnread || unreadInEmbed
              ? "font-semibold text-white"
              : hasUnread
                ? "font-bold text-white"
                : "text-slate-100/95 hover:text-white",
        )}
        title={
          hasUnread
            ? `${unreadCount} pendiente${unreadCount > 1 ? "s" : ""} · ${isPublicChannel && c.name ? `#${c.name} — ${title}` : title}`
            : isPublicChannel && c.name
              ? `#${c.name} — ${title}`
              : title
        }
      >
        {selected && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-primary" aria-hidden />
        )}
        {hasUnread && !selected && (
          <span
            className="h-2 w-2 rounded-full bg-sky-400 shrink-0 shadow-[0_0_6px_rgba(56,189,248,0.8)]"
            aria-hidden
          />
        )}
        {c.is_im ? (
          <MessageCircle className="h-3.5 w-3.5 shrink-0 opacity-70" />
        ) : c.is_mpim ? (
          <Users className="h-3.5 w-3.5 shrink-0 opacity-70" />
        ) : isPublicChannel ? (
          <Hash className="h-3.5 w-3.5 shrink-0 opacity-70" />
        ) : (
          <Lock className="h-3.5 w-3.5 shrink-0 opacity-70" />
        )}
        <span className="truncate min-w-0">{isPublicChannel && c.name ? `#${c.name}` : title}</span>
        <UnreadBadge count={unreadCount} />
      </button>
      {onToggleNotificationsMuted && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleNotificationsMuted();
          }}
          className={cn(
            "p-1.5 rounded-md shrink-0 text-muted-foreground/60 hover:text-primary hover:bg-primary/5 transition-colors",
            notificationsMuted && "text-muted-foreground/80",
          )}
          title={
            notificationsMuted
              ? "Avisos silenciados en Kawiil (sigue habiendo @menciones). Pulsa para activar."
              : "Silenciar avisos de este chat en Kawiil (las @menciones siguen llegando)."
          }
        >
          {notificationsMuted ? (
            <BellOff className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Bell className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      )}
      {onToggleStar && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar();
          }}
          className={cn(
            "p-1.5 rounded-md shrink-0 text-muted-foreground/60 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors",
            starred && "text-amber-500",
          )}
          title={starred ? "Quitar de destacados" : "Destacar"}
        >
          <Star className={cn("h-3.5 w-3.5", starred && "fill-amber-400")} />
        </button>
      )}
    </div>
  );
}

export function SlackConversationList({
  conversations,
  userMap,
  selectedChannel,
  onSelect,
  isLoading,
  error,
  titleOpts,
  commPrefsByChannel,
  onToggleStar,
  onToggleNotificationsMuted,
  onReorderStarred,
  customGroups = [],
  channelsInCustomGroups = new Set<string>(),
  onReorderCustomGroup,
  onAddChannelToGroup,
  onRemoveChannelFromGroup,
  headerActions,
  unreadByChannel = {},
}: Props) {
  const [q, setQ] = useState("");
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const unreadFor = (channelId: string) => unreadByChannel[channelId] || 0;
  const sumUnread = (convs: SlackConversation[]) =>
    convs.reduce((acc, c) => acc + unreadFor(c.id), 0);

  const filterMatch = (c: SlackConversation) => {
    if (!q.trim()) return true;
    const t = conversationTitle(c, userMap, titleOpts).toLowerCase();
    const n = (c.name || "").toLowerCase();
    const needle = q.trim().toLowerCase();
    return t.includes(needle) || n.includes(needle) || c.id.toLowerCase().includes(needle);
  };

  const pinnedInSidebar = (c: SlackConversation) => {
    const p = commPrefsByChannel[c.id];
    return p?.is_starred === true;
  };

  const starredOrdered = useMemo(() => {
    const rows = conversations
      .filter((c) => {
        const p = commPrefsByChannel[c.id];
        return p?.is_starred === true;
      })
      .map((c) => ({
        c,
        o: commPrefsByChannel[c.id]?.sort_order ?? 0,
      }))
      .sort((a, b) => a.o - b.o || a.c.id.localeCompare(b.c.id));
    return rows.map((r) => r.c);
  }, [conversations, commPrefsByChannel]);

  const groups = useMemo(() => groupSlackConversations(conversations), [conversations]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  /**
   * Handler unificado:
   *  1) Drop sobre el droppable de un grupo custom (`group-<gid>`) → asignar.
   *  2) Drop entre dos items del mismo `listId` → reordenar dentro de ese grupo.
   *  3) Cualquier otra combinación → no-op (se queda en su sitio).
   */
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;
    const overData = over.data.current as { type?: string; groupId?: string } | undefined;
    const activeData = active.data.current as
      | { type?: string; listId?: string; channelId?: string }
      | undefined;
    const channelId = activeData?.channelId || String(active.id);

    // Drop sobre un grupo custom: asignar.
    if (overData?.type === "customGroup" && overData.groupId && onAddChannelToGroup) {
      const gid = overData.groupId;
      // Si ya está en ese grupo, no hacer nada.
      const already = (customGroups.find((g) => g.id === gid)?.conversations || []).some(
        (c) => c.id === channelId,
      );
      if (!already) onAddChannelToGroup(gid, channelId);
      return;
    }

    // Drop entre items del mismo listId → reordenar.
    const overDataConv = over.data.current as { type?: string; listId?: string } | undefined;
    if (
      activeData?.type === "conv" &&
      overDataConv?.type === "conv" &&
      activeData.listId &&
      activeData.listId === overDataConv.listId &&
      active.id !== over.id
    ) {
      const listId = activeData.listId;
      if (listId === "__starred__") {
        const ids = starredOrdered.map((c) => c.id);
        const oldIndex = ids.indexOf(String(active.id));
        const newIndex = ids.indexOf(String(over.id));
        if (oldIndex >= 0 && newIndex >= 0) {
          onReorderStarred(arrayMove(ids, oldIndex, newIndex));
        }
        return;
      }
      if (listId.startsWith("__group__:") && onReorderCustomGroup) {
        const gid = listId.slice("__group__:".length);
        const group = customGroups.find((g) => g.id === gid);
        if (!group) return;
        const ids = group.conversations.map((c) => c.id);
        const oldIndex = ids.indexOf(String(active.id));
        const newIndex = ids.indexOf(String(over.id));
        if (oldIndex >= 0 && newIndex >= 0) {
          onReorderCustomGroup(gid, arrayMove(ids, oldIndex, newIndex));
        }
      }
    }
  };

  const renderConv = (
    c: SlackConversation,
    isPublicChannel: boolean,
    mode: "sortable" | "draggable" | "static",
    listId?: string,
  ) => {
    const p = commPrefsByChannel[c.id];
    const common = {
      c,
      selected: selectedChannel === c.id,
      onClick: () => onSelect(c.id),
      title: conversationTitle(c, userMap, titleOpts),
      isPublicChannel,
      starred: p?.is_starred === true,
      onToggleStar: () => onToggleStar(c.id),
      notificationsMuted: !!p?.notifications_muted,
      onToggleNotificationsMuted: () => onToggleNotificationsMuted(c.id),
      unreadCount: unreadFor(c.id),
    };
    if (mode === "sortable" && listId) {
      return (
        <SortableConvRow
          key={c.id}
          id={c.id}
          listId={listId}
          channelId={c.id}
          {...common}
        />
      );
    }
    if (mode === "draggable") {
      return <DraggableConvRow key={c.id} id={c.id} channelId={c.id} {...common} />;
    }
    return (
      <div key={c.id} className="rounded-md">
        <ConvRow {...common} />
      </div>
    );
  };

  const [openPub, setOpenPub] = useState(true);
  const [openPriv, setOpenPriv] = useState(true);
  const [openDm, setOpenDm] = useState(true);
  const [openStar, setOpenStar] = useState(true);

  const inSidebarSpecial = (c: SlackConversation) => pinnedInSidebar(c) || channelsInCustomGroups.has(c.id);

  const customGroupsFiltered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return customGroups
      .map((g) => ({
        ...g,
        conversations: !needle
          ? g.conversations
          : g.conversations.filter((c) => {
              const t = conversationTitle(c, userMap, titleOpts).toLowerCase();
              const n = (c.name || "").toLowerCase();
              return t.includes(needle) || n.includes(needle) || c.id.toLowerCase().includes(needle);
            }),
      }))
      .filter((g) => g.conversations.length > 0);
  }, [customGroups, q, userMap, titleOpts]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-sm text-destructive">{error.message}</div>;
  }

  const starFiltered = starredOrdered.filter(filterMatch);

  const publicFiltered = groups.publicChannels
    .filter((c) => !inSidebarSpecial(c))
    .filter(filterMatch);
  const privateFiltered = groups.privateChannels
    .filter((c) => !inSidebarSpecial(c))
    .filter(filterMatch);
  const dmFiltered = groups.allDirectMessages
    .filter((c) => !inSidebarSpecial(c))
    .filter(filterMatch);

  return (
    <div className="flex flex-col h-full min-h-0 text-foreground">
      <div className="p-2 border-b border-border/60 shrink-0 space-y-2">
        {headerActions}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
          <Input
            id="comunicacion-slack-buscar-conversaciones"
            name="comunicacion_slack_buscar_conversaciones"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar canal o persona…"
            className="h-8 pl-8 text-xs bg-background/60 border-border focus-visible:ring-primary/30"
          />
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDragId(null)}
        >
          <div className="p-2 pb-6 space-y-1">
            {starFiltered.length > 0 && (
              <Collapsible open={openStar} onOpenChange={setOpenStar}>
                <SectionHeader label="Destacados" unreadInSection={sumUnread(starFiltered)} sectionId="slack-destacados" />
                <CollapsibleContent>
                  <SortableContext items={starFiltered.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-0.5 mt-1">
                      {starFiltered.map((c) => {
                        const isPub = !c.is_private && !c.is_im && !c.is_mpim;
                        return renderConv(c, isPub, "sortable", "__starred__");
                      })}
                    </div>
                  </SortableContext>
                </CollapsibleContent>
              </Collapsible>
            )}

            {customGroupsFiltered.map((g) => (
              <Collapsible key={g.id} defaultOpen>
                <div className="flex items-stretch gap-0.5 px-1">
                  <CollapsibleTrigger className="flex flex-1 min-w-0 items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80 hover:text-foreground [&[data-state=closed]_svg]:-rotate-90 rounded-md transition-colors">
                    <ChevronDown className="h-3 w-3 shrink-0 transition-transform" />
                    <span className="truncate min-w-0 flex-1 text-left">{g.title}</span>
                    <UnreadBadge count={sumUnread(g.conversations)} />
                  </CollapsibleTrigger>
                  <Link
                    to={`/asistente-ia?slackGroup=${encodeURIComponent(g.id)}`}
                    className="inline-flex items-center gap-0.5 shrink-0 rounded-md px-2 py-1.5 text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/15 border border-primary/20 self-center transition-colors"
                    title="Analizar mensajes recientes de este grupo con Kawiil IA"
                  >
                    <Sparkles className="h-3 w-3" />
                    IA
                  </Link>
                </div>
                <CollapsibleContent>
                  <CustomGroupDropZone groupId={g.id} disabled={!onAddChannelToGroup}>
                    <SortableContext
                      items={g.conversations.map((c) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-0.5 mt-1 min-h-[28px]">
                        {g.conversations.length === 0 && onAddChannelToGroup ? (
                          <p className="mx-2 my-1 rounded-md border border-dashed border-sky-300/60 bg-sky-50/50 px-2 py-1.5 text-[11px] text-sky-700/80 dark:border-sky-700/50 dark:bg-sky-500/5 dark:text-sky-300/80">
                            Suelta aquí una conversación para añadirla a este grupo.
                          </p>
                        ) : null}
                        {g.conversations.map((c) => {
                          const isPub = !c.is_private && !c.is_im && !c.is_mpim;
                          return renderConv(
                            c,
                            isPub,
                            onReorderCustomGroup ? "sortable" : "static",
                            `__group__:${g.id}`,
                          );
                        })}
                      </div>
                    </SortableContext>
                  </CustomGroupDropZone>
                </CollapsibleContent>
              </Collapsible>
            ))}

            {publicFiltered.length > 0 && (
              <Collapsible open={openPub} onOpenChange={setOpenPub}>
                <SectionHeader label="Canales" unreadInSection={sumUnread(publicFiltered)} />
                <CollapsibleContent className="space-y-0.5 mt-1">
                  {publicFiltered.map((c) =>
                    renderConv(c, true, onAddChannelToGroup ? "draggable" : "static"),
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}

            {privateFiltered.length > 0 && (
              <Collapsible open={openPriv} onOpenChange={setOpenPriv}>
                <SectionHeader label="Canales privados" unreadInSection={sumUnread(privateFiltered)} />
                <CollapsibleContent className="space-y-0.5 mt-1">
                  {privateFiltered.map((c) =>
                    renderConv(c, false, onAddChannelToGroup ? "draggable" : "static"),
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}

            {dmFiltered.length > 0 && (
              <Collapsible open={openDm} onOpenChange={setOpenDm}>
                <SectionHeader label="Mensajes directos" unreadInSection={sumUnread(dmFiltered)} />
                <CollapsibleContent className="space-y-0.5 mt-1">
                  {dmFiltered.map((c) =>
                    renderConv(c, false, onAddChannelToGroup ? "draggable" : "static"),
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeDragId
              ? (() => {
                  const c = conversations.find((x) => x.id === activeDragId);
                  if (!c) return null;
                  const isPub = !c.is_private && !c.is_im && !c.is_mpim;
                  return (
                    <div className="pointer-events-none rounded-md border border-sky-300/80 bg-white/95 px-2 py-1 text-[12.5px] font-medium text-foreground shadow-md ring-1 ring-sky-200/60 dark:bg-background/95 dark:ring-sky-800/50">
                      {c.is_im ? (
                        <MessageCircle className="mr-1 inline h-3 w-3 opacity-70" />
                      ) : c.is_mpim ? (
                        <Users className="mr-1 inline h-3 w-3 opacity-70" />
                      ) : isPub ? (
                        <Hash className="mr-1 inline h-3 w-3 opacity-70" />
                      ) : (
                        <Lock className="mr-1 inline h-3 w-3 opacity-70" />
                      )}
                      {isPub && c.name ? `#${c.name}` : conversationTitle(c, userMap, titleOpts)}
                    </div>
                  );
                })()
              : null}
          </DragOverlay>
        </DndContext>
      </ScrollArea>
    </div>
  );
}
