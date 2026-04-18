import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  formatMb,
  type FileIntakeLimits,
} from "@/lib/fileIntake/limits";
import { expandZipInBrowser, isZipFile } from "@/lib/fileIntake/unzipClient";
import { expandZipInEdge } from "@/lib/fileIntake/unzipEdge";

export interface UseFileIntakeOptions {
  files: File[];
  onChange: (files: File[]) => void;
  limits: FileIntakeLimits;
  /** Acepta override por instancia para los archivos aceptados. */
  accept?: string;
}

export interface UseFileIntakeReturn {
  addFiles: (incoming: FileList | File[] | null) => Promise<void>;
  removeAt: (index: number) => void;
  clear: () => void;
  isProcessing: boolean;
  /** Atributo `accept` listo para inputs (preset o override). */
  acceptAttr?: string;
}

function dedupeKey(f: File): string {
  return `${f.name}::${f.size}::${f.lastModified}`;
}

function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  const tokens = accept
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = (file.type ?? "").toLowerCase();
  for (const tok of tokens) {
    if (tok.startsWith(".") && name.endsWith(tok)) return true;
    if (tok.endsWith("/*") && type.startsWith(tok.slice(0, -1))) return true;
    if (tok.includes("/") && type === tok) return true;
  }
  return false;
}

export function useFileIntake({
  files,
  onChange,
  limits,
  accept,
}: UseFileIntakeOptions): UseFileIntakeReturn {
  const [isProcessing, setProcessing] = useState(false);
  const acceptAttr = accept ?? limits.accept;
  // Ref para evitar leer estado obsoleto cuando addFiles se llama varias veces seguidas.
  const filesRef = useRef(files);
  filesRef.current = files;

  const expandIfZip = useCallback(
    async (file: File): Promise<File[]> => {
      if (!isZipFile(file)) return [file];
      if (limits.zipMode === "keep") return [file];

      const useEdge =
        limits.zipMode === "auto" && file.size > limits.clientUnzipMaxBytes;

      try {
        if (useEdge) {
          const { files: extracted, warnings } = await expandZipInEdge(file);
          warnings.forEach((w) => toast.warning(w));
          return extracted.length > 0 ? extracted : [];
        }
        const { files: extracted, warnings } = await expandZipInBrowser(file);
        warnings.forEach((w) => toast.warning(w));
        return extracted.length > 0 ? extracted : [];
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error descomprimiendo ZIP";
        toast.error(msg);
        return [];
      }
    },
    [limits.zipMode, limits.clientUnzipMaxBytes]
  );

  const addFiles = useCallback(
    async (incoming: FileList | File[] | null) => {
      if (!incoming) return;
      const arr = Array.from(incoming as ArrayLike<File>);
      if (arr.length === 0) return;

      setProcessing(true);
      try {
        const expanded: File[] = [];
        for (const f of arr) {
          const out = await expandIfZip(f);
          for (const e of out) expanded.push(e);
        }

        const next = [...filesRef.current];
        const seen = new Set(next.map(dedupeKey));
        let batch = next.reduce((s, f) => s + f.size, 0);
        let rejectedAccept = 0;
        let rejectedSize = 0;
        let stoppedByCount = false;
        let stoppedByBatch = false;

        for (const f of expanded) {
          if (next.length >= limits.maxFiles) {
            stoppedByCount = true;
            break;
          }
          if (!matchesAccept(f, acceptAttr)) {
            rejectedAccept += 1;
            continue;
          }
          if (f.size > limits.maxBytesPerFile) {
            toast.error(
              `${f.name} supera ${formatMb(limits.maxBytesPerFile)} MB por archivo`
            );
            rejectedSize += 1;
            continue;
          }
          if (batch + f.size > limits.maxBatchBytes) {
            stoppedByBatch = true;
            break;
          }
          const key = dedupeKey(f);
          if (seen.has(key)) continue;
          seen.add(key);
          next.push(f);
          batch += f.size;
        }

        if (stoppedByCount) {
          toast.error(
            `Solo puedes adjuntar hasta ${limits.maxFiles} archivos a la vez`
          );
        }
        if (stoppedByBatch) {
          toast.error(
            `Con estos archivos superarias ${formatMb(limits.maxBatchBytes)} MB en total`
          );
        }
        if (rejectedAccept > 0) {
          toast.warning(
            `Se omitieron ${rejectedAccept} archivo(s) con tipo no permitido`
          );
        }
        if (rejectedSize > 0 && rejectedSize !== expanded.length) {
          // Toasts individuales ya emitidos; resumen no necesario.
        }

        if (next.length !== filesRef.current.length || expanded.length === 0) {
          onChange(next);
        } else {
          // Aun cuando todos fueron rechazados, mantenemos referencia identica.
          onChange([...next]);
        }
      } finally {
        setProcessing(false);
      }
    },
    [
      acceptAttr,
      expandIfZip,
      limits.maxBatchBytes,
      limits.maxBytesPerFile,
      limits.maxFiles,
      onChange,
    ]
  );

  const removeAt = useCallback(
    (index: number) => {
      const next = filesRef.current.filter((_, i) => i !== index);
      onChange(next);
    },
    [onChange]
  );

  const clear = useCallback(() => onChange([]), [onChange]);

  return { addFiles, removeAt, clear, isProcessing, acceptAttr };
}
