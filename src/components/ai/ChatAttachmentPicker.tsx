import { useRef } from "react";
import { Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MAX_CHAT_ATTACHMENT_BATCH_BYTES,
  MAX_CHAT_ATTACHMENT_BYTES_PER_FILE,
  MAX_CHAT_ATTACHMENT_FILES,
  formatMb,
} from "@/lib/chatAttachmentLimits";
import { toast } from "sonner";

export function ChatAttachmentChips({
  files,
  onRemove,
  disabled,
  className,
}: {
  files: File[];
  onRemove: (index: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  if (files.length === 0) return null;
  return (
    <div
      className={cn(
        "max-h-32 overflow-y-auto rounded-xl border border-border/40 bg-secondary/20 px-2 py-2 flex flex-wrap gap-1.5 w-full",
        className
      )}
    >
      {files.map((f, i) => (
        <span
          key={`${f.name}-${i}-${f.size}`}
          className="inline-flex items-center gap-1 text-[11px] bg-secondary/80 rounded-md px-2 py-1 max-w-[min(100%,220px)] border border-border/30"
        >
          <span className="truncate" title={f.name}>
            {f.name}
          </span>
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
      ))}
    </div>
  );
}

interface ChatAttachmentPickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  /** Si es false, no muestra chips (úsalos arriba con ChatAttachmentChips). */
  showChips?: boolean;
}

export function ChatAttachmentPicker({
  files,
  onChange,
  disabled,
  className,
  showChips = true,
}: ChatAttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const currentBatchBytes = (list: File[]) => list.reduce((s, f) => s + f.size, 0);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    let next = [...files];
    let batch = currentBatchBytes(next);

    for (let i = 0; i < list.length && next.length < MAX_CHAT_ATTACHMENT_FILES; i++) {
      const f = list[i];
      if (f.size > MAX_CHAT_ATTACHMENT_BYTES_PER_FILE) {
        toast.error(`${f.name} supera ${formatMb(MAX_CHAT_ATTACHMENT_BYTES_PER_FILE)} MB por archivo`);
        continue;
      }
      if (batch + f.size > MAX_CHAT_ATTACHMENT_BATCH_BYTES) {
        toast.error(
          `Con estos archivos superarías ${formatMb(MAX_CHAT_ATTACHMENT_BATCH_BYTES)} MB en total por mensaje`
        );
        break;
      }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) {
        next.push(f);
        batch += f.size;
      }
    }
    onChange(next);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeAt = (idx: number) => {
    onChange(files.filter((_, i) => i !== idx));
  };

  return (
    <div className={cn("flex flex-col gap-1.5 shrink-0", className)}>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(e) => addFiles(e.target.files)}
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-9 w-9 p-0 shrink-0"
        disabled={disabled || files.length >= MAX_CHAT_ATTACHMENT_FILES}
        title={`Adjuntar (máx. ${MAX_CHAT_ATTACHMENT_FILES} archivos, ${formatMb(MAX_CHAT_ATTACHMENT_BYTES_PER_FILE)} MB c/u, ${formatMb(MAX_CHAT_ATTACHMENT_BATCH_BYTES)} MB total)`}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="h-4 w-4" />
      </Button>
      {showChips && (
        <ChatAttachmentChips files={files} onRemove={removeAt} disabled={disabled} />
      )}
    </div>
  );
}
