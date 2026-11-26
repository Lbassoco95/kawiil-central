import { useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { MailFolders } from "./MailFolders";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompose?: () => void;
  onSelectFolder?: (folderId: string, folderName: string) => void;
  /**
   * Panel de buzones/cuentas (Todas las cuentas, cuentas vinculadas, etiquetas…).
   * En móvil el sidebar fijo está oculto, así que aquí se muestra dentro de la hoja.
   */
  accountsPanel?: ReactNode;
}

export function MailFoldersSheet({ open, onOpenChange, onCompose, onSelectFolder, accountsPanel }: Props) {
  const [selectedFolderId, setSelectedFolderId] = useState("");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[88vw] max-w-[340px] p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-2 border-b border-border/40 shrink-0">
          <SheetTitle className="text-sm font-semibold">Buzones y carpetas</SheetTitle>
          <SheetDescription className="sr-only">
            Elige un buzón, ver todas las cuentas o abrir una carpeta.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {accountsPanel && (
            <>
              {accountsPanel}
              <div className="mx-3 my-2 border-t border-border/40" />
            </>
          )}
          <MailFolders
            selectedFolderId={selectedFolderId}
            onSelectFolder={(id, name) => {
              setSelectedFolderId(id);
              onSelectFolder?.(id, name ?? id);
              onOpenChange(false);
            }}
            onCompose={() => {
              onOpenChange(false);
              onCompose?.();
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
