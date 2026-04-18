import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Loader2, Paperclip, Upload, FolderUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFileIntake } from "@/hooks/useFileIntake";
import {
  formatMb,
  type FileIntakeLimits,
} from "@/lib/fileIntake/limits";
import { FileChips } from "@/components/shared/FileChips";

export type FileDropzoneVariant = "button" | "area" | "compact" | "overlay";

export interface FileDropzoneHandle {
  /** Abre el selector de archivos del SO. */
  openPicker: () => void;
  /** Limpia archivos. */
  clear: () => void;
}

interface FileDropzoneProps {
  files: File[];
  onChange: (files: File[]) => void;
  limits: FileIntakeLimits;
  /** Override del `accept` del preset. */
  accept?: string;
  disabled?: boolean;
  /** Si true, permite seleccionar carpetas (no soportado por todos los navegadores). */
  directoryPicker?: boolean;
  /** Si true (default), tambien escucha pegar archivos desde portapapeles cuando el dropzone tiene foco. */
  enablePaste?: boolean;
  /** Mostrar chips con archivos seleccionados. Default true. */
  showChips?: boolean;
  /** Mostrar tamanos en chips. */
  showSize?: boolean;
  className?: string;
  variant?: FileDropzoneVariant;
  /** Texto de la zona drop (variant area / overlay). */
  hint?: ReactNode;
  /** Texto del subtitulo (variant area). */
  subhint?: ReactNode;
  /** Etiqueta del boton (variant button / compact). */
  buttonLabel?: ReactNode;
  /** Tamano del boton (variant button). */
  buttonSize?: "sm" | "default" | "lg" | "icon";
  /** Variante visual del boton. */
  buttonVariant?: "default" | "outline" | "ghost" | "secondary";
  /** Si true, en variant overlay se renderiza por encima de los hijos al arrastrar. */
  children?: ReactNode;
}

function defaultHint(limits: FileIntakeLimits): string {
  const acceptZip =
    limits.zipMode === "expand" || limits.zipMode === "auto"
      ? " (los .zip se descomprimen)"
      : "";
  return `Arrastra y suelta archivos aqui o haz click${acceptZip}`;
}

function defaultSubhint(limits: FileIntakeLimits): string {
  return `Hasta ${limits.maxFiles} archivos, ${formatMb(limits.maxBytesPerFile)} MB c/u, ${formatMb(limits.maxBatchBytes)} MB total`;
}

export const FileDropzone = forwardRef<FileDropzoneHandle, FileDropzoneProps>(function FileDropzone(
  {
    files,
    onChange,
    limits,
    accept,
    disabled,
    directoryPicker,
    enablePaste = true,
    showChips = true,
    showSize,
    className,
    variant = "area",
    hint,
    subhint,
    buttonLabel,
    buttonSize = "sm",
    buttonVariant = "ghost",
    children,
  },
  ref
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const intake = useFileIntake({ files, onChange, limits, accept });

  useImperativeHandle(
    ref,
    () => ({
      openPicker: () => inputRef.current?.click(),
      clear: () => intake.clear(),
    }),
    [intake]
  );

  const reachedMaxFiles = files.length >= limits.maxFiles;
  const isBusy = intake.isProcessing;
  const interactiveDisabled = disabled || isBusy;

  const handleClick = useCallback(() => {
    if (interactiveDisabled || reachedMaxFiles) return;
    inputRef.current?.click();
  }, [interactiveDisabled, reachedMaxFiles]);

  const handleInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      await intake.addFiles(e.target.files);
      if (inputRef.current) inputRef.current.value = "";
    },
    [intake]
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (interactiveDisabled) return;
      const types = Array.from(e.dataTransfer?.types ?? []);
      if (!types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current += 1;
      setDragging(true);
    },
    [interactiveDisabled]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (interactiveDisabled) return;
      const types = Array.from(e.dataTransfer?.types ?? []);
      if (!types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        e.dataTransfer.dropEffect = "copy";
      } catch {
        // ignore
      }
    },
    [interactiveDisabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (interactiveDisabled) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setDragging(false);
      const dropped = e.dataTransfer?.files;
      if (dropped && dropped.length > 0) {
        await intake.addFiles(dropped);
      }
    },
    [interactiveDisabled, intake]
  );

  useEffect(() => {
    if (!enablePaste) return;
    const node = containerRef.current;
    if (!node) return;
    const handler = (event: ClipboardEvent) => {
      if (interactiveDisabled) return;
      const items = event.clipboardData?.files;
      if (items && items.length > 0) {
        event.preventDefault();
        void intake.addFiles(items);
      }
    };
    node.addEventListener("paste", handler);
    return () => node.removeEventListener("paste", handler);
  }, [enablePaste, intake, interactiveDisabled]);

  const directoryProps = directoryPicker
    ? ({ webkitdirectory: "", directory: "" } as Record<string, string>)
    : undefined;

  const inputEl = (
    <input
      ref={inputRef}
      type="file"
      multiple={limits.maxFiles > 1}
      accept={intake.acceptAttr}
      className="hidden"
      disabled={interactiveDisabled}
      onChange={handleInputChange}
      {...(directoryProps ?? {})}
    />
  );

  const chipsEl = showChips ? (
    <FileChips
      files={files}
      onRemove={intake.removeAt}
      disabled={interactiveDisabled}
      showSize={showSize}
    />
  ) : null;

  // Variant: button (estilo ChatAttachmentPicker antiguo)
  if (variant === "button") {
    return (
      <div
        ref={containerRef}
        className={cn("flex flex-col gap-1.5 shrink-0", className)}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {inputEl}
        <Button
          type="button"
          size={buttonSize}
          variant={buttonVariant}
          className={cn(
            "shrink-0",
            buttonSize === "icon" && "h-9 w-9 p-0",
            isDragging && "ring-2 ring-primary"
          )}
          disabled={interactiveDisabled || reachedMaxFiles}
          title={defaultHint(limits) + " · " + defaultSubhint(limits)}
          onClick={handleClick}
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
          {buttonLabel ? <span className="ml-1.5">{buttonLabel}</span> : null}
        </Button>
        {chipsEl}
      </div>
    );
  }

  // Variant: compact (boton outline horizontal con texto)
  if (variant === "compact") {
    return (
      <div
        ref={containerRef}
        className={cn("flex flex-col gap-1.5 w-full", className)}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {inputEl}
        <Button
          type="button"
          size={buttonSize}
          variant={buttonVariant === "ghost" ? "outline" : buttonVariant}
          className={cn(
            "w-full gap-1.5",
            isDragging && "ring-2 ring-primary border-primary"
          )}
          disabled={interactiveDisabled || reachedMaxFiles}
          onClick={handleClick}
        >
          {isBusy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {buttonLabel ?? "Procesando..."}
            </>
          ) : (
            <>
              {directoryPicker ? (
                <FolderUp className="h-3.5 w-3.5" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {buttonLabel ?? (isDragging ? "Suelta aqui" : "Subir archivos")}
            </>
          )}
        </Button>
        {chipsEl}
      </div>
    );
  }

  // Variant: overlay -- render children + drop overlay encima cuando arrastras.
  if (variant === "overlay") {
    return (
      <div
        ref={containerRef}
        className={cn("relative", className)}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {inputEl}
        {children}
        {(isDragging || isBusy) && (
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-2",
              "rounded-xl border-2 border-dashed border-primary bg-background/80 backdrop-blur-sm",
              "text-sm text-foreground"
            )}
          >
            {isBusy ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span>Procesando archivos...</span>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6 text-primary" />
                <span className="font-medium">{hint ?? defaultHint(limits)}</span>
                <span className="text-xs text-muted-foreground">
                  {subhint ?? defaultSubhint(limits)}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // Variant: area (default)
  return (
    <div
      ref={containerRef}
      className={cn("flex flex-col gap-2 w-full", className)}
    >
      {inputEl}
      <button
        type="button"
        onClick={handleClick}
        disabled={interactiveDisabled || reachedMaxFiles}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "group relative flex flex-col items-center justify-center gap-2 w-full rounded-xl",
          "border-2 border-dashed border-border/60 bg-secondary/20 px-4 py-6 text-center",
          "transition-colors hover:border-primary/60 hover:bg-secondary/40",
          isDragging && "border-primary bg-primary/5",
          (interactiveDisabled || reachedMaxFiles) && "opacity-60 cursor-not-allowed",
          "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        )}
      >
        {isBusy ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : (
          <Upload className="h-5 w-5 text-muted-foreground group-hover:text-primary" />
        )}
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            {hint ?? defaultHint(limits)}
          </span>
          <span className="text-xs text-muted-foreground">
            {subhint ?? defaultSubhint(limits)}
          </span>
          {reachedMaxFiles && (
            <span className="text-xs text-destructive">Limite de archivos alcanzado</span>
          )}
        </div>
      </button>
      {chipsEl}
    </div>
  );
});
