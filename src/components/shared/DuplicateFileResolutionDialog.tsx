import { useEffect, useRef } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type DuplicateResolutionChoice = "skip" | "replace" | "copy";

interface Props {
  open: boolean;
  fileName: string;
  onResolve: (choice: DuplicateResolutionChoice) => void;
}

/**
 * Conflicto de nombre al subir: omitir, sustituir el existente o subir copia renombrada.
 */
export function DuplicateFileResolutionDialog({ open, fileName, onResolve }: Props) {
  const chosenRef = useRef(false);

  useEffect(() => {
    if (open) chosenRef.current = false;
  }, [open]);

  const pick = (c: DuplicateResolutionChoice) => {
    chosenRef.current = true;
    onResolve(c);
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !chosenRef.current) onResolve("skip");
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archivo duplicado</AlertDialogTitle>
          <AlertDialogDescription className="text-left">
            Ya existe «<span className="font-medium text-foreground">{fileName}</span>». ¿Qué deseas
            hacer?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel type="button" onClick={() => pick("skip")}>
            Cancelar
          </AlertDialogCancel>
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
            onClick={() => pick("copy")}
          >
            Subir como copia
          </button>
          <AlertDialogAction type="button" onClick={() => pick("replace")}>
            Reemplazar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
