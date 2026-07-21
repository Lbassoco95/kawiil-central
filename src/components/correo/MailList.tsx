import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Search, RefreshCw, Loader2, PenLine, FolderOpen, ListFilter, Paperclip } from "lucide-react";
import { useOutlookEmails, useArchiveEmail, useMarkEmailRead, useMarkEmailUnread, useEmailUserLabels, useEmailLabelAssignmentsBulk, useMicrosoftConnection, useMailFolders } from "@/hooks/useMicrosoft";
import {
  useLinkedOutlookEmailsAll,
  useGmailEmailsAll,
  useMarkLinkedOutlookEmailRead,
  useArchiveLinkedOutlookEmail,
  useMarkGmailRead,
  useArchiveGmail,
  useGoogleConnection,
  useOutlookConnection,
  useLinkedOutlookInboxMeta,
  useGmailInboxMeta,
} from "@/hooks/useLinkedAccounts";
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
  onSelectEmail: (id: string, seed?: Record<string, unknown>) => void;
  /** Doble clic / Enter: abrir la vista completa. */
  onOpenEmail?: (id: string, seed?: Record<string, unknown>) => void;
  onCompose: () => void;
  onOpenFolders: () => void;
  onOpenRules: () => void;
  customFolderOverride?: string;
  customFolderName?: string;
  onClearCustomFolder?: () => void;
  externalLabelFilter?: string | null;
}

type ReadFilter = "todos" | "sinleer" | "leidos";

export function MailList({ activeTab, onSelectTab, selectedEmailId, onSelectEmail, onOpenEmail, onCompose, onOpenFolders, onOpenRules, customFolderOverride, customFolderName, onClearCustomFolder, externalLabelFilter }: Props) {
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

  // Parse linked account folder prefix: "outlook:{accountId}:{folder}" or "gmail:{accountId}:{label}"
  // "unified:all" = bandeja general con TODAS las cuentas mezcladas.
  const isUnified = customFolderOverride === "unified:all";
  const linkedFolderParts = (customFolderOverride ?? "").split(":");
  const folderPfx = linkedFolderParts[0];
  const linkedAccId = linkedFolderParts.length >= 3 ? linkedFolderParts[1] : "";
  const linkedFolderPath = linkedFolderParts.length >= 3 ? linkedFolderParts.slice(2).join(":") : "";
  const isLinkedOutlook = folderPfx === "outlook" && !!linkedAccId && !!customFolderOverride;
  const isLinkedGmail = folderPfx === "gmail" && !!linkedAccId && !!customFolderOverride;
  const isLinkedAccount = isLinkedOutlook || isLinkedGmail;

  // For AI tabs, load inbox and filter client-side
  const isAiTab = AI_TABS.includes(activeTab) && !customFolderOverride;
  const primaryFolderId = (isLinkedAccount || isUnified) ? "inbox" : (customFolderOverride ?? TAB_TO_FOLDER[activeTab] ?? "inbox");

  // Filtro "Sin leer" server-side: en vista principal (solo primary) y también en la vista
  // unificada (todas las cuentas), para que "Sin leer" traiga los no leídos REALES de cada
  // cuenta y no solo los que ya estaban cargados.
  const wantUnread = readFilter === "sinleer" && !debouncedSearch && !isAiTab;
  const serverFilterUnread = wantUnread && !isLinkedAccount && !isUnified;
  const unifiedUnread = wantUnread && isUnified;
  const primaryQuery = useOutlookEmails(
    primaryFolderId,
    (isLinkedAccount || isUnified) ? undefined : debouncedSearch || undefined,
    isUnified ? unifiedUnread : serverFilterUnread,
  );
  const linkedOutlookQuery = useLinkedOutlookEmailsAll({
    accountId: isUnified ? undefined : (linkedAccId || undefined),
    folder: isUnified ? "inbox" : (linkedFolderPath || "inbox"),
    filterUnread: isUnified ? unifiedUnread : undefined,
    enabled: isLinkedOutlook || isUnified,
  });
  const linkedGmailQuery = useGmailEmailsAll({
    accountId: isUnified ? undefined : (linkedAccId || undefined),
    labelId: isUnified ? "INBOX" : (linkedFolderPath || "INBOX"),
    filterUnread: isUnified ? unifiedUnread : undefined,
    enabled: isLinkedGmail || isUnified,
  });
  const { profile } = useMicrosoftConnection();
  const primaryAccountEmail = (profile?.mail || profile?.userPrincipalName || "") as string;

  const activeQuery =
    isLinkedOutlook ? linkedOutlookQuery :
    isLinkedGmail ? linkedGmailQuery :
    primaryQuery;
  const { data } = activeQuery;

  // Unificado: combinar controles de las tres fuentes; en otros modos, los de la fuente activa.
  const isLoading = isUnified
    ? (primaryQuery.isLoading || linkedOutlookQuery.isLoading || linkedGmailQuery.isLoading)
    : activeQuery.isLoading;
  const isFetching = isUnified
    ? (primaryQuery.isFetching || linkedOutlookQuery.isFetching || linkedGmailQuery.isFetching)
    : activeQuery.isFetching;
  const hasNextPage = isUnified
    ? (primaryQuery.hasNextPage || linkedOutlookQuery.hasNextPage || linkedGmailQuery.hasNextPage)
    : activeQuery.hasNextPage;
  const isFetchingNextPage = isUnified
    ? (primaryQuery.isFetchingNextPage || linkedOutlookQuery.isFetchingNextPage || linkedGmailQuery.isFetchingNextPage)
    : activeQuery.isFetchingNextPage;
  const fetchNextPage = () => {
    if (!isUnified) { void activeQuery.fetchNextPage(); return; }
    if (primaryQuery.hasNextPage) void primaryQuery.fetchNextPage();
    if (linkedOutlookQuery.hasNextPage) void linkedOutlookQuery.fetchNextPage();
    if (linkedGmailQuery.hasNextPage) void linkedGmailQuery.fetchNextPage();
  };
  const refetch = () => {
    if (!isUnified) { void activeQuery.refetch(); return; }
    void primaryQuery.refetch();
    void linkedOutlookQuery.refetch();
    void linkedGmailQuery.refetch();
  };

  const linkedError = isLinkedOutlook
    ? (linkedOutlookQuery.error as (Error & { code?: string }) | null)
    : isLinkedGmail
      ? (linkedGmailQuery.error as (Error & { code?: string }) | null)
      : null;
  const primaryError = (!isLinkedAccount && !isUnified) ? (primaryQuery.error as Error | null) : null;

  const archiveLinkedOutlook = useArchiveLinkedOutlookEmail();
  const markLinkedOutlookRead = useMarkLinkedOutlookEmailRead();
  const archiveGmailMut = useArchiveGmail();
  const markGmailRead = useMarkGmailRead();
  const { connect: connectGoogle, isConnecting: googleConnecting } = useGoogleConnection();
  const { connect: connectOutlook, isConnecting: outlookConnecting } = useOutlookConnection();

  // Total REAL de no leídos para la vista general "Todas las cuentas": no leídos de la
  // bandeja principal (Graph) + no leídos reales de cada cuenta vinculada (inbox-meta).
  const { data: foldersForCount } = useMailFolders();
  const { data: outlookMetaCount } = useLinkedOutlookInboxMeta();
  const { data: gmailMetaCount } = useGmailInboxMeta();
  const unifiedUnreadTotal = useMemo(() => {
    if (!isUnified) return null;
    const folders = (foldersForCount?.folders ?? []) as any[];
    const inbox = folders.find(
      (f) => (f.wellKnownFolderName || "").toLowerCase() === "inbox" ||
             String(f.displayName || "").toLowerCase().trim() === "bandeja de entrada" ||
             String(f.displayName || "").toLowerCase().trim() === "inbox",
    );
    const primary = inbox?.unreadItemCount ?? 0;
    const outlook = (outlookMetaCount?.accounts ?? []).reduce((n, a) => n + (a.unreadItemCount ?? 0), 0);
    const gmail = (gmailMetaCount?.accounts ?? []).reduce((n, a) => n + (a.unreadItemCount ?? 0), 0);
    return primary + outlook + gmail;
  }, [isUnified, foldersForCount, outlookMetaCount, gmailMetaCount]);

  const allEmails = useMemo(() => {
    if (!isUnified) {
      return (data?.pages ?? []).flatMap((p) => p.emails as Record<string, unknown>[]);
    }
    // Bandeja general: principal Kawiil (etiquetada con su cuenta) + Outlook vinculadas + Gmail, por fecha desc.
    const primary = (primaryQuery.data?.pages ?? [])
      .flatMap((p) => p.emails as Record<string, unknown>[])
      .map((e) => ({ ...e, _accountEmail: primaryAccountEmail || "Kawiil", _source: "primary" }));
    const linked = (linkedOutlookQuery.data?.pages ?? []).flatMap((p) => p.emails);
    const gmail = (linkedGmailQuery.data?.pages ?? []).flatMap((p) => p.emails);
    return [...primary, ...linked, ...gmail].sort((a, b) =>
      String((b as any).receivedDateTime ?? "").localeCompare(String((a as any).receivedDateTime ?? ""))
    );
  }, [isUnified, data, primaryQuery.data, linkedOutlookQuery.data, linkedGmailQuery.data, primaryAccountEmail]);

  const allEmailIds = useMemo(() => allEmails.map(e => e.id as string).filter(Boolean), [allEmails]);
  const { data: bulkAssignments = [] } = useEmailLabelAssignmentsBulk(allEmailIds);

  // Reset read filter: "sinleer" on tab change, "todos" when entering a custom/linked folder
  useEffect(() => { setReadFilter("sinleer"); }, [activeTab]);
  useEffect(() => {
    if (customFolderOverride) setReadFilter("todos");
  }, [customFolderOverride]);

  const filtered = useMemo(() => {
    let list = allEmails;
    // Bandeja unificada: búsqueda client-side sobre lo cargado (el $search de Graph es por cuenta)
    if (isUnified && debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter((e) => {
        const from = (e.from as any)?.emailAddress;
        return (
          String(e.subject ?? "").toLowerCase().includes(q) ||
          String(e.bodyPreview ?? "").toLowerCase().includes(q) ||
          String(from?.name ?? "").toLowerCase().includes(q) ||
          String(from?.address ?? "").toLowerCase().includes(q)
        );
      });
    }
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
  }, [allEmails, activeTab, isAiTab, isUnified, debouncedSearch, readFilter, attachmentFilter, dateRangeFilter, effectiveLabelFilter, bulkAssignments]);

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
          // Vista general: total REAL sumado de todas las cuentas. Vista principal: totalCount de
          // Graph cuando filtra unread. En otros casos, conteo entre lo cargado.
          const serverTotal = serverFilterUnread ? ((data?.pages?.[0] as any)?.totalCount ?? null) : null;
          const unreadCount = f === "sinleer"
            ? (isUnified ? (unifiedUnreadTotal ?? allEmails.filter(e => !(e.isRead as boolean)).length)
                         : (serverTotal ?? allEmails.filter(e => !(e.isRead as boolean)).length))
            : null;
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
        {!isLoading && linkedError && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-6">
            <span className="text-3xl">🔑</span>
            <p className="text-[14px] font-semibold text-foreground">No se pudo cargar esta cuenta</p>
            <p className="text-[12.5px] text-muted-foreground max-w-sm">
              {linkedError.code === "REAUTH_REQUIRED"
                ? "Esta cuenta se conectó solo para calendario. Reconéctala para autorizar el acceso al correo."
                : linkedError.message}
            </p>
            <button
              onClick={() => (isLinkedGmail ? connectGoogle() : connectOutlook())}
              disabled={googleConnecting || outlookConnecting}
              className="mt-1 h-8 px-4 rounded-full bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {(googleConnecting || outlookConnecting) && <Loader2 className="w-3 h-3 animate-spin" />}
              Reconectar cuenta {isLinkedGmail ? "de Google" : "de Outlook"}
            </button>
          </div>
        )}
        {!isLoading && primaryError && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-6">
            <span className="text-3xl">⚠️</span>
            <p className="text-[14px] font-semibold text-foreground">No se pudieron cargar los correos</p>
            <p className="text-[12.5px] text-muted-foreground max-w-sm break-words">{primaryError.message}</p>
            <button
              onClick={() => { void refetch(); }}
              className="mt-1 h-8 px-4 rounded-full bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 transition-colors"
            >
              Reintentar
            </button>
          </div>
        )}
        {!isLoading && !linkedError && !primaryError && filtered.length === 0 && (
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
                onClick={() => onSelectEmail(emailId, email)}
                onOpen={onOpenEmail ? () => onOpenEmail(emailId, email) : undefined}
                onArchive={() => {
                  // Rutear por el prefijo del ID del correo (funciona también en la bandeja unificada)
                  const parts = emailId.split(":");
                  const accId = parts.length >= 3 ? parts[1] : "";
                  if (parts[0] === "outlook" && accId) archiveLinkedOutlook.mutate({ accountId: accId, emailId });
                  else if (parts[0] === "gmail" && accId) archiveGmailMut.mutate({ accountId: accId, emailId });
                  else archiveEmail.mutate(emailId);
                }}
                onMarkRead={() => {
                  const parts = emailId.split(":");
                  const accId = parts.length >= 3 ? parts[1] : "";
                  if (parts[0] === "outlook" && accId) {
                    if (!email.isRead) markLinkedOutlookRead.mutate({ accountId: accId, emailId });
                  } else if (parts[0] === "gmail" && accId) {
                    if (!email.isRead) markGmailRead.mutate({ accountId: accId, emailId });
                  } else {
                    if (email.isRead) markUnread.mutate(emailId);
                    else markRead.mutate(emailId);
                  }
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
