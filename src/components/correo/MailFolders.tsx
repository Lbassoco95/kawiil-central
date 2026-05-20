import { useMemo } from "react";
import {
  Inbox,
  Send,
  Archive,
  Trash2,
  Star,
  AlertCircle,
  FolderOpen,
  FileText,
  Plus,
  ChevronRight,
  Edit3,
} from "lucide-react";
import {
  useMailFolders,
  useUnreadEmailCount,
} from "@/hooks/useMicrosoft";

// ─── Mapeo de carpetas bien conocidas a iconos ──────────────────
const FOLDER_ICONS: Record<string, React.ElementType> = {
  inbox:          Inbox,
  sentitems:      Send,
  deleteditems:   Trash2,
  drafts:         FileText,
  archive:        Archive,
  junkemail:      AlertCircle,
  starred:        Star,
  outbox:         Send,
};

function folderIcon(wellKnownName?: string, displayName?: string) {
  const key = (wellKnownName || displayName || "").toLowerCase().replace(/\s/g, "");
  return FOLDER_ICONS[key] ?? FolderOpen;
}

const FOLDER_ORDER: Record<string, number> = {
  inbox: 0,
  starred: 1,
  drafts: 2,
  sentitems: 3,
  archive: 4,
  junkemail: 5,
  deleteditems: 6,
};

interface Props {
  selectedFolderId: string;
  onSelectFolder: (id: string) => void;
  onCompose: () => void;
}

export function MailFolders({ selectedFolderId, onSelectFolder, onCompose }: Props) {
  const { data: foldersData, isLoading } = useMailFolders();
  const { data: unreadData } = useUnreadEmailCount();

  const folders = useMemo(() => {
    const raw = (foldersData?.folders ?? []) as Array<{
      id: string;
      displayName: string;
      wellKnownName?: string;
      unreadItemCount?: number;
      totalItemCount?: number;
      childFolderCount?: number;
      childFolders?: Array<{ id: string; displayName: string; wellKnownName?: string; unreadItemCount?: number }>;
    }>;

    const sorted = [...raw].sort((a, b) => {
      const oa = FOLDER_ORDER[a.wellKnownName?.toLowerCase() ?? ""] ?? 99;
      const ob = FOLDER_ORDER[b.wellKnownName?.toLowerCase() ?? ""] ?? 99;
      return oa - ob || a.displayName.localeCompare(b.displayName, "es");
    });

    return sorted;
  }, [foldersData]);

  const inboxUnread =
    typeof unreadData === "number"
      ? unreadData
      : (folders.find((f) => f.wellKnownName?.toLowerCase() === "inbox")?.unreadItemCount ?? 0);

  return (
    <aside className="mail-folders">
      <button className="mail-compose-btn" onClick={onCompose}>
        <Edit3 size={15} />
        Nuevo correo
      </button>

      <div className="mail-folder-group">
        Buzón
        <ChevronRight size={12} className="chevr" />
      </div>

      {isLoading && (
        <div style={{ padding: "12px 10px", fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
          Cargando carpetas…
        </div>
      )}

      {folders.map((folder) => {
        const Icon = folderIcon(folder.wellKnownName, folder.displayName);
        const isInbox = folder.wellKnownName?.toLowerCase() === "inbox";
        const unread = isInbox ? inboxUnread : (folder.unreadItemCount ?? 0);
        const isActive = selectedFolderId === folder.id ||
          (selectedFolderId === "inbox" && isInbox);

        return (
          <button
            key={folder.id}
            className={[
              "mail-folder",
              isActive ? "active" : "",
              unread > 0 ? "unread" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => onSelectFolder(folder.id)}
          >
            <Icon size={15} className="ico" />
            <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {folder.displayName}
            </span>
            {unread > 0 && (
              <span className="count">{unread > 99 ? "99+" : unread}</span>
            )}
          </button>
        );
      })}

      {folders.length > 0 && (
        <>
          <div className="mail-folder-group" style={{ marginTop: 8 }}>
            Otras carpetas
            <ChevronRight size={12} className="chevr" />
          </div>

          <button
            className="mail-folder"
            onClick={() => {}}
            style={{ opacity: 0.65 }}
          >
            <Plus size={15} className="ico" />
            Nueva carpeta
          </button>
        </>
      )}
    </aside>
  );
}
