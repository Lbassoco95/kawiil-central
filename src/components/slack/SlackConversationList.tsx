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
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
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
      className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 [&[data-state=closed]_svg]:-rotate-90 min-w-0"
    >
      <ChevronDown className="h-3 w-3 shrink-0 transition-transform" />
      <span className="truncate min-w-0 flex-1 text-left">{label}</span>
      <UnreadBadge count={unreadInSection} />
    </CollapsibleTrigger>
  );
}

function SortableConvRow(props: Parameters<typeof ConvRow>[0] & { id: string; unreadCount?: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
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
        rowHighlight && "bg-zinc-100 text-zinc-900 ring-1 ring-zinc-300/70 shadow-sm",
      )}
    >
      <button
        type="button"
        className={cn(
          "px-0.5 flex items-center cursor-grab active:cursor-grabbing touch-none",
          rowHighlight ? "text-zinc-500 hover:text-zinc-700" : "text-zinc-600 hover:text-zinc-400",
        )}
        {...listeners}
        aria-label="Arrastrar para reordenar"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="flex-1 min-w-0">
        <ConvRow {...props} embedUnreadChrome={rowHighlight} />
      </div>
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
        selected ? "bg-zinc-700 text-white" : highlightUnread ? "bg-zinc-100 text-zinc-900 ring-1 ring-zinc-300/70 shadow-sm" : "hover:bg-zinc-800/90",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "relative flex-1 text-left pl-3 pr-1 py-1.5 rounded-md text-[13px] flex items-center gap-2 min-w-0",
          selected
            ? "font-medium text-white"
            : highlightUnread || unreadInEmbed
              ? "font-semibold text-zinc-900"
              : hasUnread
                ? "font-bold text-white"
                : "text-zinc-200",
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
          <MessageCircle className={cn("h-3.5 w-3.5 shrink-0 opacity-70", (highlightUnread || unreadInEmbed) && "text-zinc-600")} />
        ) : c.is_mpim ? (
          <Users className={cn("h-3.5 w-3.5 shrink-0 opacity-70", (highlightUnread || unreadInEmbed) && "text-zinc-600")} />
        ) : isPublicChannel ? (
          <Hash className={cn("h-3.5 w-3.5 shrink-0 opacity-70", (highlightUnread || unreadInEmbed) && "text-zinc-600")} />
        ) : (
          <Lock className={cn("h-3.5 w-3.5 shrink-0 opacity-70", (highlightUnread || unreadInEmbed) && "text-zinc-600")} />
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
            "p-1.5 rounded-md shrink-0 text-zinc-500 hover:text-sky-300",
            notificationsMuted && "text-zinc-400",
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
            "p-1.5 rounded-md shrink-0 text-zinc-500 hover:text-amber-400",
            starred && "text-amber-400",
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
  headerActions,
  unreadByChannel = {},
}: Props) {
  const [q, setQ] = useState("");

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

  const onDragEndStarred = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = starredOrdered.map((c) => c.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorderStarred(arrayMove(ids, oldIndex, newIndex));
  };

  const onDragEndCustomGroup =
    (groupId: string, groupConvs: SlackConversation[]) => (event: DragEndEvent) => {
      if (!onReorderCustomGroup) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const ids = groupConvs.map((c) => c.id);
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      onReorderCustomGroup(groupId, arrayMove(ids, oldIndex, newIndex));
    };

  const renderConv = (c: SlackConversation, isPublicChannel: boolean, sortable: boolean) => {
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
    if (sortable) {
      return <SortableConvRow key={c.id} id={c.id} {...common} />;
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
        <Loader2 className="h-7 w-7 animate-spin text-sidebar-foreground/40" />
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
    <div className="flex flex-col h-full min-h-0 text-zinc-100">
      <div className="p-2 border-b border-zinc-700/80 shrink-0 space-y-2">
        {headerActions}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <Input
            id="comunicacion-slack-buscar-conversaciones"
            name="comunicacion_slack_buscar_conversaciones"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar…"
            className="h-8 pl-8 text-xs bg-zinc-800/80 border-zinc-700 placeholder:text-zinc-500 text-zinc-100"
          />
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 pb-6 space-y-1">
          {starFiltered.length > 0 && (
            <Collapsible open={openStar} onOpenChange={setOpenStar}>
              <SectionHeader label="Destacados" unreadInSection={sumUnread(starFiltered)} sectionId="slack-destacados" />
              <CollapsibleContent>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEndStarred}>
                  <SortableContext items={starFiltered.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-0.5 mt-1">
                      {starFiltered.map((c) => {
                        const isPub = !c.is_private && !c.is_im && !c.is_mpim;
                        return renderConv(c, isPub, true);
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              </CollapsibleContent>
            </Collapsible>
          )}

          {customGroupsFiltered.map((g) => (
            <Collapsible key={g.id} defaultOpen>
              <div className="flex items-stretch gap-0.5 px-1">
                <CollapsibleTrigger className="flex flex-1 min-w-0 items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 [&[data-state=closed]_svg]:-rotate-90 rounded-md">
                  <ChevronDown className="h-3 w-3 shrink-0 transition-transform" />
                  <span className="truncate min-w-0 flex-1 text-left">{g.title}</span>
                  <UnreadBadge count={sumUnread(g.conversations)} />
                </CollapsibleTrigger>
                <Link
                  to={`/asistente-ia?slackGroup=${encodeURIComponent(g.id)}`}
                  className="inline-flex items-center gap-0.5 shrink-0 rounded-md px-2 py-1.5 text-[10px] font-medium text-amber-300 bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-600 self-center"
                  title="Analizar mensajes recientes de este grupo con Kawiil IA"
                >
                  <Sparkles className="h-3 w-3" />
                  IA
                </Link>
              </div>
              <CollapsibleContent>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onDragEndCustomGroup(g.id, g.conversations)}
                >
                  <SortableContext items={g.conversations.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-0.5 mt-1">
                      {g.conversations.map((c) => {
                        const isPub = !c.is_private && !c.is_im && !c.is_mpim;
                        return renderConv(c, isPub, !!onReorderCustomGroup);
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              </CollapsibleContent>
            </Collapsible>
          ))}

          {publicFiltered.length > 0 && (
            <Collapsible open={openPub} onOpenChange={setOpenPub}>
              <SectionHeader label="Canales" unreadInSection={sumUnread(publicFiltered)} />
              <CollapsibleContent className="space-y-0.5 mt-1">
                {publicFiltered.map((c) => renderConv(c, true, false))}
              </CollapsibleContent>
            </Collapsible>
          )}

          {privateFiltered.length > 0 && (
            <Collapsible open={openPriv} onOpenChange={setOpenPriv}>
              <SectionHeader label="Canales privados" unreadInSection={sumUnread(privateFiltered)} />
              <CollapsibleContent className="space-y-0.5 mt-1">
                {privateFiltered.map((c) => renderConv(c, false, false))}
              </CollapsibleContent>
            </Collapsible>
          )}

          {dmFiltered.length > 0 && (
            <Collapsible open={openDm} onOpenChange={setOpenDm}>
              <SectionHeader label="Mensajes directos" unreadInSection={sumUnread(dmFiltered)} />
              <CollapsibleContent className="space-y-0.5 mt-1">
                {dmFiltered.map((c) => renderConv(c, false, false))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
