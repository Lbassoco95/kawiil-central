import { useCallback } from "react";
import {
  filenameKey,
  nextDistinctFilename,
  fileWithName,
} from "@/lib/duplicateUpload";
import type { DuplicateResolutionChoice } from "@/components/shared/DuplicateFileResolutionDialog";

/**
 * Colapsa una lista de `File` con el mismo nombre mostrando el diálogo (omitir / reemplazar / copia).
 */
export function useResolveDuplicateFilenames(
  prompt: (fileName: string) => Promise<DuplicateResolutionChoice>
) {
  return useCallback(
    async (files: File[]): Promise<File[]> => {
      const out: File[] = [];
      const used = new Set<string>();
      for (const f of files) {
        const k = filenameKey(f.name);
        if (!used.has(k)) {
          out.push(f);
          used.add(k);
          continue;
        }
        const choice = await prompt(f.name);
        if (choice === "skip") continue;
        if (choice === "replace") {
          const idx = out.findIndex((r) => filenameKey(r.name) === k);
          if (idx >= 0) out[idx] = f;
          continue;
        }
        const nn = nextDistinctFilename(f.name, used);
        const nf = fileWithName(f, nn);
        out.push(nf);
        used.add(filenameKey(nn));
      }
      return out;
    },
    [prompt]
  );
}
