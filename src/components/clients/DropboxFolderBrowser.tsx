import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { uploadFileToDropbox } from "@/lib/dropboxUpload";
import { toast } from "sonner";
import {
  Folder,
  FileText,
  ChevronLeft,
  Loader2,
  ExternalLink,
  Upload,
  FolderOpen,
} from "lucide-react";

interface DropboxEntry {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  size: number | null;
  modified: string | null;
}

interface DropboxFolderBrowserProps {
  folderPath: string;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DropboxFolderBrowser({ folderPath }: DropboxFolderBrowserProps) {
  const [currentPath, setCurrentPath] = useState(folderPath);
  const [entries, setEntries] = useState<DropboxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [linkLoading, setLinkLoading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const browse = async (path: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-browse", {
        body: { path: path || folderPath, action: "list" },
      });
      if (error) {
        const msg = data?.error || error.message || "Error desconocido";
        if (msg.includes("path/not_found") || msg.includes("not_found")) {
          toast.error("Carpeta no encontrada en Dropbox. Verifica que exista la ruta: " + (path || folderPath));
        } else {
          toast.error("Error al navegar Dropbox: " + msg);
        }
        return;
      }
      if (data.error) throw new Error(data.error);
      setEntries(data.entries || []);
      setCurrentPath(data.resolved_path || path);
    } catch (e: any) {
      toast.error("Error al navegar Dropbox: " + (e.message || "Error desconocido"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    browse(folderPath);
  }, [folderPath]);

  const openFolder = (path: string) => {
    setPathHistory((prev) => [...prev, currentPath]);
    browse(path);
  };

  const goBack = () => {
    const prev = pathHistory[pathHistory.length - 1] ?? folderPath;
    setPathHistory((p) => p.slice(0, -1));
    browse(prev);
  };

  const openFileLink = async (entry: DropboxEntry) => {
    setLinkLoading(entry.id);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-browse", {
        body: { path: entry.path, action: "get_link" },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      if (data.url) {
        window.open(data.url, "_blank");
      }
    } catch (e: any) {
      toast.error("Error al obtener enlace: " + (e.message || "Error desconocido"));
    } finally {
      setLinkLoading(null);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const uploadPath = `${currentPath}/${file.name}`;
      await uploadFileToDropbox(file, uploadPath);
      toast.success(`"${file.name}" subido a Dropbox`);
      browse(currentPath);
    } catch (err: any) {
      toast.error("Error al subir: " + err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const folders = entries.filter((e) => e.type === "folder").sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter((e) => e.type === "file").sort((a, b) => a.name.localeCompare(b.name));

  const relativePath = currentPath.replace(folderPath, "") || "/";

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
          {currentPath !== folderPath && (
            <Button variant="ghost" size="sm" className="h-7 px-2 shrink-0" onClick={goBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate font-medium">{relativePath === "/" ? "Raíz del cliente" : relativePath}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            Subir archivo
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="border rounded-md divide-y max-h-[400px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">Carpeta vacía</p>
        ) : (
          <>
            {folders.map((entry) => (
              <button
                key={entry.id}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left"
                onClick={() => openFolder(entry.path)}
              >
                <Folder className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm truncate flex-1 font-medium">{entry.name}</span>
              </button>
            ))}
            {files.map((entry) => (
              <button
                key={entry.id}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left group"
                onClick={() => openFileLink(entry)}
                disabled={linkLoading === entry.id}
              >
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
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
    </div>
  );
}
