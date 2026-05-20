import { useMemo, useState, useRef, useEffect } from "react";
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
  ChevronDown,
  Edit3,
  Check,
  X,
  Folder,
} from "lucide-react";
import {
  useMailFolders,
  useUnreadEmailCount,
  useCreateMailFolder,
} from "@/hooks/useMicrosoft";

// ─── Iconos por carpeta bien conocida ──────────────────────────
const FOLDER_ICONS: Record<string, React.ElementType> = {
  inbox:        Inbox,
  sentitems:    Send,
  deleteditems: Trash2,
  drafts:       FileText,
  archive:      Archive,
  junkemail:    AlertCircle,
  starred:      Star,
  outbox:       Send,
};

function folderIcon(wellKnownName?: string, displayName?: string) {
  const key = (wellKnownName || displayName || "").toLowerCase().replace(/\s/g, "");
  return FOLDER_ICONS[key] ?? FolderOpen;
}

const FOLDER_ORDER: Record<string, number> = {
  inbox: 0, starred: 1, drafts: 2, sentitems: 3,
  archive: 4, junkemail: 5, deleteditems: 6,
};

type FolderItem = {
  id: string;
  displayName: string;
  wellKnownName?: string;
  unreadItemCount?: number;
  totalItemCount?: number;
  childFolderCount?: number;
  childFolders?: FolderItem[];
};

interface Props {
  selectedFolderId: string;
  onSelectFolder: (id: string) => void;
  onCompose: () => void;
}

// ── Fila de carpeta (recursiva para subcarpetas) ──────────────
function FolderRow({
  folder,
  selectedFolderId,
  onSelectFolder,
  depth = 0,
}: {
  folder: FolderItem;
  selectedFolderId: string;
  onSelectFolder: (id: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = folderIcon(folder.wellKnownName, folder.displayName);
  const hasChildren = (folder.childFolders?.length ?? 0) > 0;
  const isActive = selectedFolderId === folder.id;
  const unread = folder.unreadItemCount ?? 0;

  return (
    <>
      <button
        className={[
          "mail-folder",
          isActive ? "active" : "",
          unread > 0 ? "unread" : "",
        ].filter(Boolean).join(" ")}
        style={{ paddingLeft: depth > 0 ? `${10 + depth * 14}px` : undefined }}
        onClick={() => onSelectFolder(folder.id)}
      >
        {/* Chevron para expandir subcarpetas */}
        {hasChildren && (
          <span
            style={{ marginLeft: -4, marginRight: 4, cursor: "pointer", opacity: 0.6 }}
            onClick={(e) => { e.stopPropagation(); setExpanded((p) => !p); }}
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        )}

        <Icon size={15} className="ico" />
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {folder.displayName}
        </span>
        {unread > 0 && (
          <span className="count">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>

      {/* Subcarpetas */}
      {expanded && hasChildren && folder.childFolders!.map((child) => (
        <FolderRow
          key={child.id}
          folder={child}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

// ── Componente principal ──────────────────────────────────────
export function MailFolders({ selectedFolderId, onSelectFolder, onCompose }: Props) {
  const { data: foldersData, isLoading }  = useMailFolders();
  const { data: unreadData }              = useUnreadEmailCount();
  const createFolderMut                  = useCreateMailFolder();

  // Estado del mini-form de nueva carpeta
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showNewFolder) newFolderInputRef.current?.focus();
  }, [showNewFolder]);

  const { wellKnown, custom } = useMemo(() => {
    const raw = (foldersData?.folders ?? []) as FolderItem[];
    const sorted = [...raw].sort((a, b) => {
      const oa = FOLDER_ORDER[a.wellKnownName?.toLowerCase() ?? ""] ?? 99;
      const ob = FOLDER_ORDER[b.wellKnownName?.toLowerCase() ?? ""] ?? 99;
      return oa - ob || a.displayName.localeCompare(b.displayName, "es");
    });
    return {
      wellKnown: sorted.filter((f) => f.wellKnownName),
      custom:    sorted.filter((f) => !f.wellKnownName),
    };
  }, [foldersData]);

  // Unread real del inbox
  const inboxUnread =
    typeof unreadData === "number"
      ? unreadData
      : (wellKnown.find((f) => f.wellKnownName?.toLowerCase() === "inbox")?.unreadItemCount ?? 0);

  // Inyectar unread real al inbox
  const wellKnownWithUnread = useMemo(() =>
    wellKnown.map((f) =>
      f.wellKnownName?.toLowerCase() === "inbox"
        ? { ...f, unreadItemCount: inboxUnread }
        : f
    ), [wellKnown, inboxUnread]);

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    createFolderMut.mutate(name, {
      onSuccess: () => {
        setNewFolderName("");
        setShowNewFolder(false);
      },
    });
  };

  const handleNewFolderKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCreateFolder();
    if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); }
  };

  return (
    <aside className="mail-folders">
      {/* Botón Nuevo correo */}
      <button className="mail-compose-btn" onClick={onCompose}>
        <Edit3 size={15} />
        Nuevo correo
      </button>

      {/* ── Sección: Buzón ── */}
      <div className="mail-folder-group">
        Buzón
      </div>

      {isLoading && (
        <div style={{ padding: "12px 10px", fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
          Cargando carpetas…
        </div>
      )}

      {wellKnownWithUnread.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
        />
      ))}

      {/* ── Sección: Mis carpetas ── */}
      <div className="mail-folder-group" style={{ marginTop: 10 }}>
        Mis carpetas
        <button
          onClick={() => setShowNewFolder((p) => !p)}
          style={{
            background: "transparent",
            border: 0,
            cursor: "pointer",
            color: "hsl(var(--muted-foreground))",
            padding: "2px 4px",
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
          }}
          title="Nueva carpeta"
        >
          <Plus size={11} />
        </button>
      </div>

      {/* Mini-formulario crear carpeta */}
      {showNewFolder && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          background: "hsl(var(--primary) / 0.05)",
          borderRadius: 8,
          margin: "2px 4px",
          border: "1px solid hsl(var(--primary) / 0.2)",
        }}>
          <Folder size={13} style={{ color: "hsl(var(--primary))", flexShrink: 0 }} />
          <input
            ref={newFolderInputRef}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={handleNewFolderKey}
            placeholder="Nombre de carpeta"
            style={{
              flex: 1,
              border: 0,
              background: "transparent",
              fontSize: 12,
              color: "hsl(var(--foreground))",
              fontFamily: "inherit",
              minWidth: 0,
            }}
          />
          <button
            onClick={handleCreateFolder}
            disabled={!newFolderName.trim() || createFolderMut.isPending}
            style={{
              background: "hsl(var(--primary))",
              border: 0,
              borderRadius: 5,
              width: 22,
              height: 22,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#fff",
              flexShrink: 0,
            }}
            title="Crear"
          >
            <Check size={12} />
          </button>
          <button
            onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}
            style={{
              background: "transparent",
              border: 0,
              cursor: "pointer",
              color: "hsl(var(--muted-foreground))",
              padding: 2,
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
            }}
            title="Cancelar"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Carpetas personalizadas */}
      {custom.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
        />
      ))}

      {custom.length === 0 && !showNewFolder && (
        <button
          className="mail-folder"
          onClick={() => setShowNewFolder(true)}
          style={{ opacity: 0.6, fontStyle: "italic" }}
        >
          <Plus size={13} className="ico" />
          Nueva carpeta…
        </button>
      )}
    </aside>
  );
}
