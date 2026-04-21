import { X, FileText, FileImage, FileSpreadsheet, FileArchive, FileCode, File as FileIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getZipIntakeMarker } from "@/lib/fileIntake/zipMarkers";

interface FileChipsProps {
  files: File[];
  onRemove: (index: number) => void;
  disabled?: boolean;
  className?: string;
  /** Mostrar tamano por archivo (KB / MB). */
  showSize?: boolean;
}

function pickIcon(name: string) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return FileImage;
  if (["xlsx", "xls", "csv"].includes(ext)) return FileSpreadsheet;
  if (["zip", "rar", "7z"].includes(ext)) return FileArchive;
  if (["xml", "json", "html", "md"].includes(ext)) return FileCode;
  if (["pdf", "doc", "docx", "txt"].includes(ext)) return FileText;
  return FileIcon;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileChips({ files, onRemove, disabled, className, showSize }: FileChipsProps) {
  if (files.length === 0) return null;
  return (
    <div
      className={cn(
        "max-h-32 overflow-y-auto rounded-xl border border-border/40 bg-secondary/20 px-2 py-2 flex flex-wrap gap-1.5 w-full",
        className
      )}
    >
      {files.map((f, i) => {
        const Icon = pickIcon(f.name);
        const zm = getZipIntakeMarker(f);
        return (
          <span
            key={`${f.name}-${i}-${f.size}`}
            className="inline-flex items-center gap-1.5 text-[11px] bg-secondary/80 rounded-md px-2 py-1 max-w-[min(100%,260px)] border border-border/30"
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate min-w-0" title={f.name}>
              {f.name}
            </span>
            {zm?.kind === "server_deferred" && (
              <span
                className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-500"
                title="Se extraerá en el servidor tras subir"
              >
                servidor
              </span>
            )}
            {zm?.kind === "from_expanded_zip" && (
              <span
                className="shrink-0 text-[9px] text-muted-foreground truncate max-w-[72px]"
                title={`Desde ${zm.zipBaseName}`}
              >
                ← ZIP
              </span>
            )}
            {showSize && (
              <span className="text-muted-foreground/80 shrink-0">{formatSize(f.size)}</span>
            )}
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => onRemove(i)}
              disabled={disabled}
              aria-label={`Quitar ${f.name}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
