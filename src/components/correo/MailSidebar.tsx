import { useState, useMemo } from "react";
import {
  PenLine,
  Inbox,
  Star,
  Users,
  AlertCircle,
  FileText,
  Building,
  Send,
  FileEdit,
  Folder,
  Plus,
  X,
  Loader2,
  Search,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type MailTabId } from "./MailTabs";
import {
  useOutlookEmails,
  useMailFolders,
  useChildFolders,
  useEmailUserLabels,
  useCreateEmailLabel,
} from "@/hooks/useMicrosoft";
import { getLabelStyle, LABEL_COLORS } from "./MailLabelPicker";
import {
  useLinkedAccounts,
  useLinkedOutlookInboxMeta,
  useGmailInboxMeta,
  useGmailLabels,
  linkedAccountColor,
  type LinkedAccount,
} from "@/hooks/useLinkedAccounts";
import { MailAccountBadge } from "./MailAccountBadge";

interface MailSidebarProps {
  activeTab: MailTabId;
  onSelectTab: (tab: MailTabId) => void;
  onCompose: () => void;
  onSelectFolder: (id: string, name: string) => void;
  activeCustomFolderId?: string;
  activeLabelId?: string | null;
  onSelectLabel: (id: string | null) => void;
}

interface NavItem {
  id: MailTabId;
  label: string;
  icon: React.ReactNode;
  dot?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "inbox", label: "Bandeja", icon: <Inbox className="w-[15px] h-[15px]" /> },
  { id: "starred", label: "Destacados", icon: <Star className="w-[15px] h-[15px]" /> },
  { id: "clientes", label: "Clientes", icon: <Users className="w-[15px] h-[15px]" />, dot: "hsl(210 100% 47%)" },
  { id: "sat", label: "SAT", icon: <AlertCircle className="w-[15px] h-[15px]" />, dot: "hsl(0 72% 51%)" },
  { id: "facturas", label: "Facturas", icon: <FileText className="w-[15px] h-[15px]" />, dot: "hsl(32 90% 48%)" },
  { id: "interno", label: "Interno", icon: <Building className="w-[15px] h-[15px]" />, dot: "hsl(157 72% 36%)" },
  { id: "sentItems", label: "Enviados", icon: <Send className="w-[15px] h-[15px]" /> },
  { id: "drafts", label: "Borradores", icon: <FileEdit className="w-[15px] h-[15px]" /> },
];

// Well-known folder names from Graph API (wellKnownFolderName field).
const WELL_KNOWN_IDS = new Set([
  "inbox", "drafts", "sentitems", "deleteditems", "junkemail",
  "outbox", "archive", "msgfolderroot", "recoverableitemsdeletions",
  "conversationhistory", "scheduled",
]);

// Display name fallback: Graph API sometimes omits wellKnownFolderName for system folders
// when they are returned as children of another folder. We filter these by known
// Spanish and English display names to avoid duplicating nav items.
const SYSTEM_DISPLAY_NAMES = new Set([
  // Spanish (Microsoft 365 es-MX / es-ES)
  "bandeja de entrada", "borradores", "elementos enviados", "enviados",
  "elementos eliminados", "correo eliminado", "correo no deseado",
  "archivo", "bandeja de salida", "historial de conversaciones",
  // English
  "inbox", "drafts", "sent items", "deleted items", "junk email",
  "archive", "outbox", "conversation history", "scheduled",
]);

function isSystemFolder(f: { wellKnownFolderName?: string; displayName: string }): boolean {
  if (f.wellKnownFolderName && WELL_KNOWN_IDS.has(f.wellKnownFolderName.toLowerCase())) return true;
  if (SYSTEM_DISPLAY_NAMES.has(f.displayName.toLowerCase().trim())) return true;
  return false;
}

type FolderItem = {
  id: string;
  displayName: string;
  wellKnownFolderName?: string;
  unreadItemCount?: number;
  childFolderCount?: number;
  parentFolderId?: string;
};

function FolderRow({
  folder,
  depth,
  activeCustomFolderId,
  onSelectLabel,
  onSelectFolder,
  expandedFolderIds,
  toggleExpanded,
  searchActive,
}: {
  folder: FolderItem;
  depth: number;
  activeCustomFolderId?: string;
  onSelectLabel: (id: string | null) => void;
  onSelectFolder: (id: string, name: string) => void;
  expandedFolderIds: Set<string>;
  toggleExpanded: (id: string) => void;
  searchActive: boolean;
}) {
  const isExpanded = expandedFolderIds.has(folder.id);
  const hasChildren = (folder.childFolderCount ?? 0) > 0;
  const { data: children = [], isLoading: childrenLoading } = useChildFolders(
    isExpanded && !searchActive ? folder.id : null,
  );
  const active = activeCustomFolderId === folder.id;
  const MAX_DEPTH = 5;

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-0 w-full rounded-md transition-colors",
          active
            ? "bg-accent text-foreground font-semibold border-l-2 border-primary"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
        style={{ paddingLeft: depth * 12 }}
      >
        {/* Expand/collapse chevron — only visible when not searching and folder has children */}
        {hasChildren && !searchActive ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(folder.id);
            }}
            className="flex items-center justify-center w-5 h-8 shrink-0 text-muted-foreground/60 hover:text-foreground"
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}

        {/* Folder name button */}
        <button
          onClick={() => { onSelectLabel(null); onSelectFolder(folder.id, folder.displayName); }}
          className={cn(
            "flex items-center gap-2 flex-1 h-8 text-[12px] text-left min-w-0",
            active ? "pr-2.5" : "pr-2.5",
          )}
        >
          <Folder className={cn("w-[13px] h-[13px] shrink-0", active ? "text-primary" : "text-muted-foreground/70")} />
          <span className="flex-1 truncate">{folder.displayName}</span>
          {(folder.unreadItemCount ?? 0) > 0 && (
            <span className="text-[10px] font-medium text-muted-foreground/70 shrink-0">
              {folder.unreadItemCount}
            </span>
          )}
        </button>
      </div>

      {/* Loading indicator for children */}
      {childrenLoading && isExpanded && !searchActive && (
        <div style={{ paddingLeft: (depth + 1) * 12 + 20 }} className="py-1">
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/50" />
        </div>
      )}

      {/* Children */}
      {isExpanded && !searchActive && children.length > 0 && depth < MAX_DEPTH && (
        <div className="flex flex-col gap-0.5">
          {children.map((child) => (
            <FolderRow
              key={child.id}
              folder={child}
              depth={depth + 1}
              activeCustomFolderId={activeCustomFolderId}
              onSelectLabel={onSelectLabel}
              onSelectFolder={onSelectFolder}
              expandedFolderIds={expandedFolderIds}
              toggleExpanded={toggleExpanded}
              searchActive={searchActive}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ─── Linked Outlook account section ──────────────────────────────────────────
function LinkedOutlookSection({
  account,
  unreadCount,
  activeCustomFolderId,
  onSelectFolder,
}: {
  account: LinkedAccount;
  unreadCount: number;
  activeCustomFolderId?: string;
  onSelectFolder: (id: string, name: string) => void;
}) {
  const color = linkedAccountColor(account.email || account.id);
  const label = account.display_name || account.email || "Outlook";
  const inboxId = `outlook:${account.id}:inbox`;
  const sentId = `outlook:${account.id}:sentItems`;

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5 px-4 mb-1">
        <MailAccountBadge email={account.email || account.id} color={color} size="sm" />
        <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground/60 truncate flex-1">
          {label}
        </p>
        {unreadCount > 0 && (
          <span className="text-[10px] font-medium text-muted-foreground/60 shrink-0">{unreadCount}</span>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-2">
        {[
          { id: inboxId, label: "Bandeja", icon: <Inbox className="w-[13px] h-[13px]" /> },
          { id: sentId, label: "Enviados", icon: <Send className="w-[13px] h-[13px]" /> },
        ].map(item => {
          const active = activeCustomFolderId === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectFolder(item.id, `${label} · ${item.label}`)}
              className={cn(
                "flex items-center gap-2 w-full h-7 px-2 rounded-md text-[12px] transition-colors text-left",
                active
                  ? "bg-accent text-foreground font-semibold border-l-2 border-primary pl-[7px]"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <span className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground/70")}>{item.icon}</span>
              <span className="flex-1 truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Linked Gmail account section ─────────────────────────────────────────────
function LinkedGmailSection({
  account,
  unreadCount,
  activeCustomFolderId,
  onSelectFolder,
}: {
  account: LinkedAccount;
  unreadCount: number;
  activeCustomFolderId?: string;
  onSelectFolder: (id: string, name: string) => void;
}) {
  const color = linkedAccountColor(account.email || account.id);
  const label = account.display_name || account.email || "Gmail";
  const inboxId = `gmail:${account.id}:INBOX`;
  const sentId = `gmail:${account.id}:SENT`;

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5 px-4 mb-1">
        <MailAccountBadge email={account.email || account.id} color={color} size="sm" />
        <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground/60 truncate flex-1">
          {label}
        </p>
        {unreadCount > 0 && (
          <span className="text-[10px] font-medium text-muted-foreground/60 shrink-0">{unreadCount}</span>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-2">
        {[
          { id: inboxId, label: "Recibidos", icon: <Inbox className="w-[13px] h-[13px]" /> },
          { id: sentId, label: "Enviados", icon: <Send className="w-[13px] h-[13px]" /> },
        ].map(item => {
          const active = activeCustomFolderId === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectFolder(item.id, `${label} · ${item.label}`)}
              className={cn(
                "flex items-center gap-2 w-full h-7 px-2 rounded-md text-[12px] transition-colors text-left",
                active
                  ? "bg-accent text-foreground font-semibold border-l-2 border-primary pl-[7px]"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <span className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground/70")}>{item.icon}</span>
              <span className="flex-1 truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MailSidebar({
  activeTab,
  onSelectTab,
  onCompose,
  onSelectFolder,
  activeCustomFolderId,
  activeLabelId,
  onSelectLabel,
}: MailSidebarProps) {
  // Derive unread count from the same React Query cache that MailList uses
  const { data: inboxData } = useOutlookEmails("inbox");
  const unreadCount = useMemo(() => {
    return (inboxData?.pages ?? [])
      .flatMap((p) => p.emails as any[])
      .filter((e) => !e.isRead)
      .length;
  }, [inboxData]);

  const { data: foldersData, isFetching: foldersFetching, refetch: refetchFolders } = useMailFolders();
  const { data: userLabels = [] } = useEmailUserLabels();
  const createLabel = useCreateEmailLabel();

  const [folderSearch, setFolderSearch] = useState("");
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [newLabelOpen, setNewLabelOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("blue");

  const toggleExpanded = (id: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allFolders = (foldersData?.folders ?? []) as {
    id: string;
    displayName: string;
    wellKnownFolderName?: string;
    unreadItemCount?: number;
    childFolderCount?: number;
    parentFolderId?: string;
  }[];

  const customFolders = useMemo(
    () => allFolders.filter((f) => !isSystemFolder(f)),
    [allFolders],
  );

  const filteredFolders = useMemo(() => {
    const q = folderSearch.trim().toLowerCase();
    if (!q) return customFolders;
    return customFolders.filter((f) => f.displayName.toLowerCase().includes(q));
  }, [customFolders, folderSearch]);

  const handleCreateLabel = async () => {
    if (!newLabelName.trim()) return;
    await createLabel.mutateAsync({ name: newLabelName.trim(), color: newLabelColor });
    setNewLabelName("");
    setNewLabelColor("blue");
    setNewLabelOpen(false);
  };

  const { data: linkedAccounts = [] } = useLinkedAccounts();
  const { data: outlookInboxMeta } = useLinkedOutlookInboxMeta();
  const { data: gmailInboxMeta } = useGmailInboxMeta();

  const outlookUnreadMap = Object.fromEntries(
    (outlookInboxMeta?.accounts ?? []).map(a => [a.accountId, a.unreadItemCount])
  );
  const gmailUnreadMap = Object.fromEntries(
    (gmailInboxMeta?.accounts ?? []).map(a => [a.accountId, a.unreadItemCount])
  );
  const outlookLinked = linkedAccounts.filter(a => a.provider === "microsoft" && a.mail_enabled);
  const gmailLinked = linkedAccounts.filter(a => a.provider === "google" && a.mail_enabled);
  const hasLinkedAccounts = outlookLinked.length > 0 || gmailLinked.length > 0;

  const isTabActive = (id: MailTabId) => activeTab === id && !activeCustomFolderId && activeLabelId == null;

  return (
    <div className="w-[200px] shrink-0 bg-card border-r border-border/40 flex flex-col h-full min-h-0">
      {/* Compose button */}
      <div className="px-3 pt-4 pb-2 shrink-0">
        <button
          onClick={onCompose}
          className="w-full flex items-center justify-center gap-2 h-9 rounded-full bg-primary text-primary-foreground text-[12.5px] font-semibold hover:bg-primary/90 transition-colors"
        >
          <PenLine className="w-3.5 h-3.5" />
          Redactar
        </button>
      </div>

      {/* Navigation items — fixed, never scroll away */}
      <nav className="flex flex-col gap-0.5 px-2 pb-2 shrink-0">
        {NAV_ITEMS.map((item) => {
          const active = isTabActive(item.id);
          const badge = item.id === "inbox" && unreadCount > 0 ? unreadCount : null;
          return (
            <button
              key={item.id}
              onClick={() => { onSelectLabel(null); onSelectTab(item.id); }}
              className={cn(
                "flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-[12.5px] transition-colors text-left",
                active
                  ? "bg-accent text-foreground font-semibold border-l-2 border-primary pl-[9px]"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              {item.dot && !active && (
                <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: item.dot }} />
              )}
              {(!item.dot || active) && (
                <span className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground")}>
                  {item.icon}
                </span>
              )}
              <span className="flex-1 truncate">{item.label}</span>
              {badge != null && (
                <span className="text-[10.5px] font-medium text-muted-foreground shrink-0">{badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mx-3 border-t border-border/40 shrink-0" />

      {/* Carpetas section — independent scroll so nav items always visible */}
      <div className="flex flex-col min-h-0 shrink" style={{ maxHeight: "45%" }}>
        {/* Header with search */}
        <div className="px-2 pt-2.5 pb-1 shrink-0">
          <div className="flex items-center justify-between px-2 mb-1.5">
            <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Carpetas
            </p>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground/50">{customFolders.length}</span>
              <button
                onClick={() => { void refetchFolders(); }}
                title="Actualizar carpetas"
                className="text-muted-foreground/50 hover:text-foreground transition-colors"
              >
                <Loader2 className={cn("w-3 h-3", foldersFetching ? "animate-spin" : "hidden")} />
                {!foldersFetching && <RefreshCw className="w-3 h-3" />}
              </button>
            </div>
          </div>
          {customFolders.length > 6 && (
            <div className="relative mb-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50 pointer-events-none" />
              <input
                type="text"
                value={folderSearch}
                onChange={(e) => setFolderSearch(e.target.value)}
                placeholder="Buscar carpeta…"
                className="w-full h-6 pl-6 pr-2 text-[11px] bg-muted/40 border border-border/30 rounded outline-none focus:border-primary/40 focus:bg-background placeholder:text-muted-foreground/50"
              />
              {folderSearch && (
                <button
                  onClick={() => setFolderSearch("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Scrollable folder list */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {customFolders.length === 0 && (
            <p className="text-[11.5px] text-muted-foreground/50 px-2.5 py-1 italic">Sin carpetas</p>
          )}
          {filteredFolders.length === 0 && folderSearch && (
            <p className="text-[11px] text-muted-foreground/50 px-2.5 py-1 italic">Sin resultados</p>
          )}
          <div className="flex flex-col gap-0.5">
            {filteredFolders.map((folder) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                depth={0}
                activeCustomFolderId={activeCustomFolderId}
                onSelectLabel={onSelectLabel}
                onSelectFolder={onSelectFolder}
                expandedFolderIds={expandedFolderIds}
                toggleExpanded={toggleExpanded}
                searchActive={!!folderSearch.trim()}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mx-3 border-t border-border/40 shrink-0" />

      {/* Etiquetas section — takes remaining space */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between px-4 pt-2.5 pb-1 shrink-0">
          <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground/60">
            Etiquetas
          </p>
          <button
            onClick={() => setNewLabelOpen((v) => !v)}
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Nueva etiqueta"
          >
            {newLabelOpen ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {newLabelOpen && (
            <div className="mx-1 mb-2 p-2 rounded-md bg-muted/40 border border-border/40 space-y-2">
              <input
                autoFocus
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { void handleCreateLabel(); }
                  if (e.key === "Escape") { setNewLabelOpen(false); setNewLabelName(""); }
                }}
                placeholder="Nombre…"
                className="w-full h-6 px-2 text-[11.5px] bg-background border border-border/50 rounded outline-none focus:border-primary/40"
              />
              <div className="grid grid-cols-6 gap-1.5">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setNewLabelColor(c.key)}
                    title={c.key}
                    className={cn(
                      "w-4 h-4 rounded-full transition-transform",
                      newLabelColor === c.key && "scale-125 ring-2 ring-offset-1 ring-primary",
                    )}
                    style={{ background: c.dot }}
                  />
                ))}
              </div>
              <button
                onClick={() => { void handleCreateLabel(); }}
                disabled={!newLabelName.trim() || createLabel.isPending}
                className="w-full h-6 text-[11px] font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {createLabel.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Crear"}
              </button>
            </div>
          )}

          {userLabels.length === 0 && !newLabelOpen && (
            <p className="text-[11.5px] text-muted-foreground/50 px-2.5 py-1 italic">Sin etiquetas</p>
          )}

          <div className="flex flex-col gap-0.5">
            {userLabels.map((label) => {
              const style = getLabelStyle(label.color);
              const active = activeLabelId === label.id;
              return (
                <button
                  key={label.id}
                  onClick={() => onSelectLabel(active ? null : label.id)}
                  className={cn(
                    "flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-[12.5px] transition-colors text-left",
                    active
                      ? "bg-accent text-foreground font-semibold border-l-2 border-primary pl-[9px]"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: style.dot }} />
                  <span className="flex-1 truncate">{label.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Linked accounts — Outlook + Gmail */}
      {hasLinkedAccounts && (
        <>
          <div className="mx-3 border-t border-border/40 shrink-0" />
          <div className="overflow-y-auto pb-4 shrink-0">
            {outlookLinked.map(account => (
              <LinkedOutlookSection
                key={account.id}
                account={account}
                unreadCount={outlookUnreadMap[account.id] ?? 0}
                activeCustomFolderId={activeCustomFolderId}
                onSelectFolder={onSelectFolder}
              />
            ))}
            {gmailLinked.map(account => (
              <LinkedGmailSection
                key={account.id}
                account={account}
                unreadCount={gmailUnreadMap[account.id] ?? 0}
                activeCustomFolderId={activeCustomFolderId}
                onSelectFolder={onSelectFolder}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
