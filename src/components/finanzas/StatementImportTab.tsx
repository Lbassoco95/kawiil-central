import { useMemo, useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccountDialog } from "./AccountDialog";
import { analyzeTable, parseWithMapping, readStatementRows, type ColKey, type ColumnMapping } from "@/lib/finance/bankImport";
import { suggestCategory } from "@/lib/finance/classifier";
import {
  useFinanceAccounts, useFinanceCategories, useImportMovements, useRuleIndex, useSaveImportProfile,
} from "@/hooks/useFinanceBank";

const FIELDS: { key: ColKey; label: string; required?: boolean }[] = [
  { key: "date", label: "Fecha", required: true },
  { key: "description", label: "Descripción", required: true },
  { key: "reference", label: "Referencia" },
  { key: "debit", label: "Cargo (retiros)" },
  { key: "credit", label: "Abono (depósitos)" },
  { key: "amount", label: "Monto con signo (si no hay cargo/abono)" },
  { key: "balance", label: "Saldo" },
  { key: "observation", label: "Observación" },
];
const colName = (i: number, headers: string[]) => `${String.fromCharCode(65 + (i % 26))} · ${headers[i]?.trim() || "(sin título)"}`;
const money = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });

/** Carga del estado de cuenta tal como lo emite el banco (CSV/Excel), con mapeo de columnas que se recuerda por cuenta. */
export function StatementImportTab() {
  const { data: accounts = [] } = useFinanceAccounts();
  const { categories } = useFinanceCategories();
  const ruleIndex = useRuleIndex();
  const importMut = useImportMovements();
  const saveProfile = useSaveImportProfile();
  const fileRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState<unknown[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [detected, setDetected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  const account = accounts.find((a) => a.id === accountId);
  const headers = useMemo(() => (rows[headerRow] ?? []).map((c) => String(c ?? "")), [rows, headerRow]);
  const parsed = useMemo(() => (rows.length ? parseWithMapping(rows, mapping, headerRow) : null), [rows, mapping, headerRow]);

  async function onFile(file: File) {
    setBusy(true); setResult("");
    try {
      const r = await readStatementRows(file);
      if (r.length < 2) { toast.error("El archivo está vacío o no tiene filas de datos."); return; }
      const saved = account?.import_profile ? { headerRow: account.import_profile.headerRow, mapping: account.import_profile.mapping as ColumnMapping } : null;
      const a = analyzeTable(r, saved);
      setRows(r); setFilename(file.name); setHeaderRow(a.headerRow); setMapping(a.mapping); setDetected(a.detected);
    } catch (e) { toast.error(`No se pudo leer el archivo: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const setCol = (key: ColKey, v: string) => setMapping((m) => {
    const next = { ...m }; if (v === "__none") delete next[key]; else next[key] = Number(v); return next;
  });

  async function run() {
    if (!parsed || !account) return;
    setBusy(true);
    try {
      const res = await importMut.mutateAsync({
        accountId: account.id, source: "excel", filename, movements: parsed.movements, knownCategories: categories,
        detectEntities: !account.counts_as_available, suggest: (m) => suggestCategory(m, ruleIndex),
      });
      await saveProfile.mutateAsync({ accountId: account.id, profile: { headerRow, mapping: mapping as Record<string, number>, headers } });
      setResult(`${res.added} movimientos nuevos, ${res.duplicates} ya existían, ${res.pending} por clasificar. El mapeo quedó guardado para ${account.name}.`);
      setRows([]); setFilename("");
    } finally { setBusy(false); }
  }

  const range = parsed ? [parsed.movements[0].date, parsed.movements[parsed.movements.length - 1].date] : null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Sube el CSV o Excel que descargas del banco, tal cual. Se detectan las columnas; si no las reconoce, indícalas una vez y se recuerdan para esa cuenta.
        El PDF todavía no se lee.
      </p>
      <div className="flex gap-2">
        <Select value={accountId} onValueChange={(v) => { setAccountId(v); setRows([]); setResult(""); }}>
          <SelectTrigger className="h-9"><SelectValue placeholder={accounts.length ? "¿De qué cuenta es el estado de cuenta?" : "Aún no hay cuentas: crea la primera →"} /></SelectTrigger>
          <SelectContent>{accounts.filter((a) => a.is_active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" variant="outline" className="h-9 shrink-0" onClick={() => setAccountOpen(true)}>+ Nueva cuenta</Button>
      </div>
      <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
      <Button variant="outline" disabled={!account || busy} onClick={() => fileRef.current?.click()} className="w-full h-16 border-dashed">
        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
        {filename ? `Archivo: ${filename} (cambiar)` : account ? "Elegir estado de cuenta (.csv, .xlsx)" : "Primero elige la cuenta"}
      </Button>

      {rows.length > 0 && (
        <div className="space-y-3 rounded-xl border border-border/60 p-3">
          <p className="text-xs font-medium">{detected ? "Detecté las columnas. Revísalas:" : "No reconocí el encabezado: indica qué columna es cada dato."}</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <div>
              <Label className="text-[11px]">Fila del encabezado</Label>
              <Select value={String(headerRow)} onValueChange={(v) => setHeaderRow(Number(v))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{Array.from({ length: Math.min(rows.length, 20) }, (_, i) => <SelectItem key={i} value={String(i)}>Fila {i + 1}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {FIELDS.map((f) => (
              <div key={f.key}>
                <Label className="text-[11px]">{f.label}{f.required && " *"}</Label>
                <Select value={mapping[f.key] === undefined ? "__none" : String(mapping[f.key])} onValueChange={(v) => setCol(f.key, v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— ninguna —</SelectItem>
                    {headers.map((_, i) => <SelectItem key={i} value={String(i)}>{colName(i, headers)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          {parsed ? (
            <>
              <p className="text-xs text-muted-foreground">
                {parsed.movements.length} movimientos · {range![0]} → {range![1]}
                {parsed.skippedRows > 0 && ` · ${parsed.skippedRows} filas ignoradas`}
              </p>
              <div className="rounded-lg border border-border/50 overflow-hidden">
                <Table>
                  <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead className="text-right">Cargo</TableHead><TableHead className="text-right">Abono</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {parsed.movements.slice(0, 5).map((m) => (
                      <TableRow key={m.dedupeKey}>
                        <TableCell className="text-xs">{m.date}</TableCell>
                        <TableCell className="text-xs max-w-[260px] truncate">{m.description}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{m.debit ? money(m.debit) : ""}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{m.credit ? money(m.credit) : ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : <p className="text-xs text-amber-600">Falta indicar al menos Fecha, Descripción y Cargo/Abono (o Monto) para leer movimientos.</p>}
          <Button className="w-full" disabled={!parsed || busy} onClick={run}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Cargar estado de cuenta
          </Button>
        </div>
      )}
      {result && <p className="flex items-center gap-2 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200/60 p-3 text-sm"><CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />{result}</p>}
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} onCreated={(a) => setAccountId(a.id)} />
    </div>
  );
}
