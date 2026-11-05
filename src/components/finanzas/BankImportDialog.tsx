import { useMemo, useRef, useState } from "react";
import { FileSpreadsheet, ClipboardPaste, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  parseBankWorkbook, parsePastedMovements, suggestAccountName, type ParsedSheet,
} from "@/lib/finance/bankImport";
import { categoryFromReference, suggestCategory } from "@/lib/finance/classifier";
import {
  useCreateAccount, useFinanceAccounts, useFinanceCategories, useImportMovements, useRuleIndex,
} from "@/hooks/useFinanceBank";

interface SheetChoice {
  sheet: ParsedSheet;
  include: boolean;
  accountName: string;
  thirdParty: boolean;
  useReference: boolean;
}

const money = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const looksIrrelevant = (name: string) => /navidad|apuntes|control/i.test(name);

export function BankImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: accounts = [] } = useFinanceAccounts();
  const { categories } = useFinanceCategories();
  const ruleIndex = useRuleIndex();
  const createAccount = useCreateAccount();
  const importMut = useImportMovements();
  const fileRef = useRef<HTMLInputElement>(null);

  const [choices, setChoices] = useState<SheetChoice[]>([]);
  const [filename, setFilename] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteAccountId, setPasteAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string[]>([]);

  const reset = () => { setChoices([]); setFilename(""); setPasteText(""); setSummary([]); };

  async function onFile(file: File) {
    setBusy(true); setSummary([]);
    try {
      const sheets = await parseBankWorkbook(file);
      if (sheets.length === 0) { toast.error("No encontré hojas con Fecha, Descripción y Cargo/Abono."); return; }
      setFilename(file.name);
      setChoices(sheets.map((sheet) => {
        const labeled = sheet.movements.filter((m) => categoryFromReference(m.reference)).length;
        return {
          sheet, include: !looksIrrelevant(sheet.sheetName) && sheet.movements.length >= 10,
          accountName: suggestAccountName(sheet.sheetName), thirdParty: false,
          useReference: labeled / sheet.movements.length >= 0.2,
        };
      }));
    } catch (e) {
      toast.error(`No se pudo leer el archivo: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  const update = (i: number, patch: Partial<SheetChoice>) =>
    setChoices((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  async function run(items: { sheet: ParsedSheet; accountId: string; useReference: boolean }[], source: "excel" | "pegado") {
    const lines: string[] = [];
    for (const it of items) {
      const res = await importMut.mutateAsync({
        accountId: it.accountId, source, filename: source === "excel" ? filename : undefined,
        movements: it.sheet.movements.map((m) => ({ ...m, category: it.useReference ? categoryFromReference(m.reference) : null })),
        openingBalance: it.sheet.openingBalance, knownCategories: categories,
        suggest: (m) => suggestCategory(m, ruleIndex),
      });
      lines.push(`${it.sheet.sheetName}: ${res.added} nuevos, ${res.duplicates} ya existían, ${res.pending} por clasificar`);
    }
    setSummary(lines);
  }

  async function importExcel() {
    setBusy(true);
    try {
      const items: { sheet: ParsedSheet; accountId: string; useReference: boolean }[] = [];
      for (const c of choices.filter((x) => x.include)) {
        const existing = accounts.find((a) => a.name.toLowerCase() === c.accountName.trim().toLowerCase());
        const acc = existing ?? (await createAccount.mutateAsync({
          name: c.accountName.trim(), kind: "banco", opening_balance: 0, counts_as_available: !c.thirdParty,
        }));
        items.push({ sheet: c.sheet, accountId: acc.id, useReference: c.useReference });
      }
      await run(items, "excel");
      setChoices([]);
    } finally { setBusy(false); }
  }

  async function importPaste() {
    const sheet = parsePastedMovements(pasteText);
    if (!sheet) { toast.error("No pude leer los movimientos. Copia las columnas Fecha, Descripción, Cargo y Abono."); return; }
    if (!pasteAccountId) { toast.error("Elige la cuenta destino."); return; }
    setBusy(true);
    try { await run([{ sheet, accountId: pasteAccountId, useReference: false }], "pegado"); setPasteText(""); }
    finally { setBusy(false); }
  }

  const pastePreview = useMemo(() => (pasteText.trim() ? parsePastedMovements(pasteText) : null), [pasteText]);
  const included = choices.filter((c) => c.include);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cargar movimientos de bancos</DialogTitle>
          <DialogDescription>
            Sube el Excel actualizado de contabilidad o pega los movimientos del día. Lo que ya está cargado se detecta y no se duplica.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="excel">
          <TabsList>
            <TabsTrigger value="excel" className="gap-1.5 text-xs"><FileSpreadsheet className="h-3.5 w-3.5" /> Excel contable</TabsTrigger>
            <TabsTrigger value="pegar" className="gap-1.5 text-xs"><ClipboardPaste className="h-3.5 w-3.5" /> Pegar movimientos</TabsTrigger>
          </TabsList>

          <TabsContent value="excel" className="space-y-4">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy} className="w-full h-20 border-dashed">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
              {filename ? `Archivo: ${filename} (cambiar)` : "Elegir archivo Excel (.xlsx)"}
            </Button>

            {choices.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Detecté estas hojas con movimientos. Marca las que quieres cargar y a qué cuenta pertenecen.</p>
                {choices.map((c, i) => {
                  const dates = c.sheet.movements.map((m) => m.date).sort();
                  return (
                    <div key={c.sheet.sheetName} className="rounded-xl border border-border/60 p-3 space-y-2">
                      <div className="flex items-center gap-3">
                        <Checkbox checked={c.include} onCheckedChange={(v) => update(i, { include: !!v })} />
                        <Input value={c.accountName} onChange={(e) => update(i, { accountName: e.target.value })} className="h-8 max-w-[220px]" />
                        <span className="text-xs text-muted-foreground">
                          {c.sheet.movements.length} movimientos · {dates[0]} → {dates[dates.length - 1]}
                          {c.sheet.openingBalance != null && ` · saldo inicial ${money(c.sheet.openingBalance)}`}
                        </span>
                      </div>
                      {c.include && (
                        <div className="flex flex-wrap gap-x-6 gap-y-1 pl-7">
                          <Label className="flex items-center gap-2 text-xs font-normal">
                            <Checkbox checked={c.useReference} onCheckedChange={(v) => update(i, { useReference: !!v })} />
                            Tomar la columna «Referencia» como categoría (ya clasificada por contabilidad) y aprender de ella
                          </Label>
                          <Label className="flex items-center gap-2 text-xs font-normal">
                            <Checkbox checked={c.thirdParty} onCheckedChange={(v) => update(i, { thirdParty: !!v })} />
                            Es dinero de terceros (no suma a disponible)
                          </Label>
                        </div>
                      )}
                    </div>
                  );
                })}
                <Button onClick={importExcel} disabled={busy || included.length === 0} className="w-full">
                  {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Cargar {included.length} {included.length === 1 ? "hoja" : "hojas"}
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="pegar" className="space-y-3">
            <Select value={pasteAccountId} onValueChange={setPasteAccountId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Cuenta destino (ej. Fondeadora)" /></SelectTrigger>
              <SelectContent>
                {accounts.filter((a) => a.is_active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Textarea
              value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={8}
              placeholder={"Pega aquí desde la app del banco o desde Excel:\nFecha\tDescripción\tReferencia\tCargo\tAbono\tSaldo\n04 de nov 2026\tCompra en DLO*UBER RIDES\t\t119.91\t\t36267.60"}
              className="font-mono text-xs"
            />
            {pastePreview && (
              <p className="text-xs text-muted-foreground">
                Leí {pastePreview.movements.length} movimientos
                {pastePreview.skippedRows > 0 && ` (${pastePreview.skippedRows} filas ignoradas)`}.
              </p>
            )}
            <Button onClick={importPaste} disabled={busy || !pastePreview} className="w-full">
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Cargar movimientos pegados
            </Button>
            {accounts.length === 0 && <p className="text-xs text-muted-foreground">Primero carga el Excel para crear tus cuentas.</p>}
          </TabsContent>
        </Tabs>

        {summary.length > 0 && (
          <div className="rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200/60 p-3 text-sm space-y-1">
            {summary.map((l) => <p key={l} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" />{l}</p>)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
