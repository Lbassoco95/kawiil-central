import { useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Landmark, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategoryPicker } from "./CategoryPicker";
import { useClassifyMovements, useConfirmMovements, useDeleteMovements, type FinanceAccount, type FinanceMovement } from "@/hooks/useFinanceBank";
import { reconcileMonth, type ExistingMovement } from "@/lib/finance/reconcile";

const money = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthLabel = (k: string) => `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;
const originLabel: Record<string, string> = { contable: "Excel contable", captura: "Captura", pegado: "Pegado", manual: "Manual", banco: "Banco" };

const toExisting = (m: FinanceMovement): ExistingMovement => ({
  id: m.id, date: m.movement_date, debit: Number(m.debit), credit: Number(m.credit), origin: m.origin,
  bankConfirmed: !!m.bank_confirmed_at, hasRecord: m.has_record, category: m.category,
});

/** Conciliación mensual: lo registrado contra lo que confirma el estado de cuenta del banco. */
export function ReconciliationPanel({ accounts, movements }: { accounts: FinanceAccount[]; movements: FinanceMovement[] }) {
  const confirm = useConfirmMovements();
  const del = useDeleteMovements();
  const classify = useClassifyMovements();
  const [accountId, setAccountId] = useState("");
  const [month, setMonth] = useState("");
  const [toDelete, setToDelete] = useState<FinanceMovement | null>(null);

  const withData = useMemo(() => accounts.filter((a) => movements.some((m) => m.account_id === a.id)), [accounts, movements]);
  const account = withData.find((a) => a.id === accountId) ?? withData[0];
  const monthsAvail = useMemo(() => {
    if (!account) return [];
    return [...new Set(movements.filter((m) => m.account_id === account.id).map((m) => m.movement_date.slice(0, 7)))].sort().reverse();
  }, [account, movements]);
  const currentMonth = monthsAvail.includes(month) ? month : monthsAvail[0] ?? "";

  const items = useMemo(
    () => (account ? movements.filter((m) => m.account_id === account.id && m.movement_date.startsWith(currentMonth)) : []),
    [account, movements, currentMonth],
  );
  const rec = useMemo(() => reconcileMonth(items.map(toExisting)), [items]);
  const byId = useMemo(() => new Map(items.map((m) => [m.id, m])), [items]);
  const unconfirmed = rec.unconfirmed.map((e) => byId.get(e.id)!).filter(Boolean);
  const bankOnly = rec.bankOnly.map((e) => byId.get(e.id)!).filter(Boolean);
  const sum = (list: FinanceMovement[]) => list.reduce((s, m) => s + Number(m.credit) - Number(m.debit), 0);

  if (!account) return <p className="py-8 text-center text-sm text-muted-foreground">Carga movimientos y el estado de cuenta del banco para conciliar cada mes.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={account.id} onValueChange={(v) => { setAccountId(v); setMonth(""); }}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{withData.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={currentMonth} onValueChange={setMonth}>
          <SelectTrigger className="h-8 w-44 text-xs capitalize"><SelectValue /></SelectTrigger>
          <SelectContent>{monthsAvail.map((k) => <SelectItem key={k} value={k} className="capitalize">{monthLabel(k)}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Compara lo registrado contra lo que confirma el estado de cuenta del banco (misma fecha e importe).</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card variant="glass"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-1">Movimientos del mes</p>
          <p className="text-lg font-semibold tabular-nums">{rec.total}</p>
        </CardContent></Card>
        <Card variant="glass"><CardContent className="p-4">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><Landmark className="h-3.5 w-3.5" /> Conciliados con el banco</p>
          <p className="text-lg font-semibold tabular-nums">{rec.confirmed}{rec.hasBank && <span className="ml-1 text-xs font-normal text-muted-foreground">({rec.total ? Math.round((rec.confirmed / rec.total) * 100) : 0}%)</span>}</p>
        </CardContent></Card>
        <Card variant="glass"><CardContent className="p-4">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><AlertTriangle className="h-3.5 w-3.5" /> Registrados sin respaldo del banco</p>
          <p className={`text-lg font-semibold tabular-nums ${unconfirmed.length ? "text-amber-600" : ""}`}>{rec.hasBank ? unconfirmed.length : "—"}</p>
          {unconfirmed.length > 0 && <p className="text-[11px] text-muted-foreground">neto {money(sum(unconfirmed))}</p>}
        </CardContent></Card>
        <Card variant="glass"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-1">En el banco y sin registro previo</p>
          <p className={`text-lg font-semibold tabular-nums ${bankOnly.length ? "text-amber-600" : ""}`}>{bankOnly.length}</p>
          {bankOnly.length > 0 && <p className="text-[11px] text-muted-foreground">neto {money(sum(bankOnly))}</p>}
        </CardContent></Card>
      </div>

      {!rec.hasBank ? (
        <Card variant="glass"><CardContent className="p-5 text-sm text-muted-foreground">
          Aún no hay estado de cuenta del banco cargado para {monthLabel(currentMonth)}: los {rec.total} movimientos registrados esperan conciliación.
          Cárgalo en «Cargar movimientos» → «Estado de cuenta del banco» y se compararán aquí.
        </CardContent></Card>
      ) : unconfirmed.length === 0 && bankOnly.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-green-700"><CheckCircle2 className="h-4 w-4" /> {monthLabel(currentMonth)} está conciliado: todo lo registrado lo confirma el banco y nada del banco quedó sin registrar.</p>
      ) : null}

      {unconfirmed.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Registrados que el banco no confirma ({unconfirmed.length})</h3>
          <p className="text-xs text-muted-foreground">Pueden ser errores del registro, duplicados o movimientos que el banco aún no refleja. «Dar por conciliado» los acepta tal cual; «Eliminar» los quita.</p>
          <div className="rounded-xl border border-border/50 overflow-hidden">
            <Table>
              <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead>Origen</TableHead><TableHead className="text-right">Monto</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {unconfirmed.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs whitespace-nowrap">{day(m.movement_date)}</TableCell>
                    <TableCell className="text-xs max-w-[300px]"><div className="truncate" title={m.description}>{m.description}</div>{m.category && <div className="text-[10px] text-muted-foreground">{m.category}</div>}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{originLabel[m.origin] ?? m.origin}</Badge></TableCell>
                    <TableCell className={`text-right text-xs tabular-nums ${Number(m.credit) > 0 ? "text-green-700" : ""}`}>{Number(m.credit) > 0 ? `+${money(Number(m.credit))}` : `−${money(Number(m.debit))}`}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="outline" className="h-7 text-xs mr-1" disabled={confirm.isPending} onClick={() => confirm.mutate([m.id])}><Check className="h-3 w-3 mr-1" />Dar por conciliado</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600" onClick={() => setToDelete(m)}><Trash2 className="h-3 w-3" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {bankOnly.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">En el banco y no estaban registrados ({bankOnly.length})</h3>
          <p className="text-xs text-muted-foreground">El banco los trae pero no estaban en tus registros. Asignar categoría los da por registrados.</p>
          <div className="rounded-xl border border-border/50 overflow-hidden">
            <Table>
              <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Descripción (banco)</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>Categoría</TableHead></TableRow></TableHeader>
              <TableBody>
                {bankOnly.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs whitespace-nowrap">{day(m.movement_date)}</TableCell>
                    <TableCell className="text-xs max-w-[320px] truncate" title={m.description}>{m.description}</TableCell>
                    <TableCell className={`text-right text-xs tabular-nums ${Number(m.credit) > 0 ? "text-green-700" : ""}`}>{Number(m.credit) > 0 ? `+${money(Number(m.credit))}` : `−${money(Number(m.debit))}`}</TableCell>
                    <TableCell><CategoryPicker value={m.category ?? ""} className="w-44" onChange={(category, kind) => classify.mutate({ items: [m], category, kind })} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este movimiento?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && `${day(toDelete.movement_date)} · ${toDelete.description} · ${money(Number(toDelete.credit) || Number(toDelete.debit))}. Se quita de tus registros; el estado de cuenta del banco no se modifica.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (toDelete) del.mutate([toDelete.id]); setToDelete(null); }}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
