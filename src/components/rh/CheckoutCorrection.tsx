import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, X, Loader2 } from "lucide-react";
import { formatMX } from "@/lib/dateUtils";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import {
  useMyPendingCheckouts,
  useProposeCheckout,
  useCheckoutApprovals,
  useDecideCheckout,
} from "@/hooks/useRh";
import type { RhAttendance } from "@/lib/rh";

function dayLabel(workDate: string) {
  return formatMX(`${workDate}T12:00:00`, "EEE dd 'de' MMM");
}

/** Banner para el colaborador: jornadas sin salida que debe declarar. */
export function PendingCheckoutBanner() {
  const { data: pending = [] } = useMyPendingCheckouts();
  if (pending.length === 0) return null;
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:bg-amber-950/30">
      <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4" />
        Quedó una jornada sin registrar tu salida
      </p>
      <p className="text-xs text-amber-700 dark:text-amber-400">
        Indica tu hora aproximada de salida; se enviará a tu G4 para aprobación.
      </p>
      {pending.map((row) => <PendingRow key={row.id} row={row} />)}
    </div>
  );
}

function PendingRow({ row }: { row: RhAttendance }) {
  const propose = useProposeCheckout();
  const [time, setTime] = useState("18:00");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-background/60 p-2">
      <span className="text-sm font-medium">{dayLabel(row.work_date)}</span>
      <span className="text-xs text-muted-foreground">salí a las</span>
      <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-8 w-28" />
      <Button
        size="sm"
        disabled={propose.isPending || !time}
        onClick={() => propose.mutate({ id: row.id, proposedAt: new Date(`${row.work_date}T${time}:00`).toISOString() })}
      >
        {propose.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Enviar a aprobación
      </Button>
    </div>
  );
}

/** Tarjeta para G4: salidas propuestas pendientes de aprobar. */
export function CheckoutApprovalsCard() {
  const { data: pending = [] } = useCheckoutApprovals(true);
  const { data: users = [] } = useOrgUsers();
  const decide = useDecideCheckout();
  if (pending.length === 0) return null;
  const nameOf = (id: string) => users.find((u) => u.user_id === id)?.full_name ?? "Colaborador";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Salidas por aprobar</span>
          <Badge variant="secondary" className="text-[10px]">{pending.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {pending.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5">
            <div className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{nameOf(row.user_id)}</span>
              <span className="text-muted-foreground">
                {" "}· {dayLabel(row.work_date)} · salida propuesta{" "}
                <strong>{row.proposed_check_out_at ? formatMX(row.proposed_check_out_at, "HH:mm") : "—"}</strong>
              </span>
            </div>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={decide.isPending}
              onClick={() => decide.mutate({ row, approve: true })}>
              <Check className="mr-1.5 h-3.5 w-3.5" /> Aprobar
            </Button>
            <Button size="sm" variant="outline" className="text-red-600" disabled={decide.isPending}
              onClick={() => decide.mutate({ row, approve: false })}>
              <X className="mr-1.5 h-3.5 w-3.5" /> Rechazar
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
