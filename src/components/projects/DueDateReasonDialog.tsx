import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle } from "lucide-react";

interface DueDateReasonDialogProps {
  open: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function DueDateReasonDialog({ open, onConfirm, onCancel }: DueDateReasonDialogProps) {
  const [reason, setReason] = useState("");

  const handleConfirm = () => {
    if (!reason.trim()) return;
    onConfirm(reason.trim());
    setReason("");
  };

  const handleCancel = () => {
    setReason("");
    onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            Motivo del cambio de fecha
          </DialogTitle>
          <DialogDescription>
            Indica por qué se modificó la fecha límite. Se registrará como comentario automático.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej: El cliente solicitó extensión por documentación pendiente..."
          className="min-h-[80px] text-sm"
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={!reason.trim()}>
            Confirmar cambio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
