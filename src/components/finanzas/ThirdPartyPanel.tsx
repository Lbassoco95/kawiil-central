import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSetMovementEntity, type FinanceAccount, type FinanceMovement } from "@/hooks/useFinanceBank";
import { detectEntity, summarizeEntities } from "@/lib/finance/thirdParty";

const money = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" });
const NEW = "__nueva__";

/** Tesorería de impuestos de terceros: dinero recibido de clientes para pagar al SAT, por entidad. */
export function ThirdPartyPanel({ accounts, movements }: { accounts: FinanceAccount[]; movements: FinanceMovement[] }) {
  const setEntity = useSetMovementEntity();
  const [custom, setCustom] = useState("");
  const [pick, setPick] = useState<string>("");
  const ledgerIds = useMemo(() => new Set(accounts.filter((a) => !a.counts_as_available).map((a) => a.id)), [accounts]);
  const ledger = useMemo(() => movements.filter((m) => ledgerIds.has(m.account_id)), [movements, ledgerIds]);
  const rows = useMemo(() => summarizeEntities(ledger.map((m) => ({ ...m, debit: Number(m.debit), credit: Number(m.credit) }))), [ledger]);
  const total = rows.reduce((s, r) => s + r.held, 0);
  const entities = rows.map((r) => r.entity).filter((e) => e !== "Sin identificar");
  const unassigned = useMemo(
    () => ledger.filter((m) => Number(m.debit) > 0 && !(m.entity || detectEntity(m.description, m.notes))),
    [ledger],
  );
  const staleDays = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(`${iso}T12:00:00`).getTime()) / 86400000) : 0);

  if (ledgerIds.size === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Aún no hay cuentas de terceros. Al cargar el Excel, marca GONZALO, PCR y NUUP como «dinero de terceros».</p>;
  }
  const finalEntity = pick === NEW ? custom.trim() : pick;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-2xl font-semibold tabular-nums">{money(total)}</p>
        <p className="text-xs text-muted-foreground">Dinero de terceros retenido (depositado menos pagado al SAT). No es disponible de Kawiil.</p>
      </div>
      <div className="rounded-xl border border-border/50 overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Cliente / entidad</TableHead><TableHead className="text-right">Depositado</TableHead>
            <TableHead className="text-right">Pagado (identificado)</TableHead><TableHead>Último depósito</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.entity}>
                <TableCell className="text-xs font-medium">{r.entity}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{money(r.deposited)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{money(r.paid)}</TableCell>
                <TableCell className="text-xs">
                  {r.lastDeposit ? day(r.lastDeposit) : "—"}
                  {r.lastDeposit && staleDays(r.lastDeposit) > 25 && Math.max(0, r.deposited - r.paid) > 1000 && (
                    <span className="ml-2 inline-flex items-center gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" />{staleDays(r.lastDeposit)} d</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Los pagos al SAT que no mencionan al cliente no se pueden atribuir solos: asígnalos abajo para que el saldo por cliente sea exacto. El total retenido siempre cuadra con el estado de cuenta.
      </p>

      {unassigned.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">Pagos sin cliente asignado ({unassigned.length})</h3>
            <Select value={pick} onValueChange={setPick}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Asignar a…" /></SelectTrigger>
              <SelectContent>
                {entities.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                <SelectItem value={NEW}>+ Otro cliente…</SelectItem>
              </SelectContent>
            </Select>
            {pick === NEW && <Input className="h-8 w-40" placeholder="Nombre" value={custom} onChange={(e) => setCustom(e.target.value)} />}
          </div>
          <div className="rounded-xl border border-border/50 overflow-hidden max-h-80 overflow-y-auto">
            <Table>
              <TableBody>
                {unassigned.slice(0, 60).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs whitespace-nowrap">{day(m.movement_date)}</TableCell>
                    <TableCell className="text-xs max-w-[320px] truncate" title={m.description}>{m.description}{m.notes ? ` · ${m.notes}` : ""}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{money(Number(m.debit))}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!finalEntity || setEntity.isPending}
                        onClick={() => setEntity.mutate({ ids: [m.id], entity: finalEntity })}>Asignar</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
