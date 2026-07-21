import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { bankStatementLimits } from "@/lib/fileIntake/limits";
import { Sparkles, Loader2, FileSpreadsheet } from "lucide-react";
import { useUploadBankStatement } from "@/hooks/useBankMovements";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BankStatementUploadDialog({ open, onOpenChange }: Props) {
  const upload = useUploadBankStatement();
  const [files, setFiles] = useState<File[]>([]);
  const [bankName, setBankName] = useState("");

  const handleUpload = async () => {
    if (files.length === 0) return;
    for (const file of files) {
      await upload.mutateAsync({ file, bank_name: bankName || null }).catch(() => {});
    }
    setFiles([]);
    setBankName("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!upload.isPending ? onOpenChange(o) : null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" /> Cargar estado de cuenta / movimientos
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Sube el estado de cuenta (PDF), la exportación de movimientos (Excel/CSV) o una foto.
          Kawiil AI desglosará los movimientos uno por uno para que los revises y concilies.
        </p>

        <div className="space-y-1">
          <Label className="text-xs">Banco (opcional)</Label>
          <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Ej. BBVA, Banorte…" className="h-9" />
        </div>

        <FileDropzone
          files={files}
          onChange={setFiles}
          limits={bankStatementLimits}
          variant="area"
          hint="Arrastra el archivo o haz click"
          subhint="PDF, Excel, CSV o imagen"
          showSize
        />

        {upload.isPending && (
          <div className="flex items-center gap-2 rounded-lg border border-sky-200/60 bg-sky-50/60 px-3 py-2 text-xs text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Procesando con IA… esto puede tardar hasta un minuto.
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={upload.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleUpload} disabled={files.length === 0 || upload.isPending}>
            {upload.isPending ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Procesando…</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-1" /> Procesar con IA</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
