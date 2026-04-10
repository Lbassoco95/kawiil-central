import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { es } from "date-fns/locale";
import {
  Activity,
  Banknote,
  FileText,
  LayoutDashboard,
  Loader2,
  Plug,
  Radio,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSavioWebhookEvents, type SavioFinanceEvent } from "@/hooks/useSavioWebhookEvents";
import { useSavioFinanceApiData } from "@/hooks/useSavioFinanceApi";
import {
  extractSavioAmount,
  extractSavioSummary,
  SAVIO_EVENT_LABELS,
} from "@/lib/savioPayload";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  savioFinanceApiFailureHint,
  savioMissingSecretsUserMessage,
} from "@/lib/savioFinanceApiHints";

const EVENT_FILTER_ALL = "todos";

function formatMoney(n: number) {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export function SavioFinanceDashboard() {
  const [section, setSection] = useState<"resumen" | "webhooks">("resumen");

  const {
    invoiceRows,
    paymentRows,
    invoiceAgg,
    paymentAgg,
    invoicesMeta,
    paymentsMeta,
    isLoading: apiLoading,
    isFetching: apiFetching,
    refetchAll,
    reactQueryError,
  } = useSavioFinanceApiData();

  const { data: events = [], isLoading: whLoading, isError: whError, refetch: refetchWh, isFetching: whFetching } =
    useSavioWebhookEvents();

  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState(EVENT_FILTER_ALL);
  const [detail, setDetail] = useState<SavioFinanceEvent | null>(null);
  const [apiDetail, setApiDetail] = useState<{ title: string; raw: unknown } | null>(null);

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
        setApiMessage(savioMissingSecretsUserMessage(body.missing));
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

  const invoiceFail = savioFinanceApiFailureHint(invoicesMeta);
  const paymentFail = savioFinanceApiFailureHint(paymentsMeta);

  function refreshCurrent() {
    if (section === "resumen") void refetchAll();
    else void refetchWh();
  }

  const busy = section === "resumen" ? apiFetching : whFetching;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground max-w-3xl">
          <strong className="text-foreground">Resumen</strong> obtiene cargos y pagos directamente de la API de Savio
          (datos vivos del despacho). <strong className="text-foreground">Notificaciones</strong> muestra el historial
          de webhooks recibidos en Kawiil (útil para auditoría y automatizaciones).
        </p>
        <div className="flex flex-wrap items-center gap-2">
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
            Probar conexión Savio
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => refreshCurrent()}
            disabled={busy}
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1", busy && "animate-spin")} />
            Actualizar vista
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

      <Tabs value={section} onValueChange={(v) => setSection(v as "resumen" | "webhooks")} className="space-y-4">
        <TabsList className="h-9 w-full max-w-md justify-start">
          <TabsTrigger value="resumen" className="text-xs gap-1.5">
            <LayoutDashboard className="h-3.5 w-3.5" /> Resumen Savio
          </TabsTrigger>
          <TabsTrigger value="webhooks" className="text-xs gap-1.5">
            <Radio className="h-3.5 w-3.5" /> Notificaciones
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="mt-0 space-y-4">
          {reactQueryError && (
            <p className="text-xs text-destructive border border-destructive/30 rounded-lg px-3 py-2">
              Error al cargar datos Savio: {reactQueryError.message}
            </p>
          )}
          {(invoiceFail || paymentFail) && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100 space-y-1">
              <p className="font-medium">Ajustes sugeridos si no ves datos</p>
              {invoiceFail && <p>Facturas/cargos: {invoiceFail}</p>}
              {paymentFail && <p>Pagos: {paymentFail}</p>}
              <p className="text-muted-foreground dark:text-amber-200/80">
                La URL base debe resolver a{" "}
                <code className="text-[10px]">…/api/v1</code> (p. ej. <code className="text-[10px]">https://api.savio.mx/api/v1</code>
                ); el backend añade <code className="text-[10px]">/api/v1</code> si solo pones el host. Rutas:{" "}
                <code className="text-[10px]">/invoice</code>, <code className="text-[10px]">/payment</code>. Si
                ves error de ruta, revisa{" "}
                <a href="https://app.savio.mx/docs" className="underline" target="_blank" rel="noreferrer">
                  app.savio.mx/docs
                </a>{" "}
                y, solo si cambian, secretos{" "}
                <code className="text-[10px]">SAVIO_API_PATH_INVOICES</code>,{" "}
                <code className="text-[10px]">SAVIO_API_PATH_PAYMENTS</code> (y borra valores viejos tipo{" "}
                <code className="text-[10px]">/api/v1/…</code>).
              </p>
            </div>
          )}

          {apiLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-24 rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="stat-card">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <FileText className="h-3.5 w-3.5" /> Cargos en lista
                </div>
                <p className="text-lg font-semibold">{invoiceRows.length}</p>
                <p className="text-xs text-muted-foreground">
                  {invoiceAgg.withAmount > 0
                    ? `Suma mostrada: ${formatMoney(invoiceAgg.sum)}`
                    : "Montos si Savio los envía en cada ítem"}
                </p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Banknote className="h-3.5 w-3.5" /> Pagos en lista
                </div>
                <p className="text-lg font-semibold text-green-600">
                  {paymentAgg.withAmount > 0 ? formatMoney(paymentAgg.sum) : paymentRows.length > 0 ? "—" : "0"}
                </p>
                <p className="text-xs text-muted-foreground">{paymentRows.length} registros</p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Activity className="h-3.5 w-3.5" /> Webhooks (30 días)
                </div>
                <p className="text-lg font-semibold">{stats.recentTotal}</p>
                <p className="text-xs text-muted-foreground">Cambia a Notificaciones para detalle</p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <LayoutDashboard className="h-3.5 w-3.5" /> Origen
                </div>
                <p className="text-lg font-semibold">API + DB</p>
                <p className="text-xs text-muted-foreground">Hasta 100 ítems por recurso</p>
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="glass-card overflow-hidden p-0 border-border/50 rounded-xl">
              <div className="px-3 py-2 border-b text-xs font-medium">Cargos / facturas (Savio)</div>
              {apiLoading ? (
                <Skeleton className="h-48 m-3 rounded-lg" />
              ) : invoiceRows.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground text-xs px-3">
                  Sin registros o la API no devolvió una lista reconocible.
                </div>
              ) : (
                <div className="rounded-lg overflow-x-auto max-h-[320px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Folio / ID</TableHead>
                        <TableHead className="text-xs">Cliente</TableHead>
                        <TableHead className="text-xs">Estado</TableHead>
                        <TableHead className="text-right text-xs">Monto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoiceRows.slice(0, 80).map((row) => (
                        <TableRow
                          key={row.key}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setApiDetail({ title: "Cargo / factura", raw: row.raw })}
                        >
                          <TableCell className="text-xs font-mono max-w-[100px] truncate">{row.folio}</TableCell>
                          <TableCell className="text-xs max-w-[140px] truncate">{row.cliente}</TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline" className="font-normal text-[10px]">
                              {row.estado}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs whitespace-nowrap">
                            {row.monto !== null ? formatMoney(row.monto) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="glass-card overflow-hidden p-0 border-border/50 rounded-xl">
              <div className="px-3 py-2 border-b text-xs font-medium">Pagos (Savio)</div>
              {apiLoading ? (
                <Skeleton className="h-48 m-3 rounded-lg" />
              ) : paymentRows.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground text-xs px-3">
                  Sin pagos en la respuesta o lista vacía.
                </div>
              ) : (
                <div className="rounded-lg overflow-x-auto max-h-[320px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Referencia</TableHead>
                        <TableHead className="text-xs">Fecha</TableHead>
                        <TableHead className="text-right text-xs">Monto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paymentRows.slice(0, 80).map((row) => (
                        <TableRow
                          key={row.key}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setApiDetail({ title: "Pago", raw: row.raw })}
                        >
                          <TableCell className="text-xs max-w-[180px] truncate">{row.referencia}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {row.fecha
                              ? Number.isNaN(Date.parse(row.fecha))
                                ? row.fecha
                                : format(new Date(row.fecha), "dd MMM yy", { locale: es })
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right text-xs whitespace-nowrap">
                            {row.monto !== null ? formatMoney(row.monto) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="webhooks" className="mt-0 space-y-4">
          {whLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-24 rounded-2xl" />
              ))}
            </div>
          ) : whError ? (
            <p className="text-sm text-destructive">
              No se pudieron cargar los eventos. Verifica permisos o la migración RLS de{" "}
              <code className="text-xs">savio_webhook_events</code>.
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
                  <Banknote className="h-3.5 w-3.5" /> Pagos (payload)
                </div>
                <p className="text-lg font-semibold text-green-600">
                  {stats.paymentCount > 0 ? formatMoney(stats.paymentsSum) : "—"}
                </p>
                <p className="text-xs text-muted-foreground">{stats.paymentCount} con monto en payload</p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <FileText className="h-3.5 w-3.5" /> Cargos / estado
                </div>
                <p className="text-lg font-semibold">{stats.invoiceUpdates}</p>
                <p className="text-xs text-muted-foreground">Cambios (30 días)</p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Activity className="h-3.5 w-3.5" /> En vista
                </div>
                <p className="text-lg font-semibold">{filtered.length}</p>
                <p className="text-xs text-muted-foreground">de {events.length} en Kawiil</p>
              </div>
            </div>
          )}

          {!whLoading && !whError && (
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
                      ? "Aún no hay eventos. Configura el webhook en Savio."
                      : "Ningún evento coincide con los filtros."}
                  </div>
                ) : (
                  <div className="rounded-lg border overflow-x-auto max-h-[420px] overflow-y-auto">
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
        </TabsContent>
      </Tabs>

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

      <Sheet open={!!apiDetail} onOpenChange={(o) => !o && setApiDetail(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{apiDetail?.title || "Detalle"}</SheetTitle>
          </SheetHeader>
          {apiDetail && (
            <pre className="mt-4 p-3 rounded-lg bg-muted text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(apiDetail.raw, null, 2)}
            </pre>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
