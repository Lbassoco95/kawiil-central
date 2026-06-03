import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Search, RefreshCw, Loader2, PenLine, FolderOpen, ListFilter } from "lucide-react";
import { useOutlookEmails, useArchiveEmail, useMarkEmailRead } from "@/hooks/useMicrosoft";
import { useQueryClient } from "@tanstack/react-query";
import {
  emailListTimestamp,
  getDateBucket,
  DATE_BUCKET_LABELS,
  type DateBucket,
  inferEmailChips,
} from "@/lib/emailChips";
import { MailItem } from "./MailItem";
import { MailTabs, type MailTabId } from "./MailTabs";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

// AI tab IDs that filter inbox emails client-side
const AI_TABS: MailTabId[] = ["clientes", "sat", "facturas", "interno"];
const AI_TAB_TONE: Record<string, string> = {
  clientes: "cliente",
  sat: "sat",
  facturas: "factura",
  interno: "interno",
};

// Map tab to real folder ID for Graph API
const TAB_TO_FOLDER: Partial<Record<MailTabId, string>> = {
  inbox: "inbox",
  starred: "inbox",
  sentItems: "sentItems",
  drafts: "drafts",
};

interface Props {
  activeTab: MailTabId;
  onSelectTab: (tab: MailTabId) => void;
  selectedEmailId: string | null;
  onSelectEmail: (id: string) => void;
  onCompose: () => void;
  onOpenFolders: () => void;
  onOpenRules: () => void;
}

export function MailList({ activeTab, onSelectTab, selectedEmailId, onSelectEmail, onCompose, onOpenFolders, onOpenRules }: Props) {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);
  const archiveEmail = useArchiveEmail();
  const markRead = useMarkEmailRead();

  const debouncedSearch = useDebouncedValue(search, 350);

  // For AI tabs, load inbox and filter client-side
  const isAiTab = AI_TABS.includes(activeTab);
  const folderId = TAB_TO_FOLDER[activeTab] ?? "inbox";

  const { data, isLoading, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useOutlookEmails(folderId, debouncedSearch || undefined);

  const allEmails = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.emails as Record<string, unknown>[]),
    [data]
  );

  const filtered = useMemo(() => {
    let list = allEmails;
    if (activeTab === "starred") {
      list = list.filter((e) => (e.flag as any)?.flagStatus === "flagged");
    }
    if (isAiTab) {
      const tone = AI_TAB_TONE[activeTab];
      list = list.filter((e) => {
        const chips = inferEmailChips({
          from: e.from as { emailAddress?: { address?: string } },
          subject: e.subject as string,
          importance: e.importance as string,
        });
        return chips.some((c) => c.tone === tone);
      });
    }
    return list;
  }, [allEmails, activeTab, isAiTab]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const now = useMemo(() => new Date(), []);
  const groups = useMemo(() => {
    const order: DateBucket[] = ["hoy", "ayer", "semana", "anterior"];
    const map: Record<DateBucket, Record<string, unknown>[]> = { hoy: [], ayer: [], semana: [], anterior: [] };
    for (const email of filtered) {
      const ts = emailListTimestamp({
        receivedDateTime: email.receivedDateTime as string | undefined,
        sentDateTime: email.sentDateTime as string | undefined,
        createdDateTime: email.createdDateTime as string | undefined,
      });
      map[getDateBucket(ts, now)].push(email);
    }
    return order.filter((b) => map[b].length > 0).map((b) => ({ bucket: b, emails: map[b] }));
  }, [filtered, now]);

  // Date bucket label with weekday
  const bucketLabel = (bucket: DateBucket) => {
    if (bucket === "hoy") return `HOY · ${format(new Date(), "EEEE d 'de' MMMM", { locale: es }).toUpperCase()}`;
    if (bucket === "ayer") {
      const ayer = new Date();
      ayer.setDate(ayer.getDate() - 1);
      return `AYER · ${format(ayer, "EEEE d", { locale: es }).toUpperCase()}`;
    }
    return DATE_BUCKET_LABELS[bucket].toUpperCase();
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tabs */}
      <MailTabs activeTab={activeTab} onSelectTab={onSelectTab} />

      {/* Toolbar row */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/40 shrink-0">
        <button
          onClick={onCompose}
          className="h-8 flex items-center gap-1.5 px-3 rounded-full bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 transition-colors shrink-0"
        >
          <PenLine className="w-3.5 h-3.5" />
          Redactar
        </button>
        <div className="flex-1" />
        <button
          onClick={onOpenFolders}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
          title="Carpetas"
        >
          <FolderOpen className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onOpenRules}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
          title="Reglas"
        >
          <ListFilter className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Search row */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/40 shrink-0">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar correos…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-[12.5px] bg-muted/50 border border-border/50 rounded-lg outline-none focus:border-primary/40 focus:bg-background placeholder:text-muted-foreground/60"
          />
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ["outlook-emails"] })}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
          title="Actualizar"
        >
          {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Email list */}
      <div className="flex-1 overflow-y-auto min-h-0" ref={listRef}>
        {isLoading && (
          <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando mensajes…
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground">
            No hay mensajes
          </div>
        )}
        {groups.map(({ bucket, emails }) => (
          <div key={bucket}>
            <div className="px-4 py-2.5 text-[10px] font-bold tracking-widest text-muted-foreground/60 sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
              {bucketLabel(bucket)}
            </div>
            {emails.map((email) => (
              <MailItem
                key={email.id as string}
                email={email}
                isActive={selectedEmailId === (email.id as string)}
                onClick={() => onSelectEmail(email.id as string)}
                onArchive={() => archiveEmail.mutate(email.id as string)}
                onMarkRead={() => markRead.mutate(email.id as string)}
              />
            ))}
          </div>
        ))}
        {isFetchingNextPage && (
          <div className="flex items-center justify-center py-4 text-[12px] text-muted-foreground gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando más…
          </div>
        )}
      </div>
    </div>
  );
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
