import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, FolderOpen, Check } from "lucide-react";
import { useCreateMailRule } from "@/hooks/useMicrosoft";

interface MailFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  senderEmail?: string;
  senderName?: string;
  folders?: MailFolder[];
}

export function CreateMailRuleDialog({ open, onOpenChange, senderEmail = "", senderName, folders = [] }: Props) {
  const [ruleName, setRuleName] = useState("");
  const [sender, setSender] = useState(senderEmail);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [markAsRead, setMarkAsRead] = useState(false);
  const [folderSearch, setFolderSearch] = useState("");

  const createMailRule = useCreateMailRule();

  useEffect(() => {
    if (open) {
      setSender(senderEmail);
      setRuleName(senderName ? `Correos de ${senderName}` : senderEmail ? `Correos de ${senderEmail}` : "");
      setSelectedFolderId(null);
      setMarkAsRead(false);
      setFolderSearch("");
    }
  }, [open, senderEmail, senderName]);

  const filteredFolders = folders.filter((f) =>
    !folderSearch.trim() || f.displayName.toLowerCase().includes(folderSearch.toLowerCase())
  );

  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

  const handleSubmit = async () => {
    if (!sender.trim()) return;
    await createMailRule.mutateAsync({
      displayName: ruleName.trim() || `Regla: ${sender.trim()}`,
      senderEmail: sender.trim(),
      moveToFolderId: selectedFolderId ?? undefined,
      markAsRead,
    });
    onOpenChange(false);
  };

  const isValid = sender.trim().length > 0 && (!!selectedFolderId || markAsRead);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(100vw-1rem,28rem)] rounded-xl border-border/60 p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/40">
          <DialogTitle className="text-base font-semibold">Crear regla de correo</DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Los correos del remitente se moverán automáticamente a la carpeta seleccionada.
          </p>
        </DialogHeader>

        <div className="px-5 py-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">Remitente</Label>
            <Input
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              placeholder="correo@ejemplo.com"
              className="h-9 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">Nombre de la regla (opcional)</Label>
            <Input
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="Nombre de la regla"
              className="h-9 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">Mover a carpeta</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={folderSearch}
                onChange={(e) => setFolderSearch(e.target.value)}
                placeholder="Buscar carpeta…"
                className="h-9 text-sm pl-8"
              />
            </div>
            <ScrollArea className="h-40 rounded-md border border-border/50 bg-muted/20">
              <div className="flex flex-col gap-0.5 p-1.5">
                <button
                  type="button"
                  className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                    selectedFolderId === null ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                  }`}
                  onClick={() => setSelectedFolderId(null)}
                >
                  <span className="text-muted-foreground text-xs italic flex-1">Sin mover (solo marcar leído)</span>
                  {selectedFolderId === null && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
                {filteredFolders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                      selectedFolderId === folder.id ? "bg-primary/10 text-primary" : "hover:bg-accent/50"
                    }`}
                    onClick={() => setSelectedFolderId(folder.id)}
                  >
                    <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{folder.displayName}</span>
                    {selectedFolderId === folder.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                ))}
                {filteredFolders.length === 0 && (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">Sin coincidencias</p>
                )}
              </div>
            </ScrollArea>
            {selectedFolder && (
              <p className="text-xs text-muted-foreground">
                Mover a: <span className="font-medium text-foreground">{selectedFolder.displayName}</span>
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs font-medium cursor-pointer" htmlFor="rule-mark-read">
              Marcar como leído automáticamente
            </Label>
            <Switch id="rule-mark-read" checked={markAsRead} onCheckedChange={setMarkAsRead} />
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border/40 flex flex-row justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={createMailRule.isPending}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!isValid || createMailRule.isPending}
          >
            {createMailRule.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Creando…
              </>
            ) : (
              "Crear regla"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
