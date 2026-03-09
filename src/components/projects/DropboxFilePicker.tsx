import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Folder,
  FileText,
  ChevronLeft,
  Loader2,
  Check,
} from "lucide-react";

interface DropboxEntry {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  size: number | null;
  modified: string | null;
}

interface DropboxFilePickerProps {
  open: boolean;
  onClose: () => void;
  initialPath?: string;
  lockToInitialPath?: boolean;
  onSelect: (file: { name: string; url: string }) => void;
}

export function DropboxFilePicker({
  open,
  onClose,
  initialPath,
  lockToInitialPath = false,
  onSelect,
}: DropboxFilePickerProps) {
  const basePath = useMemo(() => (initialPath ?? "").trim(), [initialPath]);

  const [currentPath, setCurrentPath] = useState(basePath);
  const [entries, setEntries] = useState<DropboxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkLoading, setLinkLoading] = useState<string | null>(null);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const browse = async (path: string) => {
    const targetPath = lockToInitialPath && basePath
      ? path && path.startsWith(basePath)
        ? path
        : basePath
      : path || basePath;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-browse", {
        body: { path: targetPath, action: "list" },
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
      setCurrentPath(data.resolved_path || targetPath);
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
    browse(basePath);
  };

  const openFolder = (path: string) => {
    if (lockToInitialPath && basePath && !path.startsWith(basePath)) return;
    setPathHistory((prev) => [...prev, currentPath]);
    browse(path);
  };

  const goBack = () => {
    if (lockToInitialPath && currentPath === basePath) return;

    const prev = pathHistory[pathHistory.length - 1] ?? "";
    setPathHistory((p) => p.slice(0, -1));

    const safePrev = lockToInitialPath && basePath && prev && !prev.startsWith(basePath)
      ? basePath
      : prev;

    browse(safePrev);
  };

  const selectFile = async (entry: DropboxEntry) => {
    setLinkLoading(entry.id);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-browse", {
        body: { path: entry.path, action: "get_link" },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      onSelect({ name: entry.name, url: data.url });
      onClose();
    } catch (e: any) {
      toast.error("Error al obtener link: " + (e.message || "Error desconocido"));
    } finally {
      setLinkLoading(null);
    }
  };

  const folders = entries.filter((e) => e.type === "folder").sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter((e) => e.type === "file").sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
        else handleOpen();
      }}
    >
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col" aria-describedby={undefined}>
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <DialogTitle className="flex items-center gap-2">
            <Folder className="h-5 w-5" />
            Seleccionar archivo de Dropbox
          </DialogTitle>
          <DialogDescription>
            Explorando: {basePath || "/ (Raíz)"}
          </DialogDescription>
        </div>

        {/* Path breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground border-b pb-2">
          {currentPath && (!lockToInitialPath || currentPath !== basePath) && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={goBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <span className="truncate">{currentPath || basePath || "/ (Raíz)"}</span>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto min-h-[200px] space-y-0.5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !loaded ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <p className="text-sm text-muted-foreground">Haz clic para cargar los archivos</p>
              <Button onClick={() => browse(basePath)}>Cargar archivos</Button>
            </div>
          ) : entries.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">Carpeta vacía</p>
          ) : (
            <>
              {folders.map((entry) => (
                <button
                  key={entry.id}
                  className="w-full flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => openFolder(entry.path)}
                >
                  <Folder className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm truncate">{entry.name}</span>
                </button>
              ))}
              {files.map((entry) => (
                <button
                  key={entry.id}
                  className="w-full flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/50 transition-colors text-left group"
                  onClick={() => selectFile(entry)}
                  disabled={linkLoading === entry.id}
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm truncate flex-1">{entry.name}</span>
                  {linkLoading === entry.id ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  ) : (
                    <Check className="h-4 w-4 opacity-0 group-hover:opacity-100 text-primary shrink-0 transition-opacity" />
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
