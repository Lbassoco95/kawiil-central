import { useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type MailTabId } from "./MailTabs";
import {
  useUnreadEmailCount,
  useMailFolders,
  useEmailUserLabels,
  useCreateEmailLabel,
} from "@/hooks/useMicrosoft";
import { getLabelStyle, LABEL_COLORS } from "./MailLabelPicker";

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

export function MailSidebar({
  activeTab,
  onSelectTab,
  onCompose,
  onSelectFolder,
  activeCustomFolderId,
  activeLabelId,
  onSelectLabel,
}: MailSidebarProps) {
  const { data: unreadCount = 0 } = useUnreadEmailCount();
  const { data: foldersData } = useMailFolders();
  const { data: userLabels = [] } = useEmailUserLabels();
  const createLabel = useCreateEmailLabel();

  const [newLabelOpen, setNewLabelOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("blue");

  const folders = (foldersData?.folders ?? []) as {
    id: string;
    displayName: string;
    wellKnownFolderName?: string;
    unreadItemCount?: number;
    childFolderCount?: number;
    parentFolderId?: string;
  }[];

  // Show top-level custom folders — exclude well-known system folders
  const WELL_KNOWN = new Set([
    "inbox", "drafts", "sentitems", "deleteditems", "junkemail",
    "outbox", "archive", "msgfolderroot", "recoverableitemsdeletions",
  ]);
  const customFolders = folders.filter(
    (f) => !f.wellKnownFolderName || !WELL_KNOWN.has(f.wellKnownFolderName.toLowerCase()),
  );

  const handleCreateLabel = async () => {
    if (!newLabelName.trim()) return;
    await createLabel.mutateAsync({ name: newLabelName.trim(), color: newLabelColor });
    setNewLabelName("");
    setNewLabelColor("blue");
    setNewLabelOpen(false);
  };

  const isTabActive = (id: MailTabId) => activeTab === id && !activeCustomFolderId && activeLabelId == null;

  return (
    <div className="w-[200px] shrink-0 bg-card border-r border-border/40 flex flex-col h-full overflow-y-auto">
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

      {/* Navigation items */}
      <nav className="flex flex-col gap-0.5 px-2 pb-2">
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

      {/* Separator */}
      <div className="mx-3 border-t border-border/40 shrink-0" />

      {/* Carpetas section */}
      <div className="px-2 pt-3 pb-2">
        <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground/60 px-2 mb-1">
          Carpetas
        </p>
        {customFolders.length === 0 && (
          <p className="text-[11.5px] text-muted-foreground/50 px-2.5 py-1 italic">Sin carpetas</p>
        )}
        <div className="flex flex-col gap-0.5">
          {customFolders.map((folder) => {
            const active = activeCustomFolderId === folder.id;
            return (
              <button
                key={folder.id}
                onClick={() => { onSelectLabel(null); onSelectFolder(folder.id, folder.displayName); }}
                className={cn(
                  "flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-[12.5px] transition-colors text-left",
                  active
                    ? "bg-accent text-foreground font-semibold border-l-2 border-primary pl-[9px]"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Folder className={cn("w-[15px] h-[15px] shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                <span className="flex-1 truncate">{folder.displayName}</span>
                {(folder.unreadItemCount ?? 0) > 0 && (
                  <span className="text-[10.5px] font-medium text-muted-foreground shrink-0">
                    {folder.unreadItemCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Separator */}
      <div className="mx-3 border-t border-border/40 shrink-0" />

      {/* Etiquetas section */}
      <div className="px-2 pt-3 pb-4 flex-1">
        <div className="flex items-center justify-between px-2 mb-1">
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
            <div className="flex gap-1">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setNewLabelColor(c.key)}
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
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: style.dot }}
                />
                <span className="flex-1 truncate">{label.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
