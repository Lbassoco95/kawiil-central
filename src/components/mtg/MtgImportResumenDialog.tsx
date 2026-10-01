/**
 * Carga un resumen (DOCX/texto) al tablero de la junta:
 * empareja con temas por entidad y actualiza avance / notas.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, FileUp } from "lucide-react";
import { toast } from "sonner";
import { extractDocxTextClient, isDocxChatAttachment } from "@/lib/extractDocxTextClient";
import { applyResumenTextToBoard } from "@/lib/mtg/applyResumenToBoard";

export function MtgImportResumenDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  actorUserId: string;
  meetingId: string;
  seriesId: string;
  onDone?: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      if (isDocxChatAttachment(file.name, file.type)) {
        const extracted = await extractDocxTextClient(file);
        if (!extracted) throw new Error("No se pudo leer el DOCX");
        setText(extracted);
        toast.success("Texto extraído del DOCX — revisa y aplica");
      } else if (file.type.startsWith("text/") || file.name.endsWith(".txt") || file.name.endsWith(".md")) {
        setText(await file.text());
        toast.success("Texto cargado — revisa y aplica");
      } else {
        throw new Error("Usa .docx, .txt o .md");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo leer el archivo");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!text.trim()) {
      toast.error("Pega o carga el resumen primero");
      return;
    }
    setBusy(true);
    try {
      const res = await applyResumenTextToBoard({
        organizationId: props.organizationId,
        actorUserId: props.actorUserId,
        meetingId: props.meetingId,
        seriesId: props.seriesId,
        rawText: text,
      });
      toast.success(
        res.matched > 0
          ? `Resumen aplicado: ${res.matched} tema(s) actualizados`
          : "No se emparejaron temas; revisa títulos o actualiza a mano",
        { duration: 8000 },
      );
      props.onOpenChange(false);
      props.onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al aplicar resumen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cargar resumen a la junta</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Sube el DOCX o pega el texto del resumen (como el de Grupo Sylon). Se empareja con los
          temas del tablero por empresa y actualiza avance, notas y movimiento.
        </p>
        <div className="space-y-2">
          <Label htmlFor="mtg-resumen-file">Archivo (.docx / .txt)</Label>
          <input
            id="mtg-resumen-file"
            type="file"
            accept=".docx,.txt,.md,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mtg-resumen-text">Texto</Label>
          <Textarea
            id="mtg-resumen-text"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Pega aquí el resumen de la junta…"
            disabled={busy}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={busy || !text.trim()} onClick={() => void apply()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <FileUp className="h-3.5 w-3.5 mr-1" />}
            Aplicar al tablero
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
