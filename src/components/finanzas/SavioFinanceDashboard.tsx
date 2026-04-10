import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { es } from "date-fns/locale";
import {
  Activity,
  Banknote,
  FileText,
  Loader2,
  Plug,
  RefreshCw,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSavioWebhookEvents, type SavioFinanceEvent } from "@/hooks/useSavioWebhookEvents";
import {
  extractSavioAmount,
  extractSavioSummary,
  SAVIO_EVENT_LABELS,
} from "@/lib/savioPayload";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const EVENT_FILTER_ALL = "todos";

function formatMoney(n: number) {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export function SavioFinanceDashboard() {
  const { data: events = [], isLoading, isError, refetch, isFetching } = useSavioWebhookEvents();
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState(EVENT_FILTER_ALL);
  const [detail, setDetail] = useState<SavioFinanceEvent | null>(null);
  const [apiCheck, setApiCheck] = useState<"idle" | "loading" | "ok" | "fail">("idle");
  const [apiMessage, setApiMessage] = useState<string | null>(null);

  const since30 = useMemo(() => subDays(new Date(), 30), []);

  const stats = useMemo(() => {
    const recent = events.filter((e) => new Date(e.created_at) >= since30);
    const byType: Record<string, number> = {};
    let paymentsSum = 0;
    let paymentCount = 0;
    for (const e of recent) {
      byType[e.event_type] = (byType[e.event_type] ?? 0) + 1;
      if (e.event_type === "payment.created") {
        const amt = extractSavioAmount(e.payload);
        if (amt !== null) {
          paymentsSum += amt;
          paymentCount += 1;
        }
      }
    }
    return {
      recentTotal: recent.length,
      byType,
      paymentsSum,
      paymentCount,
      invoiceUpdates: (byType["invoice.status.updated"] ?? 0) + (byType["invoice.deleted"] ?? 0),
    };
  }, [events, since30]);

  const eventTypes = useMemo(() => {
    const s = new Set(events.map((e) => e.event_type));
    return Array.from(s).sort();
  }, [events]);

  const filtered = useMemo(() => {
    let list = events;
    if (eventFilter !== EVENT_FILTER_ALL) {
      list = list.filter((e) => e.event_type === eventFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) => {
        const sum = extractSavioSummary(e.payload).toLowerCase();
        return (
          e.event_type.toLowerCase().includes(q) ||
          (e.savio_id?.toLowerCase().includes(q) ?? false) ||
          sum.includes(q)
        );
      });
    }
    return list;
  }, [events, eventFilter, search]);

  async function checkSavioApi() {
    setApiCheck("loading");
    setApiMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("savio-api-health", {
        method: "GET",
      });
      if (error) {
        setApiCheck("fail");
        setApiMessage(error.message || "Error al invocar la función");
        return;
      }
      const body = data as { ok?: boolean; savio_error?: string; missing?: string[]; error?: string };
      if (body?.missing?.length) {
        setApiCheck("fail");
        setApiMessage(`Faltan secretos: ${body.missing.join(", ")}`);
        return;
      }
      if (body?.ok) {
        setApiCheck("ok");
        setApiMessage("API Savio respondió correctamente.");
        return;
      }
      setApiCheck("fail");
      setApiMessage(body?.savio_error || body?.error || "Respuesta inesperada");
    } catch (e) {
      setApiCheck("fail");
      setApiMessage(e instanceof Error ? e.message : "Error desconocido");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-xl">
          Actividad de cuentas por cobrar según eventos recibidos desde Savio (webhooks). Los montos
          solo aparecen si Savio los incluye en el payload del evento.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={apiCheck === "loading"}
            onClick={() => void checkSavioApi()}
          >
            {apiCheck === "loading" ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Plug className="h-3.5 w-3.5 mr-1" />
            )}
            Probar API Savio
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1", isFetching && "animate-spin")} />
            Actualizar
          </Button>
        </div>
      </div>

      {apiMessage && (
        <p
          className={cn(
            "text-xs rounded-lg px-3 py-2 border",
            apiCheck === "ok"
              ? "border-green-500/30 bg-green-500/10 text-green-800 dark:text-green-300"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {apiMessage}
        </p>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">
          No se pudieron cargar los eventos. Si acabas de entrar al módulo Finanzas, pide que apliquen
          la migración RLS más reciente o revisa permisos.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="stat-card">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Activity className="h-3.5 w-3.5" /> Eventos (30 días)
            </div>
            <p className="text-lg font-semibold">{stats.recentTotal}</p>
            <p className="text-xs text-muted-foreground">Notificaciones Savio</p>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Banknote className="h-3.5 w-3.5" /> Pagos (30 días)
            </div>
            <p className="text-lg font-semibold text-green-600">
              {stats.paymentCount > 0 ? formatMoney(stats.paymentsSum) : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              {stats.paymentCount} con monto en payload
            </p>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <FileText className="h-3.5 w-3.5" /> Cargos / estado
            </div>
            <p className="text-lg font-semibold">{stats.invoiceUpdates}</p>
            <p className="text-xs text-muted-foreground">Cambios de factura (30 días)</p>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Activity className="h-3.5 w-3.5" /> En vista
            </div>
            <p className="text-lg font-semibold">{filtered.length}</p>
            <p className="text-xs text-muted-foreground">de {events.length} cargados</p>
          </div>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative w-48">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
              />
            </div>
            <Select value={eventFilter} onValueChange={setEventFilter}>
              <SelectTrigger className="w-52 h-8 text-xs">
                <SelectValue placeholder="Tipo de evento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EVENT_FILTER_ALL}>Todos los eventos</SelectItem>
                {eventTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {SAVIO_EVENT_LABELS[t] || t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="glass-card overflow-hidden p-0 border-border/50 rounded-xl">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                {events.length === 0
                  ? "Aún no hay eventos de Savio. Configura el webhook y genera movimientos en Savio."
                  : "Ningún evento coincide con los filtros."}
              </div>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Evento</TableHead>
                      <TableHead>ID Savio</TableHead>
                      <TableHead>Resumen</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((row) => {
                      const amt = extractSavioAmount(row.payload);
                      return (
                        <TableRow
                          key={row.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setDetail(row)}
                        >
                          <TableCell className="whitespace-nowrap text-xs">
                            {format(new Date(row.created_at), "dd MMM yy HH:mm", { locale: es })}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs font-normal">
                              {SAVIO_EVENT_LABELS[row.event_type] || row.event_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono max-w-[120px] truncate">
                            {row.savio_id || "—"}
                          </TableCell>
                          <TableCell className="text-xs max-w-[220px] truncate">
                            {extractSavioSummary(row.payload)}
                          </TableCell>
                          <TableCell className="text-right text-xs whitespace-nowrap">
                            {amt !== null ? formatMoney(amt) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </>
      )}

      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Detalle del evento</SheetTitle>
          </SheetHeader>
          {detail && (
            <div className="mt-4 space-y-3 text-xs">
              <p>
                <span className="text-muted-foreground">Tipo: </span>
                {SAVIO_EVENT_LABELS[detail.event_type] || detail.event_type}
              </p>
              <p>
                <span className="text-muted-foreground">ID Savio: </span>
                {detail.savio_id || "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Recibido: </span>
                {format(new Date(detail.created_at), "PPpp", { locale: es })}
              </p>
              <pre className="mt-2 p-3 rounded-lg bg-muted text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(detail.payload, null, 2)}
              </pre>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
