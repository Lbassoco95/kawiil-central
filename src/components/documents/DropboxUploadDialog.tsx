import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { uploadFileToDropbox } from "@/lib/dropboxUpload";
import { KAWIIL_TEAM_ROOT } from "@/lib/dropboxConfig";
import { toast } from "sonner";
import {
  Folder,
  ChevronLeft,
  Loader2,
  Upload,
  FileText,
  FolderPlus,
} from "lucide-react";

interface DropboxEntry {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  size: number | null;
  modified: string | null;
}

interface DropboxUploadDialogProps {
  open: boolean;
  onClose: () => void;
  file: File | null;
  initialPath?: string;
  onUploaded: (result: { name: string; path: string; url: string }) => void;
}

export function DropboxUploadDialog({
  open,
  onClose,
  file,
  initialPath,
  onUploaded,
}: DropboxUploadDialogProps) {
  const basePath = useMemo(() => (initialPath ?? KAWIIL_TEAM_ROOT).trim(), [initialPath]);

  const [currentPath, setCurrentPath] = useState(basePath);
  const [entries, setEntries] = useState<DropboxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  useEffect(() => {
    if (open && !loaded && !loading) {
      handleOpen();
    }
  }, [open]);

  const browse = async (path: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-browse", {
        body: { path: path || basePath, action: "list" },
      });
      if (error) {
        const msg = data?.error || error.message || "Error desconocido";
        if (msg.includes("path/not_found") || msg.includes("not_found")) {
          toast.error("Carpeta no encontrada en Dropbox. Verifica que exista la ruta.");
        } else {
          toast.error("Error al navegar Dropbox: " + msg);
        }
        return;
      }
      if (data.error) throw new Error(data.error);
      setEntries(data.entries || []);
      setCurrentPath(data.resolved_path || path);
      setLoaded(true);
    } catch (e: any) {
      toast.error("Error al navegar Dropbox: " + (e.message || "Error desconocido"));
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    setPathHistory([]);
    setEntries([]);
    setLoaded(false);
    setCurrentPath(basePath);
    setShowNewFolder(false);
    setNewFolderName("");
    browse(basePath);
  };

  const openFolder = (path: string) => {
    setPathHistory((prev) => [...prev, currentPath]);
    browse(path);
  };

  const goBack = () => {
    const prev = pathHistory[pathHistory.length - 1] ?? basePath;
    setPathHistory((p) => p.slice(0, -1));
    browse(prev);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      const folderPath = `${currentPath}/${newFolderName.trim()}`;
      const { data, error } = await supabase.functions.invoke("dropbox-browse", {
        body: { action: "create_folder", folder_path: folderPath },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      toast.success(`Carpeta "${newFolderName.trim()}" creada`);
      setNewFolderName("");
      setShowNewFolder(false);
      // Navigate into the new folder
      setPathHistory((prev) => [...prev, currentPath]);
      browse(data.path || folderPath);
    } catch (e: any) {
      toast.error("Error al crear carpeta: " + (e.message || "Error desconocido"));
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const uploadPath = `${currentPath}/${file.name}`;
      const result = await uploadFileToDropbox(file, uploadPath);

      onUploaded({
        name: result.name,
        path: result.path,
        url: result.url,
      });
      toast.success(`"${file.name}" subido a Dropbox`);
    } catch (e: any) {
      toast.error("Error al subir: " + (e.message || "Error desconocido"));
    } finally {
      setUploading(false);
    }
  };

  const folders = entries
    .filter((e) => e.type === "folder")
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
        else handleOpen();
      }}
    >
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Subir archivo a Dropbox
          </DialogTitle>
          <DialogDescription>
            Selecciona la carpeta destino para el archivo
          </DialogDescription>
        </div>

        {/* Selected file */}
        {file && (
          <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50 border text-sm">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="truncate font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
            </div>
          </div>
        )}

        {/* Path breadcrumb + new folder */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground border-b pb-2">
          {pathHistory.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={goBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <Folder className="h-4 w-4 shrink-0" />
          <span className="truncate flex-1">{currentPath || "/"}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 shrink-0"
            onClick={() => setShowNewFolder(!showNewFolder)}
            disabled={loading || !loaded}
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>

        {/* New folder input */}
        {showNewFolder && (
          <div className="flex items-center gap-2">
            <Input
              placeholder="Nombre de la nueva carpeta..."
              className="h-8 text-xs"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              autoFocus
            />
            <Button
              size="sm"
              className="h-8 text-xs shrink-0"
              disabled={!newFolderName.trim() || creatingFolder}
              onClick={handleCreateFolder}
            >
              {creatingFolder ? <Loader2 className="h-3 w-3 animate-spin" /> : "Crear"}
            </Button>
          </div>
        )}

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto min-h-[150px] max-h-[300px] space-y-0.5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !loaded ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : folders.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              No hay subcarpetas. Puedes subir el archivo aquí.
            </p>
          ) : (
            folders.map((entry) => (
              <button
                key={entry.id}
                className="w-full flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/50 transition-colors text-left"
                onClick={() => openFolder(entry.path)}
              >
                <Folder className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm truncate">{entry.name}</span>
              </button>
            ))
          )}
        </div>

        {/* Upload button */}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose} disabled={uploading}>
            Cancelar
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!file || uploading || loading}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Subiendo...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Subir aquí
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
