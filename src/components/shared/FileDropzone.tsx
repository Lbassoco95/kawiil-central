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
  /** Abre el selector de carpeta (`webkitdirectory`), si `enableFolderPicker` está activo. */
  openFolderPicker: () => void;
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
  /** Si true, el único input solo permite elegir carpeta (legacy). Preferir `enableFolderPicker`. */
  directoryPicker?: boolean;
  /**
   * Si true: segundo control e input `webkitdirectory` para subir todos los archivos de una carpeta,
   * sin desactivar el selector multi-archivo habitual.
   */
  enableFolderPicker?: boolean;
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

function defaultHint(limits: FileIntakeLimits, folderPicker?: boolean): string {
  let base: string;
  if (limits.zipMode === "keep") {
    base = "Arrastra y suelta archivos aqui o haz click";
  } else if (limits.deferLargeZipToServer) {
    base =
      "Arrastra y suelta archivos aqui o haz click (ZIP grande o con muchas entradas: extracción en servidor)";
  } else {
    base = "Arrastra y suelta archivos aqui o haz click (los .zip se descomprimen)";
  }
  if (folderPicker) {
    return `${base}. También puedes elegir una carpeta con «Subir carpeta».`;
  }
  return base;
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
    enableFolderPicker = false,
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
  const folderInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const intake = useFileIntake({ files, onChange, limits, accept });

  useImperativeHandle(
    ref,
    () => ({
      openPicker: () => inputRef.current?.click(),
      openFolderPicker: () => folderInputRef.current?.click(),
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

  const handleFolderInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      await intake.addFiles(e.target.files);
      if (folderInputRef.current) folderInputRef.current.value = "";
    },
    [intake]
  );

  const openFolderPickerClick = useCallback(() => {
    if (interactiveDisabled || reachedMaxFiles) return;
    folderInputRef.current?.click();
  }, [interactiveDisabled, reachedMaxFiles]);

  /** Dos inputs: archivos + carpeta. Si `directoryPicker` sin `enableFolderPicker`, un solo input solo-carpeta (legacy). */
  const useDualFolderMode = enableFolderPicker;
  const folderWebKitProps = { webkitdirectory: "", directory: "" } as Record<string, string>;

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

  const directoryProps =
    directoryPicker && !enableFolderPicker ? folderWebKitProps : undefined;

  const inputEl = (
    <>
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
      {useDualFolderMode && (
        <input
          ref={folderInputRef}
          type="file"
          className="hidden"
          disabled={interactiveDisabled}
          accept={intake.acceptAttr}
          onChange={handleFolderInputChange}
          {...folderWebKitProps}
        />
      )}
    </>
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
    const hintLine =
      defaultHint(limits, enableFolderPicker) + " · " + defaultSubhint(limits);
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
        <div
          className={cn(
            "flex items-center shrink-0",
            useDualFolderMode ? "gap-1" : ""
          )}
        >
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
            title={hintLine}
            onClick={handleClick}
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
            {buttonLabel ? <span className="ml-1.5">{buttonLabel}</span> : null}
          </Button>
          {useDualFolderMode && (
            <Button
              type="button"
              size={buttonSize}
              variant="outline"
              className={cn(
                "shrink-0 px-2",
                buttonSize === "icon" && "h-9 w-9 p-0",
                isDragging && "ring-2 ring-primary"
              )}
              disabled={interactiveDisabled || reachedMaxFiles}
              title="Subir todos los archivos de una carpeta"
              onClick={(e) => {
                e.stopPropagation();
                openFolderPickerClick();
              }}
              aria-label="Subir carpeta"
            >
              <FolderUp className="h-4 w-4" />
            </Button>
          )}
        </div>
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
        {useDualFolderMode ? (
          <div className="flex gap-1.5 w-full">
            <Button
              type="button"
              size={buttonSize}
              variant={buttonVariant === "ghost" ? "outline" : buttonVariant}
              className={cn(
                "flex-1 gap-1.5 min-w-0",
                isDragging && "ring-2 ring-primary border-primary"
              )}
              disabled={interactiveDisabled || reachedMaxFiles}
              onClick={handleClick}
              title={defaultHint(limits, true) + " · " + defaultSubhint(limits)}
            >
              {isBusy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {buttonLabel ?? "Procesando..."}
                </>
              ) : (
                <>
                  <Upload className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {buttonLabel ?? (isDragging ? "Suelta aqui" : "Archivos")}
                  </span>
                </>
              )}
            </Button>
            <Button
              type="button"
              size={buttonSize}
              variant="outline"
              className={cn(
                "gap-1.5 shrink-0",
                isDragging && "ring-2 ring-primary border-primary"
              )}
              disabled={interactiveDisabled || reachedMaxFiles}
              onClick={openFolderPickerClick}
              title="Subir todos los archivos de una carpeta"
              aria-label="Subir carpeta"
            >
              <FolderUp className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Carpeta</span>
            </Button>
          </div>
        ) : (
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
        )}
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
        {useDualFolderMode && (
          <div className="absolute bottom-2 right-2 z-[45] pointer-events-auto">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 text-xs gap-1 shadow-md"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openFolderPickerClick();
              }}
              disabled={interactiveDisabled || reachedMaxFiles}
              title="Subir todos los archivos de una carpeta"
            >
              <FolderUp className="h-3.5 w-3.5" />
              Carpeta
            </Button>
          </div>
        )}
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
                <span className="font-medium">
                  {hint ?? defaultHint(limits, enableFolderPicker)}
                </span>
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
            {hint ?? defaultHint(limits, enableFolderPicker)}
          </span>
          <span className="text-xs text-muted-foreground">
            {subhint ?? defaultSubhint(limits)}
          </span>
          {reachedMaxFiles && (
            <span className="text-xs text-destructive">Limite de archivos alcanzado</span>
          )}
        </div>
      </button>
      {useDualFolderMode && (
        <button
          type="button"
          onClick={openFolderPickerClick}
          disabled={interactiveDisabled || reachedMaxFiles}
          className="text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline self-center"
        >
          Subir carpeta entera
        </button>
      )}
      {chipsEl}
    </div>
  );
});
