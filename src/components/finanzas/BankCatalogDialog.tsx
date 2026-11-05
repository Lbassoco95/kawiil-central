import { useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { mergeBanks, parseBankList } from "@/lib/finance/banks";
import { useFinanceBanks, useImportBanks } from "@/hooks/useFinanceBank";

/** Catálogo de bancos: lista base + importación de la lista de Banxico (pegada o archivo) + alta manual. */
export function BankCatalogDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: stored = [] } = useFinanceBanks();
  const save = useImportBanks();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [one, setOne] = useState("");
  const banks = useMemo(() => mergeBanks(stored), [stored]);
  const preview = useMemo(() => (text.trim() ? parseBankList(text) : []), [text]);
  const shown = banks.filter((b) => !search || b.name.toLowerCase().includes(search.toLowerCase()) || (b.code ?? "").includes(search));

  async function onFile(file: File) {
    try {
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
        setText(XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: "\t" }));
      } else setText(await file.text());
    } catch (e) { toast.error(`No se pudo leer el archivo: ${(e as Error).message}`); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Catálogo de bancos</DialogTitle>
          <DialogDescription>
            {banks.length} instituciones disponibles. Para tener la lista oficial, copia la tabla de{" "}
            <a className="underline" href="https://www.banxico.org.mx/cep-scl/listaInstituciones.do" target="_blank" rel="noreferrer">Banxico</a>{" "}
            y pégala aquí (o sube un CSV/Excel). Las claves de 5 dígitos se guardan como clave CLABE de 3.
          </DialogDescription>
        </DialogHeader>
        <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
        <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs"
          placeholder={"Pega la lista: una institución por línea\n40012\tBBVA MEXICO\n90646\tSTP"} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5 mr-1.5" /> Subir archivo</Button>
          <Button size="sm" disabled={preview.length === 0 || save.isPending} onClick={() => save.mutate({ entries: preview, source: "banxico" }, { onSuccess: () => setText("") })}>
            Guardar {preview.length > 0 ? `${preview.length} instituciones` : "lista"}
          </Button>
          {preview.length > 0 && <span className="text-xs text-muted-foreground">{preview.filter((p) => p.code).length} con clave</span>}
        </div>
        <div className="flex gap-2">
          <Input className="h-8" placeholder="Agregar una institución que falte" value={one} onChange={(e) => setOne(e.target.value)} />
          <Button size="sm" variant="outline" disabled={!one.trim()} onClick={() => save.mutate({ entries: [{ name: one.trim(), code: null }], source: "manual" }, { onSuccess: () => setOne("") })}>Agregar</Button>
        </div>
        <Input className="h-8" placeholder="Buscar en el catálogo…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-56 overflow-y-auto rounded-xl border border-border/50 divide-y divide-border/40 text-xs">
          {shown.map((b) => <div key={b.name} className="flex justify-between px-3 py-1.5"><span>{b.name}</span><span className="text-muted-foreground">{b.code ?? ""}</span></div>)}
        </div>
      </DialogContent>
    </Dialog>
  );
}
