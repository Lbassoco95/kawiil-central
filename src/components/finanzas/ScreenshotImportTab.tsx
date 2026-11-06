import { useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccountDialog } from "./AccountDialog";
import { CategoryPicker } from "./CategoryPicker";
import { suggestCategory } from "@/lib/finance/classifier";
import { extractFromScreenshots, shotRowsToMovements, type ShotRow } from "@/lib/finance/screenshotImport";
import { useFinanceAccounts, useFinanceCategories, useImportMovements, useRuleIndex } from "@/hooks/useFinanceBank";

/**
 * Registro diario desde una captura de pantalla de la app del banco: se lee, se clasifica cada gasto
 * y queda como «registrado». Cuando llegue el estado de cuenta, el banco lo confirma (conciliación).
 */
export function ScreenshotImportTab() {
  const { data: accounts = [] } = useFinanceAccounts();
  const { categories } = useFinanceCategories();
  const ruleIndex = useRuleIndex();
  const importMut = useImportMovements();
  const fileRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [rows, setRows] = useState<ShotRow[]>([]);
  const [notes, setNotes] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  const account = accounts.find((a) => a.id === accountId);
  const movements = useMemo(() => shotRowsToMovements(rows), [rows]);

  async function onFiles(files: File[]) {
    setBusy(true); setResult(""); setRows([]); setNotes(null);
    try {
      const res = await extractFromScreenshots(files);
      // Sugerencia de categoría con lo que el sistema ya aprendió.
      const withSug = res.rows.map((r): ShotRow => {
        const s = r.date ? suggestCategory({ description: r.description, debit: r.debit, credit: r.credit }, ruleIndex) : null;
        return s && s.confidence >= 0.5 ? { ...r, category: s.category, categorySource: "sugerida" } : r;
      });
      setRows(withSug); setNotes(res.notes); setFilename(files.length === 1 ? files[0].name : `${files.length} capturas`);
      if (res.rows.length === 0) toast.error("No encontré movimientos en la captura.");
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  const edit = (id: string, patch: Partial<ShotRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, uncertain: patch.date !== undefined || patch.debit !== undefined || patch.credit !== undefined ? false : r.uncertain } : r)));

  async function run() {
    if (!account || movements.length === 0) return;
    setBusy(true);
    try {
      const res = await importMut.mutateAsync({
        accountId: account.id, origin: "captura", filename,
        movements: movements.map((m) => ({ ...m, category: m.meta?.category ?? null, categorySource: m.meta?.categorySource })),
        knownCategories: categories, detectEntities: !account.counts_as_available, suggest: (m) => suggestCategory(m, ruleIndex),
      });
      setResult(`${res.added} movimientos registrados${res.linkedToBank ? `, ${res.linkedToBank} ya los tenía el banco (se les pasó la clasificación)` : ""}${res.duplicates - res.linkedToBank > 0 ? `, ${res.duplicates - res.linkedToBank} ya estaban registrados` : ""}, ${res.pending} sin categoría. Quedan pendientes de que el estado de cuenta los confirme.`);
      setRows([]); setFilename(""); setNotes(null);
    } finally { setBusy(false); }
  }

  const unclassified = movements.filter((m) => !m.meta?.category).length;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Sube hasta 4 capturas de movimientos de la app del banco. Se leen con IA, tú asignas de qué es cada gasto y queda registrado.
        Cuando cargues el estado de cuenta del banco, se compara contra lo que registraste aquí.
      </p>
      <div className="flex gap-2">
        <Select value={accountId} onValueChange={(v) => { setAccountId(v); setResult(""); }}>
          <SelectTrigger className="h-9"><SelectValue placeholder={accounts.length ? "¿De qué cuenta es la captura?" : "Aún no hay cuentas: crea la primera →"} /></SelectTrigger>
          <SelectContent>{accounts.filter((a) => a.is_active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" variant="outline" className="h-9 shrink-0" onClick={() => setAccountOpen(true)}>+ Nueva cuenta</Button>
      </div>
      <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp,.heic,.heif,image/*" multiple className="hidden"
        onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) void onFiles(fs); e.target.value = ""; }} />
      <Button variant="outline" disabled={!account || busy} onClick={() => fileRef.current?.click()} className="w-full h-16 border-dashed">
        {busy && rows.length === 0 ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Camera className="h-4 w-4 mr-2" />}
        {busy && rows.length === 0 ? "Leyendo la captura…" : account ? "Elegir captura(s) de pantalla" : "Primero elige la cuenta"}
      </Button>

      {rows.length > 0 && (
        <div className="space-y-3 rounded-xl border border-border/60 p-3">
          <p className="text-xs font-medium">Leí {rows.length} renglones. Revisa, corrige y asigna la categoría de cada gasto.</p>
          <p className="text-[11px] text-muted-foreground">La imagen se envía a Anthropic (Claude) para leerla; no se guarda en Kawiil. En ámbar: datos dudosos o sin fecha. Las categorías con ✨ son sugerencias de lo que ya aprendió el sistema.</p>
          {notes && <p className="text-xs text-amber-600">{notes}</p>}
          <div className="max-h-80 overflow-auto rounded-lg border border-border/50">
            <Table>
              <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead className="text-right">Cargo</TableHead><TableHead className="text-right">Abono</TableHead><TableHead>Categoría</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className={r.uncertain || !r.date ? "bg-amber-50 dark:bg-amber-950/20" : ""}>
                    <TableCell className="w-32"><Input type="date" className="h-8 text-xs" value={r.date ?? ""} onChange={(e) => edit(r.id, { date: e.target.value || null })} /></TableCell>
                    <TableCell><Input className="h-8 min-w-[140px] text-xs" value={r.description} onChange={(e) => edit(r.id, { description: e.target.value })} /></TableCell>
                    <TableCell className="w-24"><Input type="number" step="0.01" min="0" className="h-8 text-right text-xs" value={r.debit || ""} onChange={(e) => edit(r.id, { debit: Number(e.target.value) || 0 })} /></TableCell>
                    <TableCell className="w-24"><Input type="number" step="0.01" min="0" className="h-8 text-right text-xs" value={r.credit || ""} onChange={(e) => edit(r.id, { credit: Number(e.target.value) || 0 })} /></TableCell>
                    <TableCell className="w-44">
                      <div className="flex items-center gap-1">
                        {r.categorySource === "sugerida" && <span title="Sugerida por lo que ya aprendió el sistema">✨</span>}
                        <CategoryPicker value={r.category ?? ""} className="w-36" onChange={(category) => edit(r.id, { category, categorySource: "manual" })} />
                      </div>
                    </TableCell>
                    <TableCell className="w-8"><button type="button" aria-label="Quitar renglón" className="text-muted-foreground hover:text-foreground" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}><X className="h-4 w-4" /></button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {movements.length < rows.length && <p className="text-xs text-amber-600">{rows.length - movements.length} renglones sin fecha o sin importe no se cargarán hasta que los completes.</p>}
          {unclassified > 0 && <p className="text-xs text-muted-foreground">{unclassified} sin categoría: quedarán en «Por clasificar».</p>}
          <Button className="w-full" disabled={busy || movements.length === 0} onClick={run}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Registrar {movements.length} movimientos
          </Button>
        </div>
      )}
      {result && <p className="flex items-start gap-2 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200/60 p-3 text-sm"><CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />{result}</p>}
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} onCreated={(a) => setAccountId(a.id)} />
    </div>
  );
}
