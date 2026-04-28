import { useCallback, useRef, useState, type ReactNode } from "react";
import { useFileIntake } from "@/hooks/useFileIntake";
import { slackUploadLimits } from "@/lib/fileIntake/limits";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  /** Si false, no se aceptan soltadas (p. ej. sin canal). */
  enabled: boolean;
  /** Mientras el padre sube archivos, ignorar nuevos drops. */
  busy?: boolean;
  /** Archivos ya validados/expandidos (ZIP) listos para subir a Slack. */
  onFiles: (files: File[]) => void | Promise<void>;
  className?: string;
};

/**
 * Zona de arrastre sobre el chat Slack: misma validación que el clip del compositor (useFileIntake + slackUploadLimits).
 */
export function SlackChatFileDropZone({ children, enabled, busy = false, onFiles, className }: Props) {
  const [staged, setStaged] = useState<File[]>([]);
  const dragCounterRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  const onIntakeChange = useCallback(
    (next: File[]) => {
      if (next.length === 0) return;
      if (!enabled || busy) return;
      setStaged([]);
      void Promise.resolve(onFiles(next));
    },
    [enabled, busy, onFiles],
  );

  const intake = useFileIntake({
    files: staged,
    onChange: onIntakeChange,
    limits: slackUploadLimits,
    accept: "*/*",
  });

  const interactiveDisabled = !enabled || busy || intake.isProcessing;

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
    [interactiveDisabled],
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
        /* ignore */
      }
    },
    [interactiveDisabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragging(false);
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
    [interactiveDisabled, intake],
  );

  return (
    <div
      className={cn("relative min-h-0 min-w-0 flex flex-col", className)}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {dragging && !interactiveDisabled ? (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/60 bg-background/85 backdrop-blur-[2px]"
          aria-hidden
        >
          <p className="text-sm font-medium text-foreground px-4 text-center">Suelta para enviar a Slack</p>
        </div>
      ) : null}
    </div>
  );
}
