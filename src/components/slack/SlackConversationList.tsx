import { useMemo, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, Hash, Lock, MessageCircle, Users, Search, ChevronDown, Star, GripVertical, Crown } from "lucide-react";
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
  is_vip: boolean;
  is_starred: boolean;
  sort_order: number;
};

type Props = {
  conversations: SlackConversation[];
  userMap: Record<string, SlackUserProfile | undefined>;
  selectedChannel: string;
  onSelect: (channelId: string) => void;
  isLoading: boolean;
  error: Error | null;
  titleOpts?: ConversationTitleOpts;
  /** Preferencias por canal (VIP, destacado, orden). */
  commPrefsByChannel: Record<string, SlackCommPrefRow>;
  onToggleVip: (channelId: string) => void;
  onToggleStar: (channelId: string) => void;
  onReorderVip: (orderedChannelIds: string[]) => void;
  onReorderStarred: (orderedChannelIds: string[]) => void;
  headerActions?: ReactNode;
};

function SectionHeader({ label }: { label: string }) {
  return (
    <CollapsibleTrigger className="flex w-full items-center gap-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 [&[data-state=closed]_svg]:-rotate-90">
      <ChevronDown className="h-3 w-3 transition-transform" />
      {label}
    </CollapsibleTrigger>
  );
}

function SortableConvRow(props: Parameters<typeof ConvRow>[0] & { id: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} className="flex items-stretch gap-0 rounded-md">
      <button
        type="button"
        className="px-0.5 flex items-center text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing touch-none"
        {...listeners}
        aria-label="Arrastrar para reordenar"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="flex-1 min-w-0">
        <ConvRow {...props} />
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
  isVip,
  onToggleVip,
}: {
  c: SlackConversation;
  selected: boolean;
  onClick: () => void;
  title: string;
  isPublicChannel: boolean;
  starred?: boolean;
  onToggleStar?: () => void;
  isVip?: boolean;
  onToggleVip?: () => void;
}) {
  return (
    <div
      className={cn(
        "relative w-full flex items-center gap-0 rounded-md transition-colors group/row",
        selected ? "bg-zinc-700 text-white" : "hover:bg-zinc-800/90",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "relative flex-1 text-left pl-3 pr-1 py-1.5 rounded-md text-[13px] flex items-center gap-2 min-w-0",
          selected ? "font-medium text-white" : "text-zinc-200",
        )}
      >
        {selected && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-primary" aria-hidden />
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
      </button>
      {onToggleVip && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleVip();
          }}
          className={cn(
            "p-1.5 rounded-md shrink-0 text-zinc-500 hover:text-amber-300",
            isVip && "text-amber-400",
          )}
          title={isVip ? "Quitar VIP (siempre notificar)" : "VIP: siempre notificar mensajes"}
        >
          <Crown className={cn("h-3.5 w-3.5", isVip && "fill-amber-400")} />
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
  onToggleVip,
  onToggleStar,
  onReorderVip,
  onReorderStarred,
  headerActions,
}: Props) {
  const [q, setQ] = useState("");

  const filterMatch = (c: SlackConversation) => {
    if (!q.trim()) return true;
    const t = conversationTitle(c, userMap, titleOpts).toLowerCase();
    const n = (c.name || "").toLowerCase();
    const needle = q.trim().toLowerCase();
    return t.includes(needle) || n.includes(needle) || c.id.toLowerCase().includes(needle);
  };

  const pinnedOrVip = (c: SlackConversation) => {
    const p = commPrefsByChannel[c.id];
    return !!(p?.is_vip || p?.is_starred);
  };

  const vipOrdered = useMemo(() => {
    const rows = conversations
      .filter((c) => commPrefsByChannel[c.id]?.is_vip)
      .map((c) => ({
        c,
        o: commPrefsByChannel[c.id]?.sort_order ?? 0,
      }))
      .sort((a, b) => a.o - b.o || a.c.id.localeCompare(b.c.id));
    return rows.map((r) => r.c);
  }, [conversations, commPrefsByChannel]);

  const starredOrdered = useMemo(() => {
    const rows = conversations
      .filter((c) => commPrefsByChannel[c.id]?.is_starred && !commPrefsByChannel[c.id]?.is_vip)
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

  const onDragEndVip = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = vipOrdered.map((c) => c.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorderVip(arrayMove(ids, oldIndex, newIndex));
  };

  const onDragEndStarred = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = starredOrdered.map((c) => c.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorderStarred(arrayMove(ids, oldIndex, newIndex));
  };

  const renderConv = (c: SlackConversation, isPublicChannel: boolean, sortable: boolean) => {
    const p = commPrefsByChannel[c.id];
    const common = {
      c,
      selected: selectedChannel === c.id,
      onClick: () => onSelect(c.id),
      title: conversationTitle(c, userMap, titleOpts),
      isPublicChannel,
      starred: !!p?.is_starred,
      onToggleStar: () => onToggleStar(c.id),
      isVip: !!p?.is_vip,
      onToggleVip: () => onToggleVip(c.id),
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

  const [openVip, setOpenVip] = useState(true);
  const [openPub, setOpenPub] = useState(true);
  const [openPriv, setOpenPriv] = useState(true);
  const [openDm, setOpenDm] = useState(true);
  const [openStar, setOpenStar] = useState(true);

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

  const vipFiltered = vipOrdered.filter(filterMatch);
  const starFiltered = starredOrdered.filter(filterMatch);

  const publicFiltered = groups.publicChannels
    .filter((c) => !pinnedOrVip(c))
    .filter(filterMatch);
  const privateFiltered = groups.privateChannels
    .filter((c) => !pinnedOrVip(c))
    .filter(filterMatch);
  const dmFiltered = groups.allDirectMessages
    .filter((c) => !pinnedOrVip(c))
    .filter(filterMatch);

  return (
    <div className="flex flex-col h-full min-h-0 text-zinc-100">
      <div className="p-2 border-b border-zinc-700/80 shrink-0 space-y-2">
        {headerActions}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar…"
            className="h-8 pl-8 text-xs bg-zinc-800/80 border-zinc-700 placeholder:text-zinc-500 text-zinc-100"
          />
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 pb-6 space-y-1">
          {vipFiltered.length > 0 && (
            <Collapsible open={openVip} onOpenChange={setOpenVip}>
              <SectionHeader label="VIP · siempre notificar" />
              <CollapsibleContent>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEndVip}>
                  <SortableContext items={vipFiltered.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-0.5 mt-1">
                      {vipFiltered.map((c) => {
                        const isPub = !c.is_private && !c.is_im && !c.is_mpim;
                        return renderConv(c, isPub, true);
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              </CollapsibleContent>
            </Collapsible>
          )}

          {starFiltered.length > 0 && (
            <Collapsible open={openStar} onOpenChange={setOpenStar}>
              <SectionHeader label="Destacados" />
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

          {publicFiltered.length > 0 && (
            <Collapsible open={openPub} onOpenChange={setOpenPub}>
              <SectionHeader label="Canales" />
              <CollapsibleContent className="space-y-0.5 mt-1">
                {publicFiltered.map((c) => renderConv(c, true, false))}
              </CollapsibleContent>
            </Collapsible>
          )}

          {privateFiltered.length > 0 && (
            <Collapsible open={openPriv} onOpenChange={setOpenPriv}>
              <SectionHeader label="Canales privados" />
              <CollapsibleContent className="space-y-0.5 mt-1">
                {privateFiltered.map((c) => renderConv(c, false, false))}
              </CollapsibleContent>
            </Collapsible>
          )}

          {dmFiltered.length > 0 && (
            <Collapsible open={openDm} onOpenChange={setOpenDm}>
              <SectionHeader label="Mensajes directos" />
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
