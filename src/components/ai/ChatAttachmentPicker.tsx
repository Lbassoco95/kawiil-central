import { useRef } from "react";
import { Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_FILES = 5;
const MAX_MB = 15;

interface ChatAttachmentPickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
}

export function ChatAttachmentPicker({ files, onChange, disabled, className }: ChatAttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const next = [...files];
    for (let i = 0; i < list.length && next.length < MAX_FILES; i++) {
      const f = list[i];
      if (f.size > MAX_MB * 1024 * 1024) continue;
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    onChange(next);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeAt = (idx: number) => {
    onChange(files.filter((_, i) => i !== idx));
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
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
        className="h-8 w-8 p-0 shrink-0"
        disabled={disabled || files.length >= MAX_FILES}
        title={`Adjuntar archivos (máx. ${MAX_FILES}, ${MAX_MB}MB c/u)`}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="h-4 w-4" />
      </Button>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1 max-w-full">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex items-center gap-0.5 text-[10px] bg-secondary/70 rounded-md px-1.5 py-0.5 max-w-[140px]"
            >
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => removeAt(i)}
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
