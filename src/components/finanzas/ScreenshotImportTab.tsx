import { useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AccountDialog } from "./AccountDialog";
import { CategoryPicker } from "./CategoryPicker";
import { suggestCategory } from "@/lib/finance/classifier";
import { extractFromScreenshots, shotRowsToMovements, type ShotRow } from "@/lib/finance/screenshotImport";
import { useFinanceAccounts, useFinanceCategories, useImportMovements, useRuleIndex } from "@/hooks/useFinanceBank";

/** Columnas de la fila en pantallas anchas (md+); en pantallas angostas cada renglón es una tarjeta. */
const COLS = "lg:grid-cols-[9rem_minmax(0,1fr)_7rem_7rem_13rem_2.5rem]";
const NO_SPIN = "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";


/** Revisión de los renglones leídos: tabla en pantallas anchas, tarjetas en el teléfono. */
export function ScreenshotReview({ rows, notes, validCount, unclassified, busy, onEdit, onRemove, onRun }: {
  rows: ShotRow[]; notes: string | null; validCount: number; unclassified: number; busy: boolean;
  onEdit: (id: string, patch: Partial<ShotRow>) => void; onRemove: (id: string) => void; onRun: () => void;
}) {
  return (
<div className="min-w-0 space-y-3 rounded-xl border border-border/60 p-3 sm:p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Leí {rows.length} renglones. Revisa, corrige y asigna la categoría de cada gasto.</p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              La imagen se envía a Anthropic (Claude) para leerla; no se guarda en Kawiil. Los renglones en ámbar tienen un dato dudoso o no traen fecha.
              Las categorías con ✨ son sugerencias de lo que ya aprendió el sistema.
            </p>
          </div>
          {notes && <p className="whitespace-pre-wrap break-words rounded-lg border border-amber-200/70 bg-amber-50 p-2.5 text-xs leading-snug text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">{notes}</p>}

          {/* Encabezados solo en pantallas anchas; en el teléfono cada renglón es una tarjeta con sus etiquetas. */}
          <div className={`hidden gap-2 px-2 text-[11px] font-medium text-muted-foreground lg:grid ${COLS}`}>
            <span>Fecha</span><span>Descripción</span><span className="text-right">Cargo</span><span className="text-right">Abono</span><span>Categoría</span><span />
          </div>
          <div className="space-y-2 pb-1">
            {rows.map((r) => (
              <div key={r.id} className={`grid grid-cols-4 items-start gap-x-2 gap-y-1.5 rounded-lg border p-2.5 lg:p-2 ${COLS} ${r.uncertain || !r.date ? "border-amber-300/70 bg-amber-50/70 dark:bg-amber-950/20" : "border-border/50"}`}>
                <div className="order-1 col-span-4 lg:order-2 lg:col-span-1">
                  <Label className="text-[11px] text-muted-foreground lg:sr-only">Descripción</Label>
                  <Textarea rows={2} className="min-h-0 resize-none py-1.5 text-xs leading-snug" value={r.description} onChange={(e) => onEdit(r.id, { description: e.target.value })} />
                </div>
                <div className="order-2 col-span-2 lg:order-1 lg:col-span-1">
                  <Label className="text-[11px] text-muted-foreground lg:sr-only">Fecha</Label>
                  <Input type="date" className="h-9 px-2 text-xs" value={r.date ?? ""} onChange={(e) => onEdit(r.id, { date: e.target.value || null })} />
                </div>
                <div className="order-3 lg:order-3">
                  <Label className="text-[11px] text-muted-foreground lg:sr-only">Cargo</Label>
                  <Input type="number" inputMode="decimal" step="0.01" min="0" className={`h-9 px-2 text-right text-xs ${NO_SPIN}`} value={r.debit || ""} onChange={(e) => onEdit(r.id, { debit: Number(e.target.value) || 0 })} />
                </div>
                <div className="order-4 lg:order-4">
                  <Label className="text-[11px] text-muted-foreground lg:sr-only">Abono</Label>
                  <Input type="number" inputMode="decimal" step="0.01" min="0" className={`h-9 px-2 text-right text-xs ${NO_SPIN}`} value={r.credit || ""} onChange={(e) => onEdit(r.id, { credit: Number(e.target.value) || 0 })} />
                </div>
                <div className="order-5 col-span-3 min-w-0 lg:order-5 lg:col-span-1">
                  <Label className="text-[11px] text-muted-foreground lg:sr-only">Categoría</Label>
                  <div className="flex items-center gap-1">
                    {r.categorySource === "sugerida" && <span title="Sugerida por lo que ya aprendió el sistema">✨</span>}
                    <CategoryPicker value={r.category ?? ""} className="h-9 w-full" onChange={(category) => onEdit(r.id, { category, categorySource: "manual" })} />
                  </div>
                </div>
                <div className="order-6 flex items-end justify-end self-end lg:order-6 lg:justify-center lg:self-center">
                  <button type="button" aria-label="Quitar renglón" className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => onRemove(r.id)}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Barra fija abajo: el botón siempre queda a la vista aunque la lista sea larga. */}
          <div className="sticky bottom-[-1rem] z-10 -mx-3 -mb-3 space-y-1.5 rounded-b-xl border-t bg-background p-3 shadow-[0_-6px_12px_-8px_rgba(0,0,0,0.15)] sm:bottom-[-1.5rem] sm:-mx-4 sm:-mb-4 sm:p-4">
            {(validCount < rows.length || unclassified > 0) && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {validCount < rows.length && <span className="text-amber-600">{rows.length - validCount} sin fecha o importe no se cargarán hasta completarlos. </span>}
                {unclassified > 0 && <span>{unclassified} sin categoría quedarán en «Por clasificar».</span>}
              </p>
            )}
            <Button className="h-10 w-full" disabled={busy || validCount === 0} onClick={onRun}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Registrar {validCount} movimientos
            </Button>
          </div>
        </div>
  );
}

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
        <ScreenshotReview
          rows={rows} notes={notes} validCount={movements.length} unclassified={unclassified} busy={busy}
          onEdit={edit} onRemove={(id) => setRows((rs) => rs.filter((x) => x.id !== id))} onRun={run}
        />
      )}
      {result && <p className="flex items-start gap-2 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200/60 p-3 text-sm"><CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />{result}</p>}
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} onCreated={(a) => setAccountId(a.id)} />
    </div>
  );
}
