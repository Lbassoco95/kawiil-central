import { useState, useMemo, useEffect } from "react";
import { uploadFileToDropbox } from "@/lib/dropboxUpload";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useDocuments, useDeleteDocument } from "@/hooks/useDocuments";
import { DocumentFormDialog } from "@/components/documents/DocumentFormDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { DocumentPreviewDialog } from "@/components/documents/DocumentPreviewDialog";
import { formatMX } from "@/lib/dateUtils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Plus, Search, FileText, Link, ExternalLink, Trash2,
  Eye, Folder, FolderOpen, ChevronLeft, Image,
  FileSpreadsheet, File, FileCode, Loader2, HardDrive, Cloud,
  FolderPlus, Pencil
} from "lucide-react";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { documentsLimits } from "@/lib/fileIntake/limits";

// ─── File icon helper ─────────────────────────────────────────
function getFileIcon(name: string, source?: string) {
  if (source === "dropbox") return <Link className="h-4 w-4 text-blue-500" />;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext))
    return <Image className="h-4 w-4 text-emerald-500" />;
  if (["xls", "xlsx", "csv"].includes(ext))
    return <FileSpreadsheet className="h-4 w-4 text-green-600" />;
  if (["pdf"].includes(ext))
    return <FileText className="h-4 w-4 text-red-500" />;
  if (["xml", "json"].includes(ext))
    return <FileCode className="h-4 w-4 text-orange-500" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type BreadcrumbItem = { label: string; key: string };

// ─── Dropbox Live Browser ─────────────────────────────────────
interface DropboxEntry {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  size: number | null;
  modified: string | null;
}

function DropboxLiveBrowser() {
  const { user } = useAuth();
  const userName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Mi carpeta";

  const [personalFolderPath, setPersonalFolderPath] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DropboxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [linkLoading, setLinkLoading] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DropboxEntry | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // Picker state for when personal folder is not set yet
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [pickerEntries, setPickerEntries] = useState<DropboxEntry[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  // Load personal folder from profiles table on mount
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("profiles")
      .select("dropbox_personal_folder")
      .eq("user_id", user.id)
      .single()
      .then(({ data }: any) => {
        const saved = (data as any)?.dropbox_personal_folder || null;
        setPersonalFolderPath(saved);
        setProfileLoaded(true);
        // If no folder is saved, show the picker automatically
        if (!saved) {
          loadRootFoldersForPicker();
        }
      });
  }, [user?.id]);

  const loadRootFoldersForPicker = async () => {
    setShowFolderPicker(true);
    setPickerLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-browse", {
        body: { action: "list_personal_folders" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const allEntries: DropboxEntry[] = data.entries || [];
      setPickerEntries(
        allEntries
          .filter((e) => e.type === "folder" && e.name !== "Kawiil Mx")
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (e: any) {
      toast.error("Error al cargar carpetas: " + (e.message || "Error desconocido"));
    } finally {
      setPickerLoading(false);
    }
  };

  const selectPersonalFolder = async (entry: DropboxEntry) => {
    if (user?.id) {
      const { error } = await supabase
        .from("profiles")
        .update({ dropbox_personal_folder: entry.path } as any)
        .eq("user_id", user.id);

      if (error) {
        toast.error("No se pudo guardar tu carpeta personal");
        return;
      }
    }

    setPersonalFolderPath(entry.path);
    setShowFolderPicker(false);
    setPickerEntries([]);
    toast.success(`Carpeta personal configurada: ${entry.name}`);
    openFolder(entry.path);
  };

  const browse = async (path: string) => {
    if (!path || path.trim() === "" || path === "/") {
      toast.error("Ruta de carpeta inválida");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-browse", {
        body: { path, action: "list" },
      });
      if (error) {
        const errorMsg = data?.error || error.message || "";
        if (errorMsg.includes("path/not_found") || errorMsg.includes("not_found") || error.message?.includes("non-2xx")) {
          toast.info("No se encontró la carpeta. Selecciona tu carpeta personal de la lista.");
          goToRoot();
          loadRootFoldersForPicker();
          return;
        }
        throw error;
      }
      if (data?.error) {
        if (data.error.includes("path/not_found") || data.error.includes("not_found")) {
          toast.info("No se encontró la carpeta. Selecciona tu carpeta personal de la lista.");
          goToRoot();
          loadRootFoldersForPicker();
          return;
        }
        throw new Error(data.error);
      }
      setEntries(data.entries || []);
      setCurrentPath(data.resolved_path || path);
    } catch (e: any) {
      if (!e._handled) {
        toast.error("Error al navegar Dropbox: " + (e.message || "Error desconocido"));
        goToRoot();
      }
    } finally {
      setLoading(false);
    }
  };

  const openFolder = (path: string) => {
    setPathHistory((prev) => [...prev, currentPath || "ROOT"]);
    browse(path);
  };

  const goBack = () => {
    const prev = pathHistory[pathHistory.length - 1];
    setPathHistory((p) => p.slice(0, -1));
    if (!prev || prev === "ROOT") {
      setCurrentPath(null);
      setEntries([]);
    } else {
      browse(prev);
    }
  };

  const goToRoot = () => {
    setPathHistory([]);
    setCurrentPath(null);
    setEntries([]);
  };

  const openFileLink = async (entry: DropboxEntry) => {
    setLinkLoading(entry.id);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-browse", {
        body: { path: entry.path, action: "get_link" },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      if (data.url) window.open(data.url, "_blank");
    } catch (e: any) {
      toast.error("Error al obtener enlace: " + (e.message || "Error desconocido"));
    } finally {
      setLinkLoading(null);
    }
  };

  const uploadBatch = async (files: File[]) => {
    if (!currentPath || files.length === 0) return;
    setUploading(true);
    let ok = 0;
    let failed = 0;
    try {
      for (const file of files) {
        try {
          await uploadFileToDropbox(file, `${currentPath}/${file.name}`);
          ok += 1;
        } catch (err: any) {
          failed += 1;
          console.error("[Documentos] Dropbox upload fallo", file.name, err);
        }
      }
      if (ok > 0) toast.success(`${ok} archivo(s) subidos a Dropbox`);
      if (failed > 0) toast.error(`${failed} archivo(s) no se pudieron subir`);
      browse(currentPath);
    } finally {
      setUploading(false);
      setPendingFiles([]);
    }
  };

  const handleDropzoneChange = (next: File[]) => {
    if (next.length === 0) return;
    setPendingFiles(next);
    void uploadBatch(next);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !currentPath) return;
    setCreatingFolder(true);
    try {
      const folderPath = `${currentPath}/${newFolderName.trim()}`;
      const { data, error } = await supabase.functions.invoke("dropbox-browse", {
        body: { action: "create_folder", folder_path: folderPath },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      toast.success(`Carpeta "${newFolderName.trim()}" creada`);
      setCreateFolderOpen(false);
      setNewFolderName("");
      browse(currentPath);
    } catch (err: any) {
      toast.error("Error al crear carpeta: " + err.message);
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleRename = async () => {
    if (!renameName.trim() || !renameTarget) return;
    setRenaming(true);
    try {
      const parentPath = renameTarget.path.substring(0, renameTarget.path.lastIndexOf("/"));
      const toPath = `${parentPath}/${renameName.trim()}`;
      const { data, error } = await supabase.functions.invoke("dropbox-browse", {
        body: { action: "rename", from_path: renameTarget.path, to_path: toPath },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      toast.success(`Renombrado a "${renameName.trim()}"`);
      setRenameTarget(null);
      setRenameName("");
      if (currentPath) browse(currentPath);
    } catch (err: any) {
      toast.error("Error al renombrar: " + err.message);
    } finally {
      setRenaming(false);
    }
  };

  const folders = entries.filter((e) => e.type === "folder").sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter((e) => e.type === "file").sort((a, b) => a.name.localeCompare(b.name));

  const isRoot = currentPath === null;

  const displayPath = useMemo(() => {
    if (!currentPath) return null;
    if (!currentPath.startsWith("memberns:")) return currentPath;

    const scopedPath = currentPath.split(":").slice(2).join(":");
    return scopedPath || "/";
  }, [currentPath]);

  const breadcrumbs: string[] = [];
  if (displayPath && displayPath !== "/") {
    const parts = displayPath.split("/").filter(Boolean);
    breadcrumbs.push(...parts);
  }

  const personalLabel =
    personalFolderPath?.startsWith("memberns:") || personalFolderPath?.startsWith("id:")
      ? "Mi Dropbox"
      : personalFolderPath && !personalFolderPath.startsWith("id:")
        ? personalFolderPath.split("/").filter(Boolean).pop() || userName
        : userName;

  const displayFolderName = (name: string) =>
    name.startsWith("memberns:") || name.startsWith("id:") ? "Mi Dropbox" : name;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm min-w-0">
          {!isRoot && (
            <Button variant="ghost" size="sm" className="h-7 px-2 shrink-0" onClick={goBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
          <button
            onClick={goToRoot}
            className="text-muted-foreground hover:text-foreground hover:underline font-medium"
          >
            Dropbox
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-muted-foreground">/</span>
              <span className={i === breadcrumbs.length - 1 ? "font-medium text-foreground" : "text-muted-foreground"}>
                {crumb}
              </span>
            </span>
          ))}
        </div>
        {!isRoot && (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setCreateFolderOpen(true)}
            >
              <FolderPlus className="h-3 w-3" />
              Nueva carpeta
            </Button>
            <FileDropzone
              files={pendingFiles}
              onChange={handleDropzoneChange}
              limits={documentsLimits}
              variant="compact"
              disabled={uploading}
              showChips={false}
              buttonLabel={uploading ? "Subiendo..." : "Subir archivos (.zip se expande)"}
              className="w-auto"
            />
          </div>
        )}
      </div>

      {/* Folder Picker Dialog */}
      {showFolderPicker && (
        <Card className="border-dashed border-2 border-primary/30">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Selecciona tu carpeta personal</p>
                <p className="text-xs text-muted-foreground">No se encontró tu carpeta automáticamente. Elige la correcta de la lista.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowFolderPicker(false)}>
                Cancelar
              </Button>
            </div>
            <div className="border rounded-lg divide-y max-h-[300px] overflow-y-auto">
              {pickerLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : pickerEntries.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">No se encontraron carpetas</p>
              ) : (
                pickerEntries.map((entry) => (
                  <button
                    key={entry.id}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                    onClick={() => selectPersonalFolder(entry)}
                  >
                    <Folder className="h-5 w-5 text-amber-500 shrink-0" />
                    <span className="text-sm font-medium truncate">{entry.name}</span>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Content */}
      <div className="border rounded-lg divide-y">
        {isRoot ? (
          <>
            <button
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
              onClick={() => openFolder(personalFolderPath || `/${userName}`)}
            >
              <Folder className="h-5 w-5 text-amber-500 shrink-0" />
              <span className="text-sm font-medium truncate flex-1">{personalLabel}</span>
              <Badge variant="secondary" className="text-xs">Personal</Badge>
            </button>
            <button
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
              onClick={() => openFolder("/Kawiil Mx")}
            >
              <Folder className="h-5 w-5 text-primary shrink-0" />
              <span className="text-sm font-medium truncate flex-1">Kawiil Mx</span>
              <Badge variant="secondary" className="text-xs">Equipo</Badge>
            </button>
          </>
        ) : loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">Carpeta vacía</p>
        ) : (
          <>
            {folders.map((entry) => (
              <div
                key={entry.id}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left group"
              >
                <button
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  onClick={() => openFolder(entry.path)}
                >
                  <Folder className="h-5 w-5 text-primary shrink-0" />
                  <span className="text-sm font-medium truncate flex-1">{displayFolderName(entry.name)}</span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenameTarget(entry);
                    setRenameName(entry.name);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {files.map((entry) => (
              <button
                key={entry.id}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left group"
                onClick={() => openFileLink(entry)}
                disabled={linkLoading === entry.id}
              >
                <div className="shrink-0">{getFileIcon(entry.name)}</div>
                <span className="text-sm truncate flex-1">{entry.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(entry.size)}</span>
                {linkLoading === entry.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
                )}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Create Folder Dialog */}
      <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva carpeta</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Nombre de la carpeta"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFolderOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateFolder} disabled={creatingFolder || !newFolderName.trim()}>
              {creatingFolder ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renombrar carpeta</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Nuevo nombre"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancelar</Button>
            <Button onClick={handleRename} disabled={renaming || !renameName.trim()}>
              {renaming ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Renombrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Organized View (virtual folders from DB) ─────────────────
function OrganizedView({
  documents,
  isLoading,
  search,
  onFormOpen,
}: {
  documents: any[] | undefined;
  isLoading: boolean;
  search: string;
  onFormOpen: () => void;
}) {
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; source: string; file_path: string | null } | null>(null);
  const deleteDocument = useDeleteDocument();

  const { currentPath, currentDocs, currentSubfolders } = useMemo(() => {
    const docs = documents || [];
    const byClient = new Map<string, { name: string; id: string; docs: typeof docs }>();
    const unassigned: typeof docs = [];

    for (const doc of docs) {
      const clientId = doc.client_id;
      const clientName = (doc as any).clients?.name;
      if (clientId && clientName) {
        if (!byClient.has(clientId)) byClient.set(clientId, { name: clientName, id: clientId, docs: [] });
        byClient.get(clientId)!.docs.push(doc);
      } else {
        unassigned.push(doc);
      }
    }

    const clientFolders = [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name));
    let currentPath: BreadcrumbItem[] = [{ label: "Documentos", key: "root" }];
    let currentDocs: typeof docs = [];
    let currentSubfolders: { label: string; key: string; count: number }[] = [];

    if (!currentFolder) {
      currentSubfolders = clientFolders.map((c) => ({ label: c.name, key: `client:${c.id}`, count: c.docs.length }));
      if (unassigned.length > 0) currentSubfolders.push({ label: "Sin cliente", key: "unassigned", count: unassigned.length });
    } else if (currentFolder === "unassigned") {
      currentPath.push({ label: "Sin cliente", key: "unassigned" });
      currentDocs = unassigned;
    } else if (currentFolder.startsWith("client:") && !currentFolder.includes("/project:")) {
      const clientId = currentFolder.replace("client:", "");
      const client = byClient.get(clientId);
      if (client) {
        currentPath.push({ label: client.name, key: currentFolder });
        const byProject = new Map<string, { name: string; id: string; docs: typeof docs }>();
        const clientUnassigned: typeof docs = [];
        for (const doc of client.docs) {
          const projectId = doc.project_id;
          const projectName = (doc as any).projects?.name;
          if (projectId && projectName) {
            if (!byProject.has(projectId)) byProject.set(projectId, { name: projectName, id: projectId, docs: [] });
            byProject.get(projectId)!.docs.push(doc);
          } else {
            clientUnassigned.push(doc);
          }
        }
        currentSubfolders = [...byProject.values()].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({
          label: p.name, key: `${currentFolder}/project:${p.id}`, count: p.docs.length,
        }));
        currentDocs = clientUnassigned;
      }
    } else if (currentFolder.includes("/project:")) {
      const [clientPart, projectPart] = currentFolder.split("/project:");
      const clientId = clientPart.replace("client:", "");
      const client = byClient.get(clientId);
      if (client) {
        currentPath.push({ label: client.name, key: clientPart });
        const projectDocs = client.docs.filter((d) => d.project_id === projectPart);
        const projectName = (projectDocs[0] as any)?.projects?.name || "Proyecto";
        currentPath.push({ label: projectName, key: currentFolder });
        currentDocs = projectDocs;
      }
    }

    return { currentPath, currentDocs, currentSubfolders };
  }, [documents, currentFolder]);

  const goToFolder = (key: string | null) => setCurrentFolder(key === "root" ? null : key);
  const goBack = () => {
    if (!currentFolder) return;
    if (currentFolder.includes("/project:")) setCurrentFolder(currentFolder.split("/project:")[0]);
    else setCurrentFolder(null);
  };

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Cargando...</div>;

  if (!documents || documents.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center py-12">
            <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium text-foreground">Sin documentos aún</h3>
            <p className="mt-1 text-sm text-muted-foreground">Sube un archivo o pega un enlace de Dropbox.</p>
            <Button className="mt-4" onClick={onFormOpen}><Plus className="mr-2 h-4 w-4" />Nuevo documento</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Breadcrumbs */}
      {!search && (
        <div className="flex items-center gap-1 text-sm mb-4">
          {currentFolder && (
            <Button variant="ghost" size="sm" className="h-7 px-2 mr-1" onClick={goBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          {currentPath.map((crumb, i) => (
            <span key={crumb.key} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground">/</span>}
              <button
                onClick={() => goToFolder(crumb.key)}
                className={`hover:underline ${i === currentPath.length - 1 ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {i === 0 && <FolderOpen className="h-3.5 w-3.5 inline mr-1" />}
                {crumb.label}
              </button>
            </span>
          ))}
        </div>
      )}

      {search ? (
        <div className="border rounded-lg divide-y">
          {documents.map((doc) => (
            <FileRow key={doc.id} doc={doc} onPreview={() => setPreviewDoc(doc)}
              onDelete={() => setDeleteTarget({ id: doc.id, source: doc.source, file_path: doc.file_path })} />
          ))}
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {currentSubfolders.length === 0 && currentDocs.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">Carpeta vacía</p>
          )}
          {currentSubfolders.map((folder) => (
            <button key={folder.key} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
              onClick={() => goToFolder(folder.key)}>
              <Folder className="h-5 w-5 text-primary shrink-0" />
              <span className="text-sm font-medium truncate flex-1">{folder.label}</span>
              <Badge variant="secondary" className="text-xs shrink-0">{folder.count} {folder.count === 1 ? "doc" : "docs"}</Badge>
            </button>
          ))}
          {currentDocs.map((doc) => (
            <FileRow key={doc.id} doc={doc} onPreview={() => setPreviewDoc(doc)}
              onDelete={() => setDeleteTarget({ id: doc.id, source: doc.source, file_path: doc.file_path })} />
          ))}
        </div>
      )}

      <DeleteConfirmDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={() => { if (deleteTarget) { deleteDocument.mutate(deleteTarget); setDeleteTarget(null); } }}
        title="Eliminar documento" description="¿Estás seguro de que deseas eliminar este documento? Esta acción no se puede deshacer." />

      <DocumentPreviewDialog open={!!previewDoc} onOpenChange={(o) => { if (!o) setPreviewDoc(null); }} document={previewDoc} />
    </>
  );
}

// ─── File row component ───────────────────────────────────────
function FileRow({ doc, onPreview, onDelete }: { doc: any; onPreview: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/30 hover:shadow-sm transition-all duration-150 cursor-pointer group rounded-lg" onClick={onPreview}>
      <div className="shrink-0">{getFileIcon(doc.name, doc.source)}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-foreground">{doc.name}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          {doc.document_type && <span>{doc.document_type}</span>}
          <span>{formatMX(doc.created_at, "dd MMM yyyy")}</span>
          {doc.file_size ? <span>{formatFileSize(doc.file_size)}</span> : null}
          {doc.uploader_profile && <span>{doc.uploader_profile.full_name}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"
          onClick={(e) => { e.stopPropagation(); onPreview(); }}>
          <Eye className="h-4 w-4" />
        </Button>
        {doc.source === "dropbox" && doc.external_path && (
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"
            onClick={(e) => { e.stopPropagation(); window.open(doc.external_path, "_blank"); }}>
            <ExternalLink className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────
const Documentos = () => {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"dropbox" | "organized">("dropbox");

  const { data: documents, isLoading } = useDocuments({ search, source: sourceFilter });

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title="Documentos"
          description={
            viewMode === "dropbox"
              ? "Explorador de archivos en Dropbox"
              : "Documentos registrados en la aplicación"
          }
          icon={<FileText className="h-6 w-6" />}
          actions={
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Nuevo documento
            </Button>
          }
        />

        {/* View toggle + filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1.5">
            {[
              { key: "dropbox" as const, label: "Dropbox", icon: Cloud },
              { key: "organized" as const, label: "Aplicación", icon: HardDrive },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setViewMode(t.key)}
                className={`tab-pill inline-flex items-center gap-1.5 ${
                  viewMode === t.key ? "tab-pill-active" : "tab-pill-inactive"
                }`}
              >
                <t.icon className="h-3 w-3" />
                {t.label}
              </button>
            ))}
          </div>

          {viewMode === "organized" && (
            <>
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar documentos..." className="pl-9 h-9 text-sm bg-secondary/30 border-0 focus-visible:ring-1" value={search}
                  onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-[140px] h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="supabase">Archivos subidos</SelectItem>
                  <SelectItem value="dropbox">Enlaces Dropbox</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
        </div>

        <div className="glass-card overflow-hidden rounded-2xl p-4 sm:p-5 border-border/50">
          {viewMode === "dropbox" ? (
            <DropboxLiveBrowser />
          ) : (
            <OrganizedView documents={documents} isLoading={isLoading} search={search} onFormOpen={() => setFormOpen(true)} />
          )}
        </div>
      </div>

      <DocumentFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </AppLayout>
  );
};

export default Documentos;
