import { useMemo, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Hash, Lock, MessageCircle, Users, Search } from "lucide-react";
import type { SlackConversation } from "@/lib/slackApi";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";
import { groupSlackConversations, conversationTitle } from "./slackGrouping";
import { cn } from "@/lib/utils";

type Props = {
  conversations: SlackConversation[];
  userMap: Record<string, SlackUserProfile | undefined>;
  selectedChannel: string;
  onSelect: (channelId: string) => void;
  isLoading: boolean;
  error: Error | null;
};

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
        {label}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function ConvRow({
  c,
  selected,
  onClick,
  title,
  isPublicChannel,
}: {
  c: SlackConversation;
  selected: boolean;
  onClick: () => void;
  title: string;
  isPublicChannel: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative w-full text-left pl-3 pr-2 py-1.5 rounded-md text-[13px] flex items-center gap-2 transition-colors",
        selected
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground/90 hover:bg-sidebar-accent/50",
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
      <span className="truncate">{isPublicChannel && c.name ? `#${c.name}` : title}</span>
    </button>
  );
}

export function SlackConversationList({
  conversations,
  userMap,
  selectedChannel,
  onSelect,
  isLoading,
  error,
}: Props) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => groupSlackConversations(conversations), [conversations]);

  const filterMatch = (c: SlackConversation) => {
    if (!q.trim()) return true;
    const t = conversationTitle(c, userMap).toLowerCase();
    const n = (c.name || "").toLowerCase();
    const needle = q.trim().toLowerCase();
    return t.includes(needle) || n.includes(needle) || c.id.toLowerCase().includes(needle);
  };

  const renderGroup = (items: SlackConversation[], isPublicChannel: boolean) =>
    items.filter(filterMatch).map((c) => (
      <ConvRow
        key={c.id}
        c={c}
        selected={selectedChannel === c.id}
        onClick={() => onSelect(c.id)}
        title={conversationTitle(c, userMap)}
        isPublicChannel={isPublicChannel}
      />
    ));

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <Loader2 className="h-7 w-7 animate-spin text-sidebar-foreground/40" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive">
        {error.message}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-2 border-b border-sidebar-border/60 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sidebar-foreground/40" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar…"
            className="h-8 pl-8 text-xs bg-sidebar-accent/30 border-sidebar-border/50 placeholder:text-sidebar-foreground/40"
          />
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 pb-6">
          {groups.publicChannels.length > 0 && (
            <Section label="Canales">{renderGroup(groups.publicChannels, true)}</Section>
          )}
          {groups.privateChannels.length > 0 && (
            <Section label="Canales privados">{renderGroup(groups.privateChannels, false)}</Section>
          )}
          {groups.directMessages.length > 0 && (
            <Section label="Mensajes directos">{renderGroup(groups.directMessages, false)}</Section>
          )}
          {groups.groupDms.length > 0 && (
            <Section label="Grupos">{renderGroup(groups.groupDms, false)}</Section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
