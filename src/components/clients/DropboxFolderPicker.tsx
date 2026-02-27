import { useState } from "react";
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
  ChevronLeft,
  Loader2,
  Check,
} from "lucide-react";

interface DropboxEntry {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
}

interface DropboxFolderPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (folderPath: string) => void;
}

export function DropboxFolderPicker({
  open,
  onClose,
  onSelect,
}: DropboxFolderPickerProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<DropboxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const browse = async (path: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-browse", {
        body: { path: path || "", action: "list" },
      });
      if (error) throw error;
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
    setCurrentPath("");
    browse("");
  };

  const openFolder = (path: string) => {
    setPathHistory((prev) => [...prev, currentPath]);
    browse(path);
  };

  const goBack = () => {
    const prev = pathHistory[pathHistory.length - 1] ?? "";
    setPathHistory((p) => p.slice(0, -1));
    browse(prev);
  };

  const handleSelectCurrentFolder = () => {
    onSelect(currentPath);
    onClose();
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
            <Folder className="h-5 w-5" />
            Seleccionar carpeta de Dropbox
          </DialogTitle>
          <DialogDescription>
            Navega y selecciona la carpeta del cliente
          </DialogDescription>
        </div>

        {/* Path breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground border-b pb-2">
          {currentPath && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={goBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <span className="truncate font-medium">{currentPath || "/ (Raíz)"}</span>
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto min-h-[200px] space-y-0.5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !loaded ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <p className="text-sm text-muted-foreground">Cargando carpetas...</p>
            </div>
          ) : folders.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">
              No hay subcarpetas
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

        {/* Select current folder button */}
        {loaded && (
          <div className="border-t pt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground truncate flex-1">
              Carpeta seleccionada: <span className="font-medium">{currentPath || "Raíz"}</span>
            </p>
            <Button size="sm" onClick={handleSelectCurrentFolder} disabled={!currentPath}>
              <Check className="h-4 w-4 mr-1" />
              Seleccionar esta carpeta
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
