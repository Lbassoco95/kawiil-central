import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MailFolders } from "./MailFolders";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompose?: () => void;
  onSelectFolder?: (folderId: string, folderName: string) => void;
}

export function MailFoldersSheet({ open, onOpenChange, onCompose, onSelectFolder }: Props) {
  const [selectedFolderId, setSelectedFolderId] = useState("");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[280px] p-0">
        <SheetHeader className="px-4 pt-4 pb-2 border-b border-border/40">
          <SheetTitle className="text-sm font-semibold">Carpetas</SheetTitle>
        </SheetHeader>
        <div className="overflow-y-auto h-full">
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
