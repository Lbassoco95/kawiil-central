import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Search, RefreshCw, Loader2, PenLine, FolderOpen, ListFilter, Paperclip } from "lucide-react";
import { useOutlookEmails, useArchiveEmail, useMarkEmailRead, useMarkEmailUnread, useEmailUserLabels, useEmailLabelAssignmentsBulk } from "@/hooks/useMicrosoft";
import { useQueryClient } from "@tanstack/react-query";
import { getLabelStyle } from "./MailLabelPicker";
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
  customFolderOverride?: string;
  customFolderName?: string;
  onClearCustomFolder?: () => void;
  externalLabelFilter?: string | null;
}

type ReadFilter = "todos" | "sinleer" | "leidos";

export function MailList({ activeTab, onSelectTab, selectedEmailId, onSelectEmail, onCompose, onOpenFolders, onOpenRules, customFolderOverride, customFolderName, onClearCustomFolder, externalLabelFilter }: Props) {
  const [search, setSearch] = useState("");
  const [readFilter, setReadFilter] = useState<ReadFilter>("sinleer");
  const [attachmentFilter, setAttachmentFilter] = useState(false);
  type DateRangeFilter = "todos" | "hoy" | "semana" | "mes";
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>("todos");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const effectiveLabelFilter = externalLabelFilter !== undefined ? externalLabelFilter : labelFilter;
  const queryClient = useQueryClient();
  const { data: userLabels = [] } = useEmailUserLabels();
  const listRef = useRef<HTMLDivElement>(null);
  const archiveEmail = useArchiveEmail();
  const markRead = useMarkEmailRead();
  const markUnread = useMarkEmailUnread();

  const debouncedSearch = useDebouncedValue(search, 350);

  // For AI tabs, load inbox and filter client-side
  const isAiTab = AI_TABS.includes(activeTab) && !customFolderOverride;
  const folderId = customFolderOverride ?? TAB_TO_FOLDER[activeTab] ?? "inbox";

  const { data, isLoading, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useOutlookEmails(folderId, debouncedSearch || undefined);

  const allEmails = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.emails as Record<string, unknown>[]),
    [data]
  );

  const allEmailIds = useMemo(() => allEmails.map(e => e.id as string).filter(Boolean), [allEmails]);
  const { data: bulkAssignments = [] } = useEmailLabelAssignmentsBulk(allEmailIds);

  // Reset read filter when tab changes
  useEffect(() => { setReadFilter("sinleer"); }, [activeTab]);

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
    if (readFilter === "sinleer") list = list.filter((e) => !(e.isRead as boolean));
    if (readFilter === "leidos") list = list.filter((e) => e.isRead as boolean);
    if (attachmentFilter) list = list.filter((e) => !!(e.hasAttachments as boolean));
    if (dateRangeFilter !== "todos") {
      const cutoff = new Date();
      if (dateRangeFilter === "hoy") { cutoff.setHours(0, 0, 0, 0); }
      else if (dateRangeFilter === "semana") { cutoff.setDate(cutoff.getDate() - 7); cutoff.setHours(0, 0, 0, 0); }
      else if (dateRangeFilter === "mes") { cutoff.setDate(cutoff.getDate() - 30); cutoff.setHours(0, 0, 0, 0); }
      list = list.filter((e) => {
        const ts = emailListTimestamp({
          receivedDateTime: e.receivedDateTime as string | undefined,
          sentDateTime: e.sentDateTime as string | undefined,
          createdDateTime: e.createdDateTime as string | undefined,
        });
        return ts >= cutoff.toISOString();
      });
    }
    if (effectiveLabelFilter) {
      const emailsWithLabel = new Set(
        bulkAssignments.filter(a => a.label_id === effectiveLabelFilter).map(a => a.email_message_id)
      );
      list = list.filter((e) => emailsWithLabel.has(e.id as string));
    }
    return list;
  }, [allEmails, activeTab, isAiTab, readFilter, attachmentFilter, dateRangeFilter, effectiveLabelFilter, bulkAssignments]);

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
    const map: Record<DateBucket, { email: Record<string, unknown>; ts: string }[]> = { hoy: [], ayer: [], semana: [], anterior: [] };
    for (const email of filtered) {
      const ts = emailListTimestamp({
        receivedDateTime: email.receivedDateTime as string | undefined,
        sentDateTime: email.sentDateTime as string | undefined,
        createdDateTime: email.createdDateTime as string | undefined,
      });
      map[getDateBucket(ts, now)].push({ email, ts });
    }
    return order
      .filter((b) => map[b].length > 0)
      .map((b) => ({
        bucket: b,
        emails: map[b].sort((x, y) => (y.ts > x.ts ? 1 : -1)).map((item) => item.email),
      }));
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

      {/* Custom folder breadcrumb */}
      {customFolderOverride && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/5 border-b border-primary/20 shrink-0">
          <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-[12px] font-medium text-primary flex-1 truncate">{customFolderName || "Carpeta"}</span>
          <button
            onClick={onClearCustomFolder}
            className="text-[11px] text-primary/60 hover:text-primary transition-colors"
          >
            ← Bandeja
          </button>
        </div>
      )}

      {/* Label filter row — only show if user has labels */}
      {userLabels.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/30 shrink-0 overflow-x-auto">
          <button
            onClick={() => setLabelFilter(null)}
            className={cn(
              "px-2.5 py-1 text-[11.5px] rounded-full whitespace-nowrap transition-colors shrink-0",
              !effectiveLabelFilter ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Todas
          </button>
          {userLabels.map(label => {
            const style = getLabelStyle(label.color);
            return (
              <button
                key={label.id}
                onClick={() => setLabelFilter(effectiveLabelFilter === label.id ? null : label.id)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] rounded-full whitespace-nowrap transition-colors shrink-0",
                  effectiveLabelFilter === label.id ? "font-semibold" : "hover:opacity-80"
                )}
                style={effectiveLabelFilter === label.id
                  ? { background: style.bg, color: style.text }
                  : { color: style.text }
                }
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: style.dot }} />
                {label.name}
              </button>
            );
          })}
        </div>
      )}

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
          onClick={() => { void refetch(); }}
          disabled={isFetching}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0 disabled:opacity-40"
          title="Sincronizar con Outlook"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
        </button>
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

      {/* Read filter + attachment toggle */}
      <div className="flex items-center gap-0 px-3 py-1.5 border-b border-border/30 shrink-0">
        {(["sinleer", "leidos", "todos"] as ReadFilter[]).map((f) => {
          const labelMap: Record<ReadFilter, string> = { sinleer: "Sin leer", leidos: "Leídos", todos: "Todos" };
          const unreadCount = f === "sinleer" ? allEmails.filter(e => !(e.isRead as boolean)).length : null;
          return (
            <button
              key={f}
              onClick={() => setReadFilter(f)}
              className={cn(
                "px-3 py-1 text-[11.5px] rounded-full transition-colors",
                readFilter === f
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {labelMap[f]}{unreadCount != null ? ` (${unreadCount})` : ""}
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          onClick={() => setAttachmentFilter((v) => !v)}
          className={cn(
            "flex items-center gap-1 px-2 py-1 text-[11px] rounded-full transition-colors",
            attachmentFilter
              ? "bg-primary/10 text-primary font-semibold"
              : "text-muted-foreground hover:text-foreground"
          )}
          title="Filtrar por correos con adjuntos"
        >
          <Paperclip className="w-3 h-3" />
          Adjuntos
        </button>
      </div>

      {/* Date range filter */}
      <div className="flex items-center gap-0 px-3 py-1 border-b border-border/20 shrink-0">
        {([
          { id: "todos", label: "Cualquier fecha" },
          { id: "hoy",   label: "Hoy" },
          { id: "semana",label: "Esta semana" },
          { id: "mes",   label: "Este mes" },
        ] as { id: DateRangeFilter; label: string }[]).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setDateRangeFilter(id)}
            className={cn(
              "px-2.5 py-1 text-[11px] rounded-full transition-colors whitespace-nowrap",
              dateRangeFilter === id
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
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
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-6">
            {readFilter === "sinleer" ? (
              <>
                <span className="text-3xl">✓</span>
                <p className="text-[14px] font-semibold text-foreground">Estás al día</p>
                <p className="text-[12.5px] text-muted-foreground">No tienes correos nuevos sin leer.</p>
              </>
            ) : (
              <p className="text-[13px] text-muted-foreground">No hay mensajes</p>
            )}
          </div>
        )}
        {groups.map(({ bucket, emails }) => (
          <div key={bucket}>
            <div className="px-4 py-2.5 text-[10px] font-bold tracking-widest text-muted-foreground/60 sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
              {bucketLabel(bucket)}
            </div>
            {emails.map((email) => {
              const emailId = email.id as string;
              const chips = bulkAssignments
                .filter(a => a.email_message_id === emailId && a.email_user_labels)
                .map(a => ({ name: a.email_user_labels!.name, color: a.email_user_labels!.color }));
              return (
              <MailItem
                key={emailId}
                email={email}
                isActive={selectedEmailId === emailId}
                onClick={() => onSelectEmail(emailId)}
                onArchive={() => archiveEmail.mutate(emailId)}
                onMarkRead={() => {
                  if (email.isRead) markUnread.mutate(emailId);
                  else markRead.mutate(emailId);
                }}
                labelChips={chips.length > 0 ? chips : undefined}
              />
              );
            })}
          </div>
        ))}
        {isFetchingNextPage && (
          <div className="flex items-center justify-center py-4 text-[12px] text-muted-foreground gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando más…
          </div>
        )}
        {hasNextPage && !isFetchingNextPage && (
          <button
            onClick={() => fetchNextPage()}
            className="w-full py-3 text-[12px] text-primary hover:text-primary/80 hover:bg-primary/5 transition-colors font-medium"
          >
            Cargar más mensajes
          </button>
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
