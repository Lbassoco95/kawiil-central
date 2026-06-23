import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ReceiptText, Inbox } from "lucide-react";
import { toast } from "sonner";
import {
  functionInvokeUserMessageAsync,
  invokeFunctionWithSession,
} from "@/lib/supabaseInvoke";

type CfdiRow = {
  id: string | null;
  uuid: string | null;
  fechaCFDI: string | null;
  emisor: string | null;
  receptor: string | null;
  rfcEmisor: string | null;
  rfcReceptor: string | null;
  tipo: string | null;
  direccion: "emitida" | "recibida" | "desconocida";
  estatus: string | null;
  vigente: boolean;
  total: number | null;
};

type Counters = {
  totalCfdi: number;
  totalVigentes: number;
  totalCanceladas: number;
  emitidasVigentes: number;
  recibidasVigentes: number;
  emitidasVigentesTotalMxn: number;
  recibidasVigentesTotalMxn: number;
};

type FacturasResult = {
  status?: string;
  message?: string;
  counters: Counters | null;
  cfdis: CfdiRow[];
  moffinQueryId?: string;
};

const MXN = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMxn(n: number | null | undefined): string {
  return MXN.format(typeof n === "number" && Number.isFinite(n) ? n : 0);
}

function formatDate(raw: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function truncUuid(uuid: string | null): string {
  if (!uuid) return "—";
  return uuid.length > 8 ? `${uuid.slice(0, 8)}…` : uuid;
}

function firstDayOfYearIso(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function MoffinFacturasDialog({
  projectId,
  disabled,
  disabledReason,
}: {
  projectId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [startdate, setStartdate] = useState(firstDayOfYearIso());
  const [enddate, setEnddate] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FacturasResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cfdis = result?.cfdis ?? [];
  const counters = result?.counters ?? null;

  const sortedCfdis = useMemo(
    () =>
      [...cfdis].sort((a, b) => {
        const ta = a.fechaCFDI ? new Date(a.fechaCFDI).getTime() : 0;
        const tb = b.fechaCFDI ? new Date(b.fechaCFDI).getTime() : 0;
        return tb - ta;
      }),
    [cfdis],
  );

  const handleConsultar = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: invokeError } = await invokeFunctionWithSession("moffin-facturas", {
        projectId,
        startdate,
        enddate,
      });
      const payload = (data ?? {}) as FacturasResult & { error?: string };
      if (payload.error || invokeError) {
        const msg = await functionInvokeUserMessageAsync(data, invokeError);
        setError(msg);
        return;
      }
      setResult(payload);
      if (payload.status === "pending") {
        toast.info(payload.message ?? "Moffin aún está procesando las facturas. Reintenta en unos minutos.");
      } else {
        toast.success("Facturas SAT consultadas");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al consultar facturas en Moffin");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
        >
          <ReceiptText className="h-3.5 w-3.5" />
          Facturas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Facturas SAT (CFDI · Moffin)</DialogTitle>
          <DialogDescription>
            Descarga el historial de CFDI emitidos y recibidos del RFC del cliente usando su CIEC registrada.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="facturas-startdate" className="text-xs">
              Fecha inicio
            </Label>
            <Input
              id="facturas-startdate"
              type="date"
              className="h-9 text-xs"
              value={startdate}
              max={enddate}
              onChange={(e) => setStartdate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="facturas-enddate" className="text-xs">
              Fecha fin
            </Label>
            <Input
              id="facturas-enddate"
              type="date"
              className="h-9 text-xs"
              value={enddate}
              min={startdate}
              max={todayIso()}
              onChange={(e) => setEnddate(e.target.value)}
            />
          </div>
          <Button type="button" size="sm" className="h-9 gap-1.5" disabled={loading} onClick={handleConsultar}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Consultar
          </Button>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {counters ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2">
              <p className="text-[10px] text-muted-foreground">Emitidas vigentes</p>
              <p className="text-lg font-semibold text-green-700 dark:text-green-400">
                {counters.emitidasVigentes}
              </p>
              <p className="text-[10px] text-muted-foreground">{formatMxn(counters.emitidasVigentesTotalMxn)}</p>
            </div>
            <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2">
              <p className="text-[10px] text-muted-foreground">Recibidas vigentes</p>
              <p className="text-lg font-semibold text-blue-700 dark:text-blue-400">
                {counters.recibidasVigentes}
              </p>
              <p className="text-[10px] text-muted-foreground">{formatMxn(counters.recibidasVigentesTotalMxn)}</p>
            </div>
            <div className="rounded-md border border-border/60 p-2">
              <p className="text-[10px] text-muted-foreground">Total vigentes</p>
              <p className="text-lg font-semibold">{counters.totalVigentes}</p>
            </div>
            <div className="rounded-md border border-border/60 p-2">
              <p className="text-[10px] text-muted-foreground">Canceladas</p>
              <p className="text-lg font-semibold text-muted-foreground">{counters.totalCanceladas}</p>
            </div>
          </div>
        ) : null}

        {result && !error ? (
          sortedCfdis.length > 0 ? (
            <div className="max-h-[45vh] overflow-auto rounded-md border border-border/60">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="p-2 font-medium">Fecha CFDI</th>
                    <th className="p-2 font-medium">UUID</th>
                    <th className="p-2 font-medium">Emisor</th>
                    <th className="p-2 font-medium">Receptor</th>
                    <th className="p-2 font-medium">Tipo</th>
                    <th className="p-2 font-medium">Estatus</th>
                    <th className="p-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCfdis.map((c, i) => (
                    <tr key={c.uuid ?? c.id ?? i} className="border-t border-border/50">
                      <td className="p-2 whitespace-nowrap">{formatDate(c.fechaCFDI)}</td>
                      <td className="p-2 font-mono" title={c.uuid ?? undefined}>
                        {truncUuid(c.uuid)}
                      </td>
                      <td className="p-2 max-w-[140px] truncate" title={c.emisor ?? undefined}>
                        {c.emisor ?? "—"}
                      </td>
                      <td className="p-2 max-w-[140px] truncate" title={c.receptor ?? undefined}>
                        {c.receptor ?? "—"}
                      </td>
                      <td className="p-2">
                        <Badge
                          variant="outline"
                          className={
                            c.direccion === "emitida"
                              ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400 text-[10px]"
                              : "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400 text-[10px]"
                          }
                        >
                          {c.direccion === "emitida" ? "Emitida" : c.direccion === "recibida" ? "Recibida" : (c.tipo ?? "—")}
                        </Badge>
                      </td>
                      <td className="p-2">
                        <Badge
                          variant="outline"
                          className={
                            c.vigente
                              ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400 text-[10px]"
                              : "border-border/60 bg-muted text-muted-foreground text-[10px]"
                          }
                        >
                          {c.estatus ?? (c.vigente ? "Vigente" : "—")}
                        </Badge>
                      </td>
                      <td className="p-2 text-right whitespace-nowrap tabular-nums">{formatMxn(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : result.status !== "pending" ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 py-8 text-center">
              <Inbox className="h-6 w-6 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                No se encontraron facturas en el periodo {formatDate(startdate)} – {formatDate(enddate)}.
              </p>
            </div>
          ) : null
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
