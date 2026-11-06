import { useMemo, useRef, useState } from "react";
import { Camera, FileSpreadsheet, ClipboardPaste, Loader2, CheckCircle2 } from "lucide-react";
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
  parseBankBuffer, parsePastedMovements, suggestAccountName, type ParsedSheet,
} from "@/lib/finance/bankImport";
import { COMMITMENT_KIND_LABEL, parseCommitmentsBuffer, type CommitmentKind, type ParsedCommitment } from "@/lib/finance/commitmentImport";
import { AccountDialog } from "./AccountDialog";
import { StatementImportTab } from "./StatementImportTab";
import { ScreenshotImportTab } from "./ScreenshotImportTab";
import { categoryFromReference, suggestCategory } from "@/lib/finance/classifier";
import {
  useCreateAccount, useFinanceAccounts, useFinanceCategories, useImportCommitments, useImportMovements, useRuleIndex,
} from "@/hooks/useFinanceBank";

interface SheetChoice {
  sheet: ParsedSheet;
  include: boolean;
  accountName: string;
  thirdParty: boolean;
  /** Si es dinero de terceros: cuenta bancaria donde está depositado (sub-libro). */
  parentName: string;
  useReference: boolean;
}

const money = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const looksIrrelevant = (name: string) => /navidad|apuntes|control/i.test(name);
/** Hojas de tesorería de terceros conocidas (impuestos de clientes) y banco donde viven. */
const THIRD_PARTY_SHEET = /gonzalo|pcr|nuup/i;

export function BankImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: accounts = [] } = useFinanceAccounts();
  const { categories } = useFinanceCategories();
  const ruleIndex = useRuleIndex();
  const createAccount = useCreateAccount();
  const importMut = useImportMovements();
  const importCommitments = useImportCommitments();
  const [commitments, setCommitments] = useState<ParsedCommitment[]>([]);
  const [commitKinds, setCommitKinds] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  const [choices, setChoices] = useState<SheetChoice[]>([]);
  const [filename, setFilename] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteAccountId, setPasteAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string[]>([]);

  const reset = () => { setChoices([]); setFilename(""); setPasteText(""); setSummary([]); setCommitments([]); setCommitKinds({}); };

  async function onFile(file: File) {
    setBusy(true); setSummary([]);
    try {
      const buf = await file.arrayBuffer();
      const sheets = parseBankBuffer(buf);
      const found = parseCommitmentsBuffer(buf);
      if (sheets.length === 0 && found.length === 0) { toast.error("No encontré hojas con Fecha, Descripción y Cargo/Abono."); return; }
      setFilename(file.name);
      const mainBank = sheets.find((x) => /banregio/i.test(x.sheetName) )?.sheetName ?? "";
      setChoices(sheets.map((sheet) => {
        const labeled = sheet.movements.filter((m) => categoryFromReference(m.reference)).length;
        const third = THIRD_PARTY_SHEET.test(sheet.sheetName);
        return {
          sheet, include: !looksIrrelevant(sheet.sheetName),
          accountName: suggestAccountName(sheet.sheetName), thirdParty: third,
          parentName: third ? mainBank : "",
          useReference: !third && labeled / sheet.movements.length >= 0.2,
        };
      }));
      setCommitments(found);
      setCommitKinds(Object.fromEntries([...new Set(found.map((c) => c.kind))].map((k) => [k, true])));
    } catch (e) {
      toast.error(`No se pudo leer el archivo: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  const update = (i: number, patch: Partial<SheetChoice>) =>
    setChoices((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  async function run(items: { sheet: ParsedSheet; accountId: string; useReference: boolean }[], origin: "pegado" | "contable") {
    const lines: string[] = [];
    for (const it of items) {
      const res = await importMut.mutateAsync({
        accountId: it.accountId, origin, filename: origin === "contable" ? filename : undefined,
        movements: it.sheet.movements.map((m) => ({ ...m, category: it.useReference ? categoryFromReference(m.reference) : null })),
        openingBalance: it.sheet.openingBalance, knownCategories: categories,
        suggest: (m) => suggestCategory(m, ruleIndex),
      });
      lines.push(`${it.sheet.sheetName}: ${res.added} nuevos, ${res.duplicates} ya existían${res.linkedToBank ? ` (${res.linkedToBank} ya los tenía el banco)` : ""}, ${res.pending} por clasificar`);
    }
    setSummary(lines);
  }

  async function importExcel() {
    setBusy(true);
    try {
      const picked = choices.filter((x) => x.include);
      const ids = new Map<string, string>();
      // Primero las cuentas (sin padre), luego se enlazan los sub-libros de terceros.
      for (const c of picked) {
        const name = c.accountName.trim();
        const existing = accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
        const acc = existing ?? (await createAccount.mutateAsync({ name, kind: "banco", opening_balance: 0, counts_as_available: !c.thirdParty }));
        ids.set(c.sheet.sheetName, acc.id);
      }
      for (const c of picked.filter((x) => x.thirdParty && x.parentName)) {
        const parent = picked.find((p) => p.accountName.trim() === c.parentName)?.sheet.sheetName;
        const parentId = parent ? ids.get(parent) : accounts.find((a) => a.name === c.parentName)?.id;
        if (parentId) await createAccount.mutateAsync({ name: c.accountName.trim(), kind: "banco", counts_as_available: false, parent_account_id: parentId });
      }
      const lines: string[] = [];
      for (const c of picked) {
        const res = await importMut.mutateAsync({
          accountId: ids.get(c.sheet.sheetName)!, origin: "contable", filename,
          movements: c.sheet.movements.map((m) => ({ ...m, category: c.useReference ? categoryFromReference(m.reference) : null })),
          openingBalance: c.sheet.openingBalance, knownCategories: categories, detectEntities: c.thirdParty,
          suggest: (m) => suggestCategory(m, ruleIndex),
        });
        lines.push(`${c.sheet.sheetName}: ${res.added} nuevos, ${res.duplicates} ya existían${res.linkedToBank ? ` (${res.linkedToBank} ya los tenía el banco y recibieron su clasificación)` : ""}${c.thirdParty ? "" : `, ${res.pending} por clasificar`}`);
      }
      const chosen = commitments.filter((c) => commitKinds[c.kind]);
      if (chosen.length) {
        const r = await importCommitments.mutateAsync(chosen);
        lines.push(`Compromisos: ${r.added} nuevos, ${r.existing} ya estaban${r.closed ? `, ${r.closed} marcados como pagados` : ""}`);
      }
      setSummary(lines);
      setChoices([]); setCommitments([]);
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
            <TabsTrigger value="estado" className="gap-1.5 text-xs"><FileSpreadsheet className="h-3.5 w-3.5" /> Estado de cuenta del banco</TabsTrigger>
            <TabsTrigger value="captura" className="gap-1.5 text-xs"><Camera className="h-3.5 w-3.5" /> Captura de pantalla</TabsTrigger>
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
                            Es dinero de terceros (impuestos de clientes; no suma a disponible)
                          </Label>
                          {c.thirdParty && (
                            <Label className="flex items-center gap-2 text-xs font-normal">
                              Depositado en la cuenta
                              <Select value={c.parentName || "__none"} onValueChange={(v) => update(i, { parentName: v === "__none" ? "" : v })}>
                                <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none">Cuenta propia</SelectItem>
                                  {choices.filter((o) => o !== c && !o.thirdParty).map((o) => <SelectItem key={o.sheet.sheetName} value={o.accountName.trim()}>{o.accountName}</SelectItem>)}
                                  {accounts.filter((a) => !a.parent_account_id).map((a) => <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </Label>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {commitments.length > 0 && (
                  <div className="rounded-xl border border-border/60 p-3 space-y-1.5">
                    <p className="text-xs font-medium">También encontré compromisos y cuentas por cobrar</p>
                    {(Object.keys(COMMITMENT_KIND_LABEL) as CommitmentKind[]).filter((k) => commitments.some((c) => c.kind === k)).map((k) => {
                      const list = commitments.filter((c) => c.kind === k);
                      return (
                        <Label key={k} className="flex items-center gap-2 text-xs font-normal">
                          <Checkbox checked={!!commitKinds[k]} onCheckedChange={(v) => setCommitKinds((o) => ({ ...o, [k]: !!v }))} />
                          {COMMITMENT_KIND_LABEL[k]}: {list.length} · {money(list.reduce((a, c) => a + c.amount, 0))}
                          {list.some((c) => c.status === "pagado") && ` (${list.filter((c) => c.status === "pagado").length} ya pagados)`}
                        </Label>
                      );
                    })}
                  </div>
                )}
                <Button onClick={importExcel} disabled={busy || (included.length === 0 && commitments.length === 0)} className="w-full">
                  {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Cargar {included.length} {included.length === 1 ? "hoja" : "hojas"}{commitments.length > 0 ? " y compromisos" : ""}
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="estado"><StatementImportTab /></TabsContent>

          <TabsContent value="captura"><ScreenshotImportTab /></TabsContent>

          <TabsContent value="pegar" className="space-y-3">
            <div className="flex gap-2">
              <Select value={pasteAccountId} onValueChange={setPasteAccountId}>
                <SelectTrigger className="h-9"><SelectValue placeholder={accounts.length ? "Cuenta destino (ej. Fondeadora)" : "Aún no hay cuentas: crea la primera →"} /></SelectTrigger>
                <SelectContent>
                  {accounts.filter((a) => a.is_active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" className="h-9 shrink-0" onClick={() => setAccountOpen(true)}>+ Nueva cuenta</Button>
            </div>
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
          </TabsContent>
        </Tabs>

        {summary.length > 0 && (
          <div className="rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200/60 p-3 text-sm space-y-1">
            {summary.map((l) => <p key={l} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" />{l}</p>)}
          </div>
        )}
      </DialogContent>
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} onCreated={(a) => setPasteAccountId(a.id)} />
    </Dialog>
  );
}
