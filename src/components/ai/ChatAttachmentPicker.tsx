import { FileDropzone } from "@/components/shared/FileDropzone";
import { FileChips } from "@/components/shared/FileChips";
import { chatLimits } from "@/lib/fileIntake/limits";

/**
 * Wrapper retrocompatible. La logica vive en `FileDropzone` (variant="button")
 * y `FileChips`. Mantiene la API publica que ya consumen `FloatingAIChat` y
 * `AsistenteIA`.
 */

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
  return (
    <FileChips
      files={files}
      onRemove={onRemove}
      disabled={disabled}
      className={className}
    />
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
  return (
    <FileDropzone
      files={files}
      onChange={onChange}
      limits={chatLimits}
      disabled={disabled}
      className={className}
      variant="button"
      buttonSize="icon"
      buttonVariant="ghost"
      showChips={showChips}
    />
  );
}
