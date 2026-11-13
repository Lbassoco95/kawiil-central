import { useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, CircleSlash, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategoryPicker } from "./CategoryPicker";
import {
  useClassifyMovements, useConfirmMovements, useDeleteMovements, useMarkRegistered, type FinanceAccount, type FinanceMovement,
} from "@/hooks/useFinanceBank";
import { reconcileMonth, type ExistingMovement } from "@/lib/finance/reconcile";

const money = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthLabel = (k: string) => `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;
const originLabel: Record<string, string> = { contable: "Excel contable", captura: "Captura", pegado: "Pegado", manual: "Manual", banco: "Banco" };
const amount = (m: FinanceMovement) => (Number(m.credit) > 0 ? `+${money(Number(m.credit))}` : `−${money(Number(m.debit))}`);

const toExisting = (m: FinanceMovement): ExistingMovement => ({
  id: m.id, date: m.movement_date, debit: Number(m.debit), credit: Number(m.credit), origin: m.origin,
  bankConfirmed: !!m.bank_confirmed_at, hasRecord: m.has_record, category: m.category,
});

/** Un movimiento registrado cerca del inicio o fin de mes puede pertenecer al estado de cuenta del mes vecino. */
const nearMonthEdge = (iso: string) => { const d = Number(iso.slice(8, 10)); const last = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0).getDate(); return d <= 2 || d >= last - 1; };

/** Conciliación: lo registrado contra lo que confirma el estado de cuenta del banco, mes por mes. */
export function ReconciliationPanel({ accounts, movements }: { accounts: FinanceAccount[]; movements: FinanceMovement[] }) {
  const confirm = useConfirmMovements();
  const del = useDeleteMovements();
  const classify = useClassifyMovements();
  const markRegistered = useMarkRegistered();
  const [accountId, setAccountId] = useState("");
  const [month, setMonth] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [toDelete, setToDelete] = useState<FinanceMovement | null>(null);

  const withData = useMemo(() => accounts.filter((a) => movements.some((m) => m.account_id === a.id)), [accounts, movements]);
  const account = withData.find((a) => a.id === accountId) ?? withData[0];

  // Resumen de todos los meses de la cuenta: se ve de un vistazo cuál está conciliado y cuál no.
  const monthRows = useMemo(() => {
    if (!account) return [];
    const by = new Map<string, FinanceMovement[]>();
    for (const m of movements) if (m.account_id === account.id) { const k = m.movement_date.slice(0, 7); by.set(k, [...(by.get(k) ?? []), m]); }
    return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, list]) => {
      const r = reconcileMonth(list.map(toExisting));
      const pending = r.unconfirmed.length + r.bankOnly.length;
      const status: "sin_banco" | "ok" | "pendiente" = !r.hasBank ? "sin_banco" : pending === 0 ? "ok" : "pendiente";
      return { key, rec: r, pending, status };
    });
  }, [account, movements]);

  const currentMonth = monthRows.some((r) => r.key === month) ? month : (monthRows.find((r) => r.status === "pendiente") ?? monthRows.find((r) => r.status === "ok") ?? monthRows[0])?.key ?? "";
  const current = monthRows.find((r) => r.key === currentMonth);
  const items = useMemo(() => (account ? movements.filter((m) => m.account_id === account.id && m.movement_date.startsWith(currentMonth)) : []), [account, movements, currentMonth]);
  const byId = useMemo(() => new Map(items.map((m) => [m.id, m])), [items]);
  const unconfirmed = (current?.rec.unconfirmed ?? []).map((e) => byId.get(e.id)!).filter(Boolean);
  const bankOnly = (current?.rec.bankOnly ?? []).map((e) => byId.get(e.id)!).filter(Boolean);
  const done = items.filter((m) => m.bank_confirmed_at && m.has_record);
  const net = (list: FinanceMovement[]) => list.reduce((s, m) => s + Number(m.credit) - Number(m.debit), 0);

  if (!account || !current) return <p className="py-8 text-center text-sm text-muted-foreground">Carga movimientos y el estado de cuenta del banco para conciliar cada mes.</p>;

  const chip = (status: "sin_banco" | "ok" | "pendiente", pending: number) =>
    status === "ok" ? <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> Conciliado</span>
    : status === "pendiente" ? <span className="inline-flex items-center gap-1 text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /> {pending} por revisar</span>
    : <span className="inline-flex items-center gap-1 text-muted-foreground"><CircleSlash className="h-3.5 w-3.5" /> Falta cargar el estado de cuenta</span>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={account.id} onValueChange={(v) => { setAccountId(v); setMonth(""); }}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{withData.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Un mes está <b>conciliado</b> cuando todo lo que registraste lo confirma el estado de cuenta del banco y todo lo del banco está registrado.</p>
      </div>

      {/* Todos los meses de la cuenta */}
      <div className="rounded-xl border border-border/50 overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Mes</TableHead><TableHead className="text-right">Movimientos</TableHead><TableHead className="text-right">Confirmados por el banco</TableHead><TableHead>Estado</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {monthRows.map((r) => (
              <TableRow key={r.key} onClick={() => setMonth(r.key)} className={`cursor-pointer ${r.key === currentMonth ? "bg-muted/60" : ""}`}>
                <TableCell className="text-xs capitalize font-medium">{monthLabel(r.key)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{r.rec.total}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{r.rec.hasBank ? `${r.rec.confirmed} de ${r.rec.total}` : "—"}</TableCell>
                <TableCell className="text-xs">{chip(r.status, r.pending)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Detalle del mes elegido */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold capitalize">{account.name} · {monthLabel(currentMonth)}</h3>
        {current.status === "sin_banco" && (
          <p className="rounded-xl border border-border/60 p-4 text-sm text-muted-foreground">
            Todavía no se ha cargado el estado de cuenta de {monthLabel(currentMonth)}. Los {current.rec.total} movimientos registrados esperan que lo cargues
            (en «Cargar movimientos» → «Estado de cuenta del banco»); no son un error.
          </p>
        )}
        {current.status === "ok" && (
          <p className="flex items-center gap-2 rounded-xl border border-green-200/60 bg-green-50 p-4 text-sm text-green-800 dark:bg-green-950/30">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> {monthLabel(currentMonth)} está conciliado: {current.rec.confirmed} movimientos registrados y confirmados por el banco. No hay nada por revisar.
          </p>
        )}

        {unconfirmed.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-medium">En tu registro, pero el banco no lo trae ({unconfirmed.length} · neto {money(net(unconfirmed))})</h4>
                <p className="text-xs text-muted-foreground">Pueden ser errores, duplicados, o movimientos de otro mes. «Dar por conciliado» los acepta tal cual; «Eliminar» los quita de tu registro.</p>
              </div>
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={confirm.isPending} onClick={() => confirm.mutate(unconfirmed.map((m) => m.id))}>
                <Check className="h-3.5 w-3.5 mr-1" /> Dar por conciliados los {unconfirmed.length}
              </Button>
            </div>
            <div className="rounded-xl border border-border/50 overflow-hidden">
              <Table>
                <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead>Origen</TableHead><TableHead className="text-right">Monto</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {unconfirmed.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-xs whitespace-nowrap">{day(m.movement_date)}</TableCell>
                      <TableCell className="text-xs max-w-[300px]">
                        <div className="truncate" title={m.description}>{m.description}</div>
                        {nearMonthEdge(m.movement_date) && <div className="text-[10px] text-amber-600">Fecha de inicio/fin de mes: puede pertenecer al estado de cuenta del mes vecino; se concilia al cargarlo.</div>}
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{originLabel[m.origin] ?? m.origin}</Badge></TableCell>
                      <TableCell className={`text-right text-xs tabular-nums ${Number(m.credit) > 0 ? "text-green-700" : ""}`}>{amount(m)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button size="sm" variant="outline" className="h-7 text-xs mr-1" disabled={confirm.isPending} onClick={() => confirm.mutate([m.id])}>Dar por conciliado</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600" aria-label="Eliminar" onClick={() => setToDelete(m)}><Trash2 className="h-3 w-3" /></Button>
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-medium">En el banco, pero falta en tu registro ({bankOnly.length} · neto {money(net(bankOnly))})</h4>
                <p className="text-xs text-muted-foreground">El banco los trae y tu Excel/capturas no. Asigna la categoría de cada uno (queda registrado y sale de esta lista) o acéptalos todos y clasifícalos después en «Por clasificar».</p>
              </div>
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={markRegistered.isPending} onClick={() => markRegistered.mutate(bankOnly.map((m) => m.id))}>
                <Check className="h-3.5 w-3.5 mr-1" /> Aceptar los {bankOnly.length} como registrados
              </Button>
            </div>
            <div className="rounded-xl border border-border/50 overflow-hidden">
              <Table>
                <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Descripción (banco)</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>Categoría</TableHead></TableRow></TableHeader>
                <TableBody>
                  {bankOnly.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-xs whitespace-nowrap">{day(m.movement_date)}</TableCell>
                      <TableCell className="text-xs max-w-[320px] truncate" title={m.description}>{m.description}</TableCell>
                      <TableCell className={`text-right text-xs tabular-nums ${Number(m.credit) > 0 ? "text-green-700" : ""}`}>{amount(m)}</TableCell>
                      <TableCell><CategoryPicker value={m.category ?? ""} className="w-44" onChange={(category, kind) => classify.mutate({ items: [m], category, kind })} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {done.length > 0 && (
          <div className="space-y-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowDone((v) => !v)}>
              {showDone ? "Ocultar" : "Ver"} los {done.length} conciliados
            </Button>
            {showDone && (
              <div className="max-h-72 overflow-auto rounded-xl border border-border/50">
                <Table>
                  <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Tu registro</TableHead><TableHead>Banco</TableHead><TableHead className="text-right">Monto</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {done.slice(0, 300).map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs whitespace-nowrap">{day(m.movement_date)}</TableCell>
                        <TableCell className="text-xs max-w-[230px] truncate" title={m.description}>{m.description}</TableCell>
                        <TableCell className="text-xs max-w-[230px] truncate text-muted-foreground" title={m.bank_description ?? ""}>{m.bank_description ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{amount(m)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </div>

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
