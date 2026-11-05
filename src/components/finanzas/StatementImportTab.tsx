import { useMemo, useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccountDialog } from "./AccountDialog";
import { analyzeTable, parseWithMapping, readStatementRows, type ColKey, type ColumnMapping } from "@/lib/finance/bankImport";
import { suggestCategory } from "@/lib/finance/classifier";
import { parsePdfStatement, type PdfStatementResult } from "@/lib/finance/pdfStatement";
import { extractFromScreenshots, shotRowsToMovements, type ShotRow } from "@/lib/finance/screenshotImport";
import { Input } from "@/components/ui/input";
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
  const [pdf, setPdf] = useState<PdfStatementResult | null>(null);
  const [shotRows, setShotRows] = useState<ShotRow[]>([]);
  const [shotNotes, setShotNotes] = useState<string | null>(null);
  const shotMovements = useMemo(() => shotRowsToMovements(shotRows), [shotRows]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  const account = accounts.find((a) => a.id === accountId);
  const headers = useMemo(() => (rows[headerRow] ?? []).map((c) => String(c ?? "")), [rows, headerRow]);
  const parsed = useMemo(() => (pdf ? pdf.sheet : rows.length ? parseWithMapping(rows, mapping, headerRow) : null), [pdf, rows, mapping, headerRow]);

  const IMAGE = /\.(png|jpe?g|webp|heic|heif)$/i;
  async function onFiles(files: File[]) {
    if (files.length && files.every((f) => IMAGE.test(f.name) || f.type.startsWith("image/"))) return onShots(files);
    return onFile(files[0]);
  }

  async function onShots(files: File[]) {
    setBusy(true); setResult(""); setPdf(null); setRows([]); setShotRows([]); setShotNotes(null);
    try {
      const res = await extractFromScreenshots(files);
      setFilename(files.length === 1 ? files[0].name : `${files.length} capturas`);
      setShotRows(res.rows); setShotNotes(res.notes);
      if (res.rows.length === 0) toast.error("No encontré movimientos en la captura.");
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  const editShot = (id: string, patch: Partial<ShotRow>) => setShotRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, uncertain: patch.date !== undefined || patch.debit !== undefined || patch.credit !== undefined ? false : r.uncertain } : r)));

  async function onFile(file: File) {
    setBusy(true); setResult(""); setPdf(null); setShotRows([]); setShotNotes(null);
    try {
      if (/\.pdf$/i.test(file.name)) {
        const res = await parsePdfStatement(file);
        setRows([]); setFilename(file.name); setPdf(res);
        if (!res.sheet) toast.error(res.warnings[0] ?? "No pude leer el PDF.");
        return;
      }
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

  async function runShots() {
    if (!account || shotMovements.length === 0) return;
    setBusy(true);
    try {
      const res = await importMut.mutateAsync({
        accountId: account.id, source: "pegado", filename, movements: shotMovements, knownCategories: categories,
        detectEntities: !account.counts_as_available, suggest: (m) => suggestCategory(m, ruleIndex),
      });
      setResult(`${res.added} movimientos nuevos, ${res.duplicates} ya existían (mismo día e importe), ${res.pending} por clasificar.`);
      setShotRows([]); setFilename(""); setShotNotes(null);
    } finally { setBusy(false); }
  }

  async function run() {
    if (!parsed || !account) return;
    setBusy(true);
    try {
      const res = await importMut.mutateAsync({
        accountId: account.id, source: "excel", filename, movements: parsed.movements, openingBalance: parsed.openingBalance, knownCategories: categories,
        detectEntities: !account.counts_as_available, suggest: (m) => suggestCategory(m, ruleIndex),
      });
      if (!pdf) await saveProfile.mutateAsync({ accountId: account.id, profile: { headerRow, mapping: mapping as Record<string, number>, headers } });
      setResult(`${res.added} movimientos nuevos, ${res.duplicates} ya existían, ${res.pending} por clasificar.${pdf ? "" : ` El mapeo quedó guardado para ${account.name}.`}`);
      setRows([]); setFilename(""); setPdf(null);
    } finally { setBusy(false); }
  }

  const range = parsed ? [parsed.movements[0].date, parsed.movements[parsed.movements.length - 1].date] : null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Sube el CSV o Excel que descargas del banco, tal cual. Se detectan las columnas; si no las reconoce, indícalas una vez y se recuerdan para esa cuenta.
        También acepta PDF (se comprueba que los saldos cuadren) y capturas de pantalla (hasta 4, leídas con IA); revisa siempre la vista previa.
      </p>
      <div className="flex gap-2">
        <Select value={accountId} onValueChange={(v) => { setAccountId(v); setRows([]); setPdf(null); setResult(""); }}>
          <SelectTrigger className="h-9"><SelectValue placeholder={accounts.length ? "¿De qué cuenta es el estado de cuenta?" : "Aún no hay cuentas: crea la primera →"} /></SelectTrigger>
          <SelectContent>{accounts.filter((a) => a.is_active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" variant="outline" className="h-9 shrink-0" onClick={() => setAccountOpen(true)}>+ Nueva cuenta</Button>
      </div>
      <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.heic,image/*" multiple className="hidden"
        onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) void onFiles(fs); e.target.value = ""; }} />
      <Button variant="outline" disabled={!account || busy} onClick={() => fileRef.current?.click()} className="w-full h-16 border-dashed">
        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
        {filename ? `Archivo: ${filename} (cambiar)` : account ? "Elegir estado de cuenta o captura (.pdf, .csv, .xlsx, imagen)" : "Primero elige la cuenta"}
      </Button>

      {shotRows.length > 0 && (
        <div className="space-y-3 rounded-xl border border-border/60 p-3">
          <p className="text-xs font-medium">Leí {shotRows.length} renglones de la captura. Revisa y corrige cada uno antes de cargar.</p>
          <p className="text-[11px] text-muted-foreground">La imagen se envía a Anthropic (Claude) para leerla; no se guarda en Kawiil. Los renglones en ámbar tienen algún dato dudoso o sin fecha.</p>
          {shotNotes && <p className="text-xs text-amber-600">{shotNotes}</p>}
          <div className="max-h-80 overflow-auto rounded-lg border border-border/50">
            <Table>
              <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead className="text-right">Cargo</TableHead><TableHead className="text-right">Abono</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {shotRows.map((r) => (
                  <TableRow key={r.id} className={r.uncertain || !r.date ? "bg-amber-50 dark:bg-amber-950/20" : ""}>
                    <TableCell className="w-36"><Input type="date" className="h-8 text-xs" value={r.date ?? ""} onChange={(e) => editShot(r.id, { date: e.target.value || null })} /></TableCell>
                    <TableCell><Input className="h-8 text-xs" value={r.description} onChange={(e) => editShot(r.id, { description: e.target.value })} /></TableCell>
                    <TableCell className="w-28"><Input type="number" step="0.01" min="0" className="h-8 text-right text-xs" value={r.debit || ""} onChange={(e) => editShot(r.id, { debit: Number(e.target.value) || 0 })} /></TableCell>
                    <TableCell className="w-28"><Input type="number" step="0.01" min="0" className="h-8 text-right text-xs" value={r.credit || ""} onChange={(e) => editShot(r.id, { credit: Number(e.target.value) || 0 })} /></TableCell>
                    <TableCell className="w-8"><button type="button" aria-label="Quitar renglón" className="text-muted-foreground hover:text-foreground" onClick={() => setShotRows((rs) => rs.filter((x) => x.id !== r.id))}><X className="h-4 w-4" /></button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {shotMovements.length < shotRows.length && <p className="text-xs text-amber-600">{shotRows.length - shotMovements.length} renglones sin fecha o sin importe no se cargarán hasta que los completes.</p>}
          <Button className="w-full" disabled={busy || shotMovements.length === 0} onClick={runShots}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Cargar {shotMovements.length} movimientos
          </Button>
        </div>
      )}

      {pdf && (
        <div className="space-y-3 rounded-xl border border-border/60 p-3">
          {parsed ? (
            <>
              <p className="text-xs">
                Leí <b>{parsed.movements.length}</b> movimientos del PDF ({parsed.movements[0].date} → {parsed.movements[parsed.movements.length - 1].date})
                {parsed.openingBalance != null && <> · saldo inicial {money(parsed.openingBalance)}</>}
                {pdf.finalBalance != null && <> · saldo final {money(pdf.finalBalance)}</>}.
              </p>
              <p className={`text-xs font-medium ${pdf.checked > 0 && pdf.chainOk === pdf.checked ? "text-green-700" : "text-amber-600"}`}>
                {pdf.checked > 0 ? `El saldo cuadra en ${pdf.chainOk} de ${pdf.checked} renglones` : "No se pudo comprobar el saldo"}
                {pdf.mode === "columnas" ? " · cargos y abonos por columna" : pdf.mode === "saldo" ? " · cargos y abonos por cambio de saldo" : ""}
                {pdf.finalOk === true && " · el último saldo coincide con el saldo final del PDF"}
              </p>
              {pdf.warnings.map((w) => <p key={w} className="text-xs text-amber-600">{w}</p>)}
              <div className="rounded-lg border border-border/50 overflow-hidden">
                <Table>
                  <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead className="text-right">Cargo</TableHead><TableHead className="text-right">Abono</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {[...parsed.movements.slice(0, 5), ...(parsed.movements.length > 8 ? parsed.movements.slice(-3) : parsed.movements.slice(5))].map((m) => (
                      <TableRow key={m.dedupeKey}>
                        <TableCell className="text-xs">{m.date}</TableCell>
                        <TableCell className="text-xs max-w-[260px] truncate" title={m.description}>{m.description}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{m.debit ? money(m.debit) : ""}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{m.credit ? money(m.credit) : ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button className="w-full" disabled={busy} onClick={run}>
                {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Cargar {parsed.movements.length} movimientos
              </Button>
            </>
          ) : <p className="text-xs text-amber-600">{pdf.warnings[0]}</p>}
        </div>
      )}

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
