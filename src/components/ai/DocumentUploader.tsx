import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, FolderUp } from "lucide-react";
import { useFileIntake } from "@/hooks/useFileIntake";
import { documentsLimits } from "@/lib/fileIntake/limits";
import { cn } from "@/lib/utils";

interface DocumentUploaderProps {
  onUpload: (file: File) => void | Promise<void>;
  uploading: boolean;
  progress: string;
}

/**
 * Dropzone compacto para el panel de conocimiento.
 * Soporta drag-and-drop y multi-archivo (con expansion automatica de ZIP).
 * Cada archivo se procesa secuencialmente delegando a `onUpload`.
 */
export function DocumentUploader({ onUpload, uploading, progress }: DocumentUploaderProps) {
  const [staged, setStaged] = useState<File[]>([]);
  const [isProcessing, setProcessing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const intake = useFileIntake({
    files: staged,
    onChange: (files) => {
      setStaged([]);
      void processBatch(files);
    },
    limits: documentsLimits,
  });

  const processBatch = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setProcessing(true);
      try {
        for (const f of files) {
          try {
            await onUpload(f);
          } catch (err) {
            // Continuamos con los siguientes incluso si uno falla.
            // eslint-disable-next-line no-console
            console.error("[DocumentUploader] upload fallo", f.name, err);
          }
        }
      } finally {
        setProcessing(false);
      }
    },
    [onUpload]
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const folderWebKitProps = { webkitdirectory: "", directory: "" } as Record<string, string>;
  const busy = uploading || isProcessing || intake.isProcessing;

  const handleDragEnter = (e: React.DragEvent) => {
    if (busy) return;
    const types = Array.from(e.dataTransfer?.types ?? []);
    if (!types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setDragging(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (busy) return;
    const types = Array.from(e.dataTransfer?.types ?? []);
    if (!types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch {
      // ignore
    }
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragging(false);
  };
  const handleDrop = async (e: React.DragEvent) => {
    if (busy) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragging(false);
    const dropped = e.dataTransfer?.files;
    if (dropped && dropped.length > 0) await intake.addFiles(dropped);
  };

  return (
    <div
      ref={containerRef}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "rounded-md border border-dashed border-border/60 transition-colors",
        isDragging && "border-primary bg-primary/5"
      )}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        accept={intake.acceptAttr}
        onChange={async (e) => {
          await intake.addFiles(e.target.files);
          if (fileRef.current) fileRef.current.value = "";
        }}
      />
      <input
        ref={folderRef}
        type="file"
        className="hidden"
        accept={intake.acceptAttr}
        {...folderWebKitProps}
        onChange={async (e) => {
          await intake.addFiles(e.target.files);
          if (folderRef.current) folderRef.current.value = "";
        }}
      />
      <div className="flex gap-1 w-full">
        <Button
          size="sm"
          variant="ghost"
          className="flex-1 h-8 text-xs gap-1.5 min-w-0"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Elegir archivos o usar arrastre. ZIP: expansion segun tamaño."
        >
          {busy ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="truncate">{progress || "Subiendo..."}</span>
            </>
          ) : isDragging ? (
            <>
              <FolderUp className="h-3 w-3 shrink-0" /> Suelta aqui
            </>
          ) : (
            <>
              <Upload className="h-3 w-3 shrink-0" />
              <span className="truncate">Archivos</span>
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-2 text-xs gap-1 shrink-0"
          type="button"
          onClick={() => folderRef.current?.click()}
          disabled={busy}
          title="Subir todos los archivos de una carpeta"
          aria-label="Subir carpeta"
        >
          <FolderUp className="h-3 w-3" />
          <span className="hidden sm:inline">Carpeta</span>
        </Button>
      </div>
    </div>
  );
}
