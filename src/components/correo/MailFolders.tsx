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
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useMailFolders,
  useUnreadEmailCount,
  useCreateMailFolder,
} from "@/hooks/useMicrosoft";

// ─── Tipos ────────────────────────────────────────────────────
type RawFolder = {
  id: string;
  displayName: string;
  wellKnownFolderName?: string;
  wellKnownName?: string;
  parentFolderId?: string;
  unreadItemCount?: number;
  totalItemCount?: number;
  childFolderCount?: number;
};

// ─── Iconos ───────────────────────────────────────────────────
const WK_ICONS: Record<string, React.ElementType> = {
  inbox:        Inbox,
  sentitems:    Send,
  deleteditems: Trash2,
  drafts:       FileText,
  archive:      Archive,
  junkemail:    AlertCircle,
  starred:      Star,
  outbox:       Send,
};

function folderIcon(folder: RawFolder): React.ElementType {
  const wk = String(folder.wellKnownFolderName || folder.wellKnownName || "").toLowerCase();
  const nameKey = (folder.displayName || "").toLowerCase().replace(/\s/g, "");
  const key = wk ||
    (nameKey.includes("bandejadeentrada") || nameKey.includes("inbox") ? "inbox" :
     nameKey.includes("enviado") || nameKey.includes("sent") ? "sentitems" :
     nameKey.includes("eliminad") || nameKey.includes("trash") || nameKey.includes("deleted") ? "deleteditems" :
     nameKey.includes("borrador") || nameKey.includes("draft") ? "drafts" :
     nameKey.includes("archiv") ? "archive" :
     nameKey.includes("spam") || nameKey.includes("junk") ? "junkemail" : "");
  return WK_ICONS[key] ?? FolderOpen;
}

// ─── Nombre localizado ────────────────────────────────────────
function getFolderLabel(displayName: string): string {
  const key = displayName.toLowerCase().replace(/\s/g, "");
  if (key.includes("inbox") || key.includes("bandejadeentrada")) return "Bandeja de entrada";
  if (key.includes("sentitem") || key.includes("elementosenviados")) return "Enviados";
  if (key.includes("deleteditem") || key.includes("elementoseliminados")) return "Eliminados";
  if (key.includes("draft") || key.includes("borrador")) return "Borradores";
  if (key.includes("junkemail") || key.includes("correonodeseado")) return "Spam";
  if (key.includes("archiv")) return "Archivo";
  return displayName;
}

// ─── Badge (contador) ────────────────────────────────────────
function getFolderBadge(folder: RawFolder, inboxUnread: number): number | null {
  const wk = String(folder.wellKnownFolderName || folder.wellKnownName || "").toLowerCase();
  const nameKey = (folder.displayName || "").toLowerCase().replace(/\s/g, "");
  const isInbox = wk === "inbox" || nameKey.includes("inbox") || nameKey.includes("bandejadeentrada");
  if (isInbox) return inboxUnread > 0 ? inboxUnread : null;
  const isDrafts = wk === "drafts" || nameKey.includes("draft") || nameKey.includes("borrador");
  if (isDrafts) { const t = folder.totalItemCount ?? 0; return t > 0 ? t : null; }
  const isJunk = wk === "junkemail" || nameKey.includes("junk") || nameKey.includes("spam");
  if (isJunk) { const u = folder.unreadItemCount ?? 0; return u > 0 ? u : null; }
  const unread = folder.unreadItemCount ?? 0;
  return unread > 0 ? unread : null;
}

// ─── Orden well-known ─────────────────────────────────────────
const WK_ORDER = ["inbox", "sentitems", "drafts", "deleteditems", "junkemail"];

function wellKnownSortIndex(f: RawFolder): number | null {
  const wk = String(f.wellKnownFolderName || f.wellKnownName || "").toLowerCase();
  const idx = WK_ORDER.indexOf(wk);
  if (idx >= 0) return idx;
  const key = (f.displayName || "").toLowerCase().replace(/\s/g, "");
  if (key.includes("inbox") || key.includes("bandejadeentrada")) return 0;
  if (key.includes("enviado") || key.includes("sentitem")) return 1;
  if (key.includes("borrador") || key.includes("draft")) return 2;
  if (key.includes("eliminad") || key.includes("deleted")) return 3;
  if (key.includes("junk") || key.includes("spam")) return 4;
  return null;
}

function sortFolders(rows: RawFolder[]): RawFolder[] {
  return [...rows].sort((a, b) => {
    const ia = wellKnownSortIndex(a);
    const ib = wellKnownSortIndex(b);
    if (ia != null && ib != null && ia !== ib) return ia - ib;
    if (ia != null && ib == null) return -1;
    if (ia == null && ib != null) return 1;
    return (a.displayName || "").localeCompare(b.displayName || "", "es", { sensitivity: "base" });
  });
}

// ─── Construir árbol desde lista plana ────────────────────────
function buildTree(folders: RawFolder[]): {
  roots: RawFolder[];
  childrenMap: Map<string, RawFolder[]>;
} {
  const byId = new Map<string, RawFolder>();
  for (const f of folders) byId.set(f.id, f);

  const childrenMap = new Map<string, RawFolder[]>();
  const roots: RawFolder[] = [];

  for (const f of folders) {
    const pid = f.parentFolderId;
    if (pid && byId.has(pid)) {
      const arr = childrenMap.get(pid) ?? [];
      arr.push(f);
      childrenMap.set(pid, arr);
    } else {
      roots.push(f);
    }
  }

  // Edge case: sin raíces pero hay filas → lista plana
  if (roots.length === 0 && folders.length > 0) {
    return { roots: sortFolders(folders), childrenMap: new Map() };
  }

  // Ordenar cada nivel
  const sortedRoots = sortFolders(roots);
  for (const [k, arr] of childrenMap.entries()) {
    childrenMap.set(k, sortFolders(arr));
  }
  return { roots: sortedRoots, childrenMap };
}

// ─── Fila recursiva de carpeta ────────────────────────────────
function FolderRow({
  folder,
  childrenMap,
  selectedFolderId,
  onSelectFolder,
  inboxUnread,
  depth = 0,
}: {
  folder: RawFolder;
  childrenMap: Map<string, RawFolder[]>;
  selectedFolderId: string;
  onSelectFolder: (id: string, name: string) => void;
  inboxUnread: number;
  depth?: number;
}) {
  const children = childrenMap.get(folder.id) ?? [];
  const hasChildren = children.length > 0;
  // Expandir automáticamente el primer nivel
  const [expanded, setExpanded] = useState(depth === 0 && hasChildren);
  const Icon = folderIcon(folder);
  const isActive = selectedFolderId === folder.id;
  const badge = getFolderBadge(folder, inboxUnread);
  const label = getFolderLabel(folder.displayName);

  return (
    <>
      <button
        className={[
          "mail-folder",
          isActive ? "active" : "",
          badge ? "unread" : "",
        ].filter(Boolean).join(" ")}
        style={depth > 0 ? { paddingLeft: `${10 + depth * 14}px` } : undefined}
        onClick={() => onSelectFolder(folder.id, folder.displayName)}
      >
        {/* Chevron expandir */}
        {hasChildren ? (
          <span
            style={{ marginLeft: -4, marginRight: 2, display: "flex", cursor: "pointer", opacity: 0.55 }}
            onClick={(e) => { e.stopPropagation(); setExpanded((p) => !p); }}
          >
            {expanded
              ? <ChevronDown size={11} />
              : <ChevronRight size={11} />}
          </span>
        ) : (
          <span style={{ width: 11, marginLeft: -4, marginRight: 2, flexShrink: 0 }} />
        )}

        <Icon size={14} className="ico" />
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        {badge != null && (
          <span className="count">{badge > 99 ? "99+" : badge}</span>
        )}
      </button>

      {expanded && children.map((child) => (
        <FolderRow
          key={child.id}
          folder={child}
          childrenMap={childrenMap}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          inboxUnread={inboxUnread}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

// ─── Componente principal ────────────────────────────────────
interface Props {
  selectedFolderId: string;
  onSelectFolder: (id: string, name: string) => void;
  onCompose: () => void;
}

export function MailFolders({ selectedFolderId, onSelectFolder, onCompose }: Props) {
  const { data: foldersData, isLoading } = useMailFolders();
  const { data: unreadData }             = useUnreadEmailCount();
  const createFolderMut                  = useCreateMailFolder();
  const queryClient                      = useQueryClient();

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isRefreshing,  setIsRefreshing]  = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showNewFolder) inputRef.current?.focus();
  }, [showNewFolder]);

  const inboxUnread =
    typeof unreadData === "number" ? unreadData : 0;

  // Construir árbol desde lista plana
  const { roots, childrenMap } = useMemo(() => {
    const raw = (foldersData?.folders ?? []) as RawFolder[];
    return buildTree(raw);
  }, [foldersData]);

  // Separar carpetas del buzón (well-known) de las personalizadas
  const { wellKnownRoots, customRoots } = useMemo(() => {
    const wellKnownRoots: RawFolder[] = [];
    const customRoots: RawFolder[] = [];
    for (const f of roots) {
      const wk = String(f.wellKnownFolderName || f.wellKnownName || "").toLowerCase();
      const nameKey = (f.displayName || "").toLowerCase().replace(/\s/g, "");
      const isWellKnown =
        wk.length > 0 ||
        nameKey.includes("inbox") || nameKey.includes("bandejadeentrada") ||
        nameKey.includes("enviado") || nameKey.includes("sentitem") ||
        nameKey.includes("eliminad") || nameKey.includes("deleted") ||
        nameKey.includes("borrador") || nameKey.includes("draft") ||
        nameKey.includes("junkemail") || nameKey.includes("spam") ||
        nameKey.includes("archiv") || nameKey.includes("correonodeseado") ||
        nameKey.includes("bandejadesalida") || nameKey.includes("outbox");
      if (isWellKnown) {
        wellKnownRoots.push(f);
      } else {
        customRoots.push(f);
      }
    }
    return { wellKnownRoots, customRoots };
  }, [roots]);

  const handleCreate = () => {
    const name = newFolderName.trim();
    if (!name) return;
    createFolderMut.mutate(name, {
      onSuccess: () => { setNewFolderName(""); setShowNewFolder(false); },
    });
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["mail-folders"] });
    setIsRefreshing(false);
  };

  const isTruncated = !!foldersData?.meta?.truncated;

  return (
    <aside className="mail-folders">
      {/* Nuevo correo */}
      <button className="mail-compose-btn" onClick={onCompose}>
        <Edit3 size={15} /> Nuevo correo
      </button>

      {/* Sección Buzón — carpetas del sistema */}
      <div className="mail-folder-group">BUZÓN</div>

      {isLoading && (
        <div style={{ padding: "10px 12px", fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
          Sincronizando…
        </div>
      )}

      {wellKnownRoots.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          childrenMap={childrenMap}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          inboxUnread={inboxUnread}
          depth={0}
        />
      ))}

      {/* Sección Mis carpetas — carpetas personalizadas */}
      <div className="mail-folder-group" style={{ marginTop: 10 }}>
        MIS CARPETAS
        <div style={{ display: "flex", alignItems: "center", gap: 2, marginLeft: "auto" }}>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            style={{ background: "transparent", border: 0, cursor: "pointer", color: "hsl(var(--muted-foreground))", padding: "2px 4px", borderRadius: 4, display: "flex", alignItems: "center" }}
            title="Actualizar carpetas"
          >
            <RefreshCw size={11} style={{ animation: isRefreshing ? "spin 1s linear infinite" : undefined }} />
          </button>
          <button
            onClick={() => setShowNewFolder((p) => !p)}
            style={{ background: "transparent", border: 0, cursor: "pointer", color: "hsl(var(--muted-foreground))", padding: "2px 4px", borderRadius: 4 }}
            title="Nueva carpeta"
          >
            <Plus size={11} />
          </button>
        </div>
      </div>

      {/* Aviso de truncado */}
      {isTruncated && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 6,
          padding: "6px 10px", background: "hsl(38 92% 50% / 0.08)",
          borderRadius: 8, margin: "2px 4px",
          border: "1px solid hsl(38 92% 50% / 0.25)",
          fontSize: 11, color: "hsl(38 60% 35%)",
          lineHeight: 1.4,
        }}>
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1, color: "hsl(38 92% 45%)" }} />
          <span>Algunas carpetas no se cargaron. Usa <strong>Actualizar</strong> para reintentar.</span>
        </div>
      )}

      {/* Carpetas personalizadas */}
      {customRoots.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          childrenMap={childrenMap}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          inboxUnread={inboxUnread}
          depth={0}
        />
      ))}

      {/* Mini-form crear carpeta */}
      {showNewFolder && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 10px", background: "hsl(var(--primary) / 0.05)",
          borderRadius: 8, margin: "2px 4px",
          border: "1px solid hsl(var(--primary) / 0.2)",
        }}>
          <Folder size={13} style={{ color: "hsl(var(--primary))", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Nombre de carpeta"
            style={{
              flex: 1, border: 0, background: "transparent",
              fontSize: 12, color: "hsl(var(--foreground))", fontFamily: "inherit", minWidth: 0,
            }}
          />
          <button
            onClick={handleCreate}
            disabled={!newFolderName.trim() || createFolderMut.isPending}
            title="Crear carpeta"
            style={{
              background: "hsl(var(--primary))", border: 0, borderRadius: 5,
              width: 22, height: 22, display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer", color: "#fff", flexShrink: 0,
            }}
          >
            <Check size={12} />
          </button>
          <button
            onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}
            title="Cancelar"
            style={{ background: "transparent", border: 0, cursor: "pointer", color: "hsl(var(--muted-foreground))", padding: 2 }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Atajo si no hay carpetas personalizadas aún */}
      {!showNewFolder && customRoots.length === 0 && !isLoading && (
        <button className="mail-folder" onClick={() => setShowNewFolder(true)} style={{ opacity: 0.6 }}>
          <Plus size={13} className="ico" /> Nueva carpeta…
        </button>
      )}
    </aside>
  );
}
