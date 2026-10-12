import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PdfPages, type PdfFieldBox } from "./PdfPages";
import { DEFAULT_FIELD, signerColor } from "@/lib/esignPdf";
import { Loader2, PenTool } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface PlacedField extends PdfFieldBox {
  signerKey: string;
}

export interface PlacementSigner {
  key: string;
  name: string;
}

interface PlaceSignaturesDialogProps {
  open: boolean;
  onClose: () => void;
  pdfData: Uint8Array | null;
  signers: PlacementSigner[];
  fields: PlacedField[];
  onFieldsChange: (fields: PlacedField[]) => void;
  activeKey: string | null;
  onActiveKeyChange: (key: string) => void;
  onSend: () => void;
  sending: boolean;
}

/** Pantalla para elegir en qué página y lugar firma cada persona. */
export function PlaceSignaturesDialog({
  open, onClose, pdfData, signers, fields, onFieldsChange, activeKey, onActiveKeyChange, onSend, sending,
}: PlaceSignaturesDialogProps) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReady(false);
      setLoadError(null);
    }
  }, [open, pdfData]);
  const missing = signers.filter((s) => !fields.some((f) => f.signerKey === s.key));
  const active = signers.find((s) => s.key === activeKey) ?? signers[0];

  const add = (page: number, x: number, y: number) => {
    if (!active) return;
    onFieldsChange([
      ...fields,
      {
        id: crypto.randomUUID(), signerKey: active.key, page, x, y, ...DEFAULT_FIELD,
        color: signerColor(signers, active.key), label: active.name,
      },
    ]);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[92vh] max-w-5xl flex-col gap-3">
        <div className="space-y-1">
          <DialogTitle className="flex items-center gap-2"><PenTool className="h-5 w-5" /> Colocar firmas en el documento</DialogTitle>
          <DialogDescription>
            Elige un firmante y haz clic en la página donde debe firmar. Arrastra el recuadro para moverlo o quítalo con la ✕.
          </DialogDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {signers.map((s) => {
            const color = signerColor(signers, s.key);
            const count = fields.filter((f) => f.signerKey === s.key).length;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onActiveKeyChange(s.key)}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition",
                  active?.key === s.key ? "bg-muted font-medium shadow-sm" : "opacity-70 hover:opacity-100",
                )}
                style={{ borderColor: color }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                {s.name || "Firmante"} · {count}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md bg-muted/40 p-3">
          {pdfData ? (
            <PdfPages
              source={{ data: pdfData }}
              fields={fields}
              mode="place"
              onLoaded={() => setReady(true)}
              onError={setLoadError}
              onAdd={add}
              onMove={(id, x, y) => onFieldsChange(fields.map((f) => (f.id === id ? { ...f, x, y } : f)))}
              onRemove={(id) => onFieldsChange(fields.filter((f) => f.id !== id))}
            />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">Cargando documento…</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={cn("text-xs", missing.length ? "text-amber-600" : "text-muted-foreground")}>
            {loadError
              ? "No se pudo mostrar el documento. Puedes enviar igual: la firma irá en la hoja de firmas al final del PDF."
              : !ready
                ? "Cargando documento…"
                : missing.length
                  ? `Sin recuadro: ${missing.map((m) => m.name || "Firmante").join(", ")}. Su firma irá solo en la hoja de firmas al final del PDF.`
                  : "Todos los firmantes tienen su recuadro."}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={sending}>Volver</Button>
            <Button onClick={onSend} disabled={sending || (!ready && !loadError)}>
              {sending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando...</> : <><PenTool className="mr-2 h-4 w-4" />Enviar a firma</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
