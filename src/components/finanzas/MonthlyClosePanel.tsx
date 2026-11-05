import { useMemo, useState } from "react";
import { AlertTriangle, Check, CircleSlash } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FinanceAccount, FinanceMovement } from "@/hooks/useFinanceBank";
import { monthlyClose } from "@/lib/finance/planning";

const money = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const label = (k: string) => `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;

/** Cierre mes a mes por cuenta: dónde cuadra con el banco y en qué mes faltan movimientos. */
export function MonthlyClosePanel({ accounts, movements }: { accounts: FinanceAccount[]; movements: FinanceMovement[] }) {
  const withData = useMemo(() => accounts.filter((a) => movements.some((m) => m.account_id === a.id)), [accounts, movements]);
  const [accountId, setAccountId] = useState("");
  const current = withData.find((a) => a.id === accountId) ?? withData[0];
  const rows = useMemo(() => {
    if (!current) return [];
    const ms = movements.filter((m) => m.account_id === current.id).map((m) => ({
      account_id: m.account_id, debit: Number(m.debit), credit: Number(m.credit), movement_date: m.movement_date,
      row_seq: m.row_seq, reported_balance: m.reported_balance == null ? null : Number(m.reported_balance),
    }));
    return monthlyClose(Number(current.opening_balance), ms).reverse();
  }, [current, movements]);

  if (!current) return <p className="py-8 text-center text-sm text-muted-foreground">Carga movimientos para ver el cierre de cada mes.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={current.id} onValueChange={setAccountId}>
          <SelectTrigger className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{withData.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Compara la suma de movimientos contra el saldo que reporta el banco al cierre de cada mes.</p>
      </div>
      <div className="rounded-xl border border-border/50 overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Mes</TableHead><TableHead className="text-right">Abonos</TableHead><TableHead className="text-right">Cargos</TableHead>
            <TableHead className="text-right">Saldo al cierre</TableHead><TableHead>Estado</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => {
              const empty = r.count === 0;
              const missing = r.monthDrift != null && Math.abs(r.monthDrift) > 1;
              return (
                <TableRow key={r.key}>
                  <TableCell className="text-xs capitalize">{label(r.key)}<div className="text-[10px] text-muted-foreground normal-case">{r.count} movimientos</div></TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-green-700">{money(r.credit)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{money(r.debit)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{money(r.endReported ?? r.endComputed)}</TableCell>
                  <TableCell className="text-xs">
                    {empty ? <span className="flex items-center gap-1 text-amber-600"><CircleSlash className="h-3 w-3" /> Sin movimientos cargados</span>
                      : r.endReported == null ? <span className="text-muted-foreground">Sin saldo del banco para comparar</span>
                      : missing ? <span className="flex items-center gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" /> Faltan movimientos por {money(Math.abs(r.monthDrift!))}</span>
                      : <span className="flex items-center gap-1 text-green-700"><Check className="h-3 w-3" /> Cuadra con el banco</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
