import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Link2, Ban, ScanLine, CheckCircle2 } from "lucide-react";
import {
  useReconciliationQueue,
  useInvoiceLiteMap,
  useTriggerReconcile,
  useResolveReconciliation,
  useIgnoreReconciliation,
  RECON_REASON_LABELS,
  type ReconciliationQueueRow,
} from "@/hooks/useReconciliation";

const REASON_STYLES: Record<string, string> = {
  sin_factura: "bg-muted text-muted-foreground",
  ambiguo: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  sobrepago: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

const money = (n: number | null, currency: string) =>
  `$${Number(n ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2 })} ${currency}`;

function QueueItem({ item, invoiceMap }: { item: ReconciliationQueueRow; invoiceMap: Record<string, { id: string; savio_id: string; folio: string | null; amount: number | null; currency: string }> }) {
  const resolve = useResolveReconciliation();
  const ignore = useIgnoreReconciliation();
  const [selected, setSelected] = useState<string>(item.candidates[0] ?? "");
  const [concepto, setConcepto] = useState("");

  const candidateOptions = item.candidates
    .map((sid) => invoiceMap[sid])
    .filter(Boolean) as { id: string; savio_id: string; folio: string | null; amount: number | null; currency: string }[];

  const apply = () => {
    const inv = invoiceMap[selected];
    if (!inv) return;
    if (item.reason === "sobrepago" && !concepto.trim()) return;
    const monto = Math.min(Number(item.amount ?? 0), Number(inv.amount ?? item.amount ?? 0));
    resolve.mutate({ item, invoice: inv, monto, concepto: concepto || null });
  };

  return (
    <div className="rounded-lg border border-border/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium tabular-nums">{money(item.amount, item.currency)}</p>
          <p className="text-[11px] text-muted-foreground">
            Pago {item.payment_savio_id?.slice(0, 12) ?? item.payment_id.slice(0, 8)}
            {item.customer_savio_id ? ` · cliente ${item.customer_savio_id.slice(0, 10)}` : ""}
          </p>
        </div>
        <Badge className={`border-0 text-[10px] ${REASON_STYLES[item.reason]}`}>
          {RECON_REASON_LABELS[item.reason]}
        </Badge>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {candidateOptions.length > 0 && (
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="h-8 w-56 text-xs">
              <SelectValue placeholder="Factura a aplicar…" />
            </SelectTrigger>
            <SelectContent>
              {candidateOptions.map((inv) => (
                <SelectItem key={inv.savio_id} value={inv.savio_id}>
                  {(inv.folio || inv.savio_id.slice(0, 10))} · {money(inv.amount, inv.currency)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {item.reason === "sobrepago" && (
          <Input
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            placeholder="Concepto (requerido)"
            className="h-8 w-48 text-xs"
          />
        )}
        {candidateOptions.length > 0 && (
          <Button
            size="sm"
            className="h-8 gap-1 text-xs"
            disabled={!selected || resolve.isPending || (item.reason === "sobrepago" && !concepto.trim())}
            onClick={apply}
          >
            <Link2 className="h-3.5 w-3.5" /> Aplicar
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1 text-xs text-muted-foreground"
          disabled={ignore.isPending}
          onClick={() => ignore.mutate(item.id)}
        >
          <Ban className="h-3.5 w-3.5" /> Ignorar
        </Button>
      </div>
    </div>
  );
}

export function ReconciliationPanel() {
  const { data: queue = [], isLoading } = useReconciliationQueue();
  const trigger = useTriggerReconcile();

  const candidateIds = useMemo(
    () => Array.from(new Set(queue.flatMap((q) => q.candidates))),
    [queue],
  );
  const { data: invoiceMap = {} } = useInvoiceLiteMap(candidateIds);

  return (
    <Card variant="glass">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ScanLine className="h-4 w-4 text-primary" /> Conciliación de pagos
              {queue.length > 0 && (
                <Badge variant="outline" className="text-amber-700 dark:text-amber-400">{queue.length} por revisar</Badge>
              )}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Cruza pagos con facturas abiertas. Lo que no se resuelve solo (ambiguo, sin factura o sobrepago) se lista aquí.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => trigger.mutate()} disabled={trigger.isPending}>
            {trigger.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ScanLine className="h-4 w-4 mr-1" />}
            {trigger.isPending ? "Conciliando…" : "Conciliar ahora"}
          </Button>
        </div>

        <div className="mt-3 space-y-2">
          {isLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : queue.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Sin pagos pendientes de conciliar.
            </div>
          ) : (
            queue.map((item) => <QueueItem key={item.id} item={item} invoiceMap={invoiceMap} />)
          )}
        </div>
      </CardContent>
    </Card>
  );
}
