import { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { es } from "date-fns/locale";
import {
  Activity,
  Banknote,
  ExternalLink,
  FileText,
  LayoutDashboard,
  Loader2,
  Plug,
  Radio,
  RefreshCw,
  Repeat,
  Search,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  savioFinanceApiFailureHint,
  savioMissingSecretsUserMessage,
} from "@/lib/savioFinanceApiHints";
import { SavioFinanceWriteActions } from "@/components/finanzas/SavioFinanceWriteActions";
import { getSavioAppPanelUrl } from "@/lib/savioAppUrl";
import { rollupSavioInvoicesByCustomer } from "@/lib/savioCustomerRollup";
import { fetchSavioResource, type SavioFinanceApiAction } from "@/lib/savioFinanceInvoke";
import { Link } from "react-router-dom";
import { useClients } from "@/hooks/useClients";
import { savioCustomersMissingInKawiil } from "@/lib/clientSavioLink";
import {
  ClientFormDialog,
  type ClientFormSavioPrefill,
} from "@/components/clients/ClientFormDialog";

const EVENT_FILTER_ALL = "todos";

function formatMoney(n: number) {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

/** Evita GET con ids sintéticos de la lista local (`row-0`, `pay-1`). */
function looksLikeRealSavioResourceId(id: string): boolean {
  const t = id.trim();
  if (t.length < 4 || t.length > 128) return false;
  if (/^(row|pay)-\d+$/i.test(t)) return false;
  return /^[a-zA-Z0-9\-_.]+$/.test(t);
}

type SavioApiDetailState = {
  title: string;
  raw: unknown;
  detailAction: SavioFinanceApiAction | null;
  detailResourceId: string | null;
};

function savioDetailPathLabel(action: SavioFinanceApiAction, resourceId: string): string {
  const base = action === "invoices" ? "invoice" : action === "payments" ? "payment" : "customer";
  return `/${base}/${resourceId}`;
}

export function SavioFinanceDashboard() {
  const savioPanelUrl = getSavioAppPanelUrl();
  const [section, setSection] = useState<"resumen" | "clientes" | "webhooks">("resumen");
  const [invoiceCustomerFilter, setInvoiceCustomerFilter] = useState<string | null>(null);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [kawiilClientFormOpen, setKawiilClientFormOpen] = useState(false);
  const [savioClientPrefill, setSavioClientPrefill] = useState<ClientFormSavioPrefill | null>(null);

  const {
    invoiceRows,
    paymentRows,
    customerRows,
    invoiceAgg,
    paymentAgg,
    invoicesMeta,
    paymentsMeta,
    invoicePickOptions,
    customerPickOptions,
    isLoading: apiLoading,
    isFetching: apiFetching,
    refetchAll,
    reactQueryError,
    invoiceQueryActive,
  } = useSavioFinanceApiData({ invoiceCustomerId: invoiceCustomerFilter });

  const { data: kawiilClients = [] } = useClients();
  const savioOnlyRows = useMemo(
    () => savioCustomersMissingInKawiil(customerRows, kawiilClients),
    [customerRows, kawiilClients],
  );
  const kawiilWithoutSavioCount = useMemo(
    () => kawiilClients.filter((c) => !c.savio_customer_id?.trim()).length,
    [kawiilClients],
  );

  const customerRollup = useMemo(() => rollupSavioInvoicesByCustomer(invoiceRows), [invoiceRows]);

  const { data: events = [], isLoading: whLoading, isError: whError, refetch: refetchWh, isFetching: whFetching } =
    useSavioWebhookEvents();

  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState(EVENT_FILTER_ALL);
  const [detail, setDetail] = useState<SavioFinanceEvent | null>(null);
  const [apiDetail, setApiDetail] = useState<SavioApiDetailState | null>(null);
  const [liveDetailData, setLiveDetailData] = useState<unknown | null>(null);
  const [liveDetailLoading, setLiveDetailLoading] = useState(false);
  const [liveDetailErr, setLiveDetailErr] = useState<string | null>(null);

  useEffect(() => {
    setLiveDetailData(null);
    setLiveDetailErr(null);
    setLiveDetailLoading(false);
  }, [apiDetail]);

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
    if (section === "resumen" || section === "clientes") void refetchAll();
    else void refetchWh();
  }

  const busy = section === "webhooks" ? whFetching : apiFetching;

  async function fetchLiveSavioDetail() {
    if (!apiDetail?.detailAction || !apiDetail.detailResourceId) return;
    setLiveDetailLoading(true);
    setLiveDetailErr(null);
    try {
      const res = await fetchSavioResource(apiDetail.detailAction, {}, apiDetail.detailResourceId);
      setLiveDetailData(res.data ?? null);
      if (res.ok !== true) {
        const msg =
          (typeof res.message === "string" && res.message.trim()) ||
          (typeof res.error === "string" && res.error.trim()) ||
          "La API no devolvió el detalle esperado.";
        setLiveDetailErr(msg);
        toast.error(msg);
        return;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error inesperado al consultar Savio.";
      setLiveDetailErr(msg);
      setLiveDetailData(null);
      toast.error(msg);
    } finally {
      setLiveDetailLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="surface-toolbar flex flex-col gap-3 p-4 md:p-5">
        <p className="text-sm text-muted-foreground max-w-3xl">
          <strong className="text-foreground">Facturas y pagos</strong> se leen en vivo desde la API Savio (misma
          clave que usa el despacho). <strong className="text-foreground">Clientes</strong> lista altas recientes.{" "}
          <strong className="text-foreground">Notificaciones</strong> son webhooks guardados en Kawiil para auditoría.
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setRecurringOpen(true)}
          >
            <Repeat className="h-3.5 w-3.5 mr-1" />
            Cobro recurrente
          </Button>
          <SavioFinanceWriteActions
            invoicePickOptions={invoicePickOptions}
            customerPickOptions={customerPickOptions}
            savioAppUrl={savioPanelUrl}
          />
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

      <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Alineación Kawiil ↔ Savio
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
              {kawiilWithoutSavioCount} cliente{kawiilWithoutSavioCount !== 1 ? "s" : ""} en Kawiil sin id Savio ·{" "}
              {savioOnlyRows.length} en la lista de Savio sin ficha enlazada en Kawiil (según ids guardados).
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs shrink-0" asChild>
            <Link to="/clientes">Abrir Clientes</Link>
          </Button>
        </div>
        {apiLoading && customerRows.length === 0 ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : savioOnlyRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No hay clientes Savio huérfanos respecto a Kawiil en esta vista.</p>
        ) : (
          <div className="rounded-lg border border-border/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs h-9">Cliente (Savio)</TableHead>
                  <TableHead className="text-xs h-9 w-[100px]">RFC</TableHead>
                  <TableHead className="text-xs h-9 w-[120px] text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {savioOnlyRows.slice(0, 12).map((row) => (
                  <TableRow key={row.key} className="text-xs">
                    <TableCell className="py-2">
                      <span className="font-medium text-foreground">{row.displayName}</span>
                      <span className="block text-[10px] text-muted-foreground font-mono truncate max-w-[220px]">
                        {row.id}
                      </span>
                    </TableCell>
                    <TableCell className="py-2 text-muted-foreground">{row.rfc ?? "—"}</TableCell>
                    <TableCell className="py-2 text-right">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => {
                          setSavioClientPrefill({
                            savio_customer_id: row.id,
                            name: row.displayName,
                            rfc: row.rfc ?? undefined,
                            email: row.email ?? undefined,
                            phone: row.phone ?? undefined,
                          });
                          setKawiilClientFormOpen(true);
                        }}
                      >
                        Alta en Kawiil
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {savioOnlyRows.length > 12 ? (
              <p className="text-[10px] text-muted-foreground px-3 py-2 border-t border-border/50">
                Mostrando 12 de {savioOnlyRows.length}. Ajusta enlaces desde la ficha del cliente o Clientes.
              </p>
            ) : null}
          </div>
        )}
      </div>

      <Dialog open={recurringOpen} onOpenChange={setRecurringOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cobros recurrentes</DialogTitle>
            <DialogDescription className="text-left text-sm leading-relaxed">
              Los planes y rutas de Savio para suscripciones o cobros automáticos dependen de tu contrato y de la
              OpenAPI publicada. En Kawiil aún no hay una operación genérica desplegada para todos los entornos; hasta
              alinearla con <span className="font-medium">app.savio.mx/docs</span>, gestiona recurrentes en el panel
              Savio.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-start">
            {savioPanelUrl ? (
              <Button type="button" size="sm" asChild>
                <a href={savioPanelUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                  Abrir Savio
                </a>
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => setRecurringOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs value={section} onValueChange={(v) => setSection(v as "resumen" | "clientes" | "webhooks")} className="space-y-4">
        <div className="surface-toolbar inline-flex w-full max-w-full p-2 md:max-w-2xl">
        <TabsList className="h-9 w-full max-w-2xl flex-wrap justify-start gap-1 bg-transparent">
          <TabsTrigger value="resumen" className="text-xs gap-1.5">
            <LayoutDashboard className="h-3.5 w-3.5" /> Facturas y pagos
          </TabsTrigger>
          <TabsTrigger value="clientes" className="text-xs gap-1.5">
            <Users className="h-3.5 w-3.5" /> Clientes
          </TabsTrigger>
          <TabsTrigger value="webhooks" className="text-xs gap-1.5">
            <Radio className="h-3.5 w-3.5" /> Notificaciones
          </TabsTrigger>
        </TabsList>
        </div>

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

          {invoiceQueryActive ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs">
              <span>
                Mostrando solo facturas del cliente seleccionado (filtro <code className="rounded bg-background px-1">customer_id</code> en la API).
              </span>
              <Button type="button" variant="secondary" size="sm" className="h-7 text-xs" onClick={() => setInvoiceCustomerFilter(null)}>
                Quitar filtro
              </Button>
            </div>
          ) : null}

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
                  <FileText className="h-3.5 w-3.5" /> Facturas en esta vista
                </div>
                <p className="text-lg font-semibold">{invoiceRows.length}</p>
                <p className="text-xs text-muted-foreground">
                  {invoiceAgg.withAmount > 0
                    ? `Suma importes: ${formatMoney(invoiceAgg.sum)}`
                    : "Montos si Savio los envía en cada ítem"}
                </p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Banknote className="h-3.5 w-3.5" /> Pagos en esta vista
                </div>
                <p className="text-lg font-semibold text-green-600">
                  {paymentAgg.withAmount > 0 ? formatMoney(paymentAgg.sum) : paymentRows.length > 0 ? "—" : "0"}
                </p>
                <p className="text-xs text-muted-foreground">{paymentRows.length} movimientos (hasta 100)</p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Activity className="h-3.5 w-3.5" /> Webhooks (30 días)
                </div>
                <p className="text-lg font-semibold">{stats.recentTotal}</p>
                <p className="text-xs text-muted-foreground">Pestaña Notificaciones</p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <LayoutDashboard className="h-3.5 w-3.5" /> Límite de lista
                </div>
                <p className="text-lg font-semibold">100</p>
                <p className="text-xs text-muted-foreground">Registros por consulta GET</p>
              </div>
            </div>
          )}

          {!apiLoading && customerRollup.length > 0 ? (
            <div className="glass-card overflow-hidden p-0 border-border/50 rounded-xl">
              <div className="px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium">Resumen por cliente</p>
                  <p className="text-[11px] text-muted-foreground">
                    Calculado con los cargos de la lista actual{invoiceQueryActive ? " (filtrada)" : ""}. Requiere{" "}
                    <code className="text-[10px]">customer_id</code> en el payload cuando Savio lo envía.
                  </p>
                </div>
                {savioPanelUrl ? (
                  <a
                    href={savioPanelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-primary underline inline-flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" /> Savio
                  </a>
                ) : null}
              </div>
              <div className="overflow-x-auto max-h-[220px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Cliente</TableHead>
                      <TableHead className="text-right text-xs">Pendiente / por cobrar</TableHead>
                      <TableHead className="text-right text-xs">Al día / cobrado</TableHead>
                      <TableHead className="text-right text-xs">Cargos</TableHead>
                      <TableHead className="text-xs w-[120px]">Acción</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerRollup.slice(0, 40).map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="text-xs max-w-[200px]">
                          <span className="font-medium">{r.displayName}</span>
                          {r.customerId ? (
                            <p className="text-[10px] font-mono text-muted-foreground truncate">{r.customerId}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-amber-700 dark:text-amber-400">
                          {formatMoney(r.totalPendiente)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-emerald-700 dark:text-emerald-400">
                          {formatMoney(r.totalAlDia)}
                        </TableCell>
                        <TableCell className="text-right text-xs">{r.invoiceCount}</TableCell>
                        <TableCell className="text-xs">
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto p-0 text-xs"
                            disabled={!r.customerId}
                            title={!r.customerId ? "Sin id de cliente en la API para filtrar" : undefined}
                            onClick={() => r.customerId && setInvoiceCustomerFilter(r.customerId)}
                          >
                            Ver facturas
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="glass-card overflow-hidden p-0 border-border/50 rounded-xl">
              <div className="px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs font-medium">
                <span>Facturas y cargos</span>
                {savioPanelUrl ? (
                  <a href={savioPanelUrl} target="_blank" rel="noopener noreferrer" className="font-normal text-primary underline text-[11px]">
                    Abrir en Savio
                  </a>
                ) : null}
              </div>
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
                        <TableHead className="text-xs">Folio</TableHead>
                        <TableHead className="text-xs">Cliente</TableHead>
                        <TableHead className="text-xs">Vencimiento</TableHead>
                        <TableHead className="text-xs">Estado</TableHead>
                        <TableHead className="text-right text-xs">Monto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoiceRows.slice(0, 80).map((row) => (
                        <TableRow
                          key={row.key}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() =>
                            setApiDetail({
                              title: "Factura / cargo",
                              raw: row.raw,
                              detailAction: looksLikeRealSavioResourceId(row.id) ? "invoices" : null,
                              detailResourceId: looksLikeRealSavioResourceId(row.id) ? row.id : null,
                            })
                          }
                        >
                          <TableCell className="text-xs font-mono max-w-[100px] truncate">{row.folio}</TableCell>
                          <TableCell className="text-xs max-w-[120px] truncate">{row.cliente}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {row.dueDate
                              ? Number.isNaN(Date.parse(row.dueDate))
                                ? row.dueDate
                                : format(new Date(row.dueDate), "dd MMM yy", { locale: es })
                              : "—"}
                          </TableCell>
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
              <div className="px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs font-medium">
                <span>Pagos registrados</span>
                {savioPanelUrl ? (
                  <a href={savioPanelUrl} target="_blank" rel="noopener noreferrer" className="font-normal text-primary underline text-[11px]">
                    Abrir en Savio
                  </a>
                ) : null}
              </div>
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
                        <TableHead className="text-xs">Factura</TableHead>
                        <TableHead className="text-xs">Fecha pago</TableHead>
                        <TableHead className="text-right text-xs">Monto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paymentRows.slice(0, 80).map((row) => (
                        <TableRow
                          key={row.key}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() =>
                            setApiDetail({
                              title: "Pago",
                              raw: row.raw,
                              detailAction: looksLikeRealSavioResourceId(row.id) ? "payments" : null,
                              detailResourceId: looksLikeRealSavioResourceId(row.id) ? row.id : null,
                            })
                          }
                        >
                          <TableCell className="text-xs max-w-[140px] truncate">{row.referencia}</TableCell>
                          <TableCell className="text-xs font-mono max-w-[100px] truncate">
                            {row.invoiceId ?? "—"}
                          </TableCell>
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

        <TabsContent value="clientes" className="mt-0 space-y-4">
          {reactQueryError && (
            <p className="text-xs text-destructive border border-destructive/30 rounded-lg px-3 py-2">
              Error al cargar clientes: {reactQueryError.message}
            </p>
          )}
          <div className="glass-card overflow-hidden p-0 border-border/50 rounded-xl">
            <div className="px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium">Clientes dados de alta</p>
                <p className="text-[11px] text-muted-foreground">Hasta 100 registros por consulta a GET /customer.</p>
              </div>
              {savioPanelUrl ? (
                <a href={savioPanelUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary underline inline-flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" /> Savio
                </a>
              ) : null}
            </div>
            {apiLoading ? (
              <Skeleton className="h-48 m-3 rounded-lg" />
            ) : customerRows.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-xs px-3">
                Sin clientes en la respuesta o lista vacía.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Nombre</TableHead>
                      <TableHead className="text-xs">Correo</TableHead>
                      <TableHead className="text-xs">Teléfono</TableHead>
                      <TableHead className="text-xs">Id Savio</TableHead>
                      <TableHead className="text-xs w-[100px]">Acción</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerRows.map((c) => (
                      <TableRow key={c.key}>
                        <TableCell className="text-xs font-medium max-w-[180px] truncate">{c.displayName}</TableCell>
                        <TableCell className="text-xs max-w-[160px] truncate">{c.email ?? "—"}</TableCell>
                        <TableCell className="text-xs">{c.phone ?? "—"}</TableCell>
                        <TableCell className="text-xs font-mono truncate max-w-[120px]">{c.id}</TableCell>
                        <TableCell className="text-xs">
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto p-0 text-xs"
                            onClick={() => setInvoiceCustomerFilter(c.id)}
                          >
                            Ver facturas
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
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
            <div className="mt-4 space-y-3 text-xs">
              {apiDetail.detailAction && apiDetail.detailResourceId ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground break-all">
                    GET{" "}
                    <span className="font-mono text-[10px]">
                      {savioDetailPathLabel(apiDetail.detailAction, apiDetail.detailResourceId)}
                    </span>{" "}
                    (vía Edge). Si Savio no expone esta ruta en tu plan, revisa el cuerpo JSON y{" "}
                    <code className="text-[10px]">savio_http_status</code>.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={liveDetailLoading}
                    onClick={() => void fetchLiveSavioDetail()}
                  >
                    {liveDetailLoading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        Consultando…
                      </>
                    ) : (
                      "Actualizar detalle desde API"
                    )}
                  </Button>
                  {liveDetailErr ? (
                    <p className="text-destructive text-[11px]">{liveDetailErr}</p>
                  ) : null}
                  {liveDetailData !== null ? (
                    <pre className="p-3 rounded-lg bg-muted text-[11px] overflow-x-auto whitespace-pre-wrap break-all max-h-[240px] overflow-y-auto">
                      {JSON.stringify(liveDetailData, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground text-[11px]">
                  Este registro no tiene un id reconocido para consultar detalle por GET; revisa el JSON de la lista o
                  abre el cargo en Savio.
                </p>
              )}
              <p className="text-muted-foreground font-medium">Lista (normalizado en cliente)</p>
              <pre className="p-3 rounded-lg bg-muted text-[11px] overflow-x-auto whitespace-pre-wrap break-all max-h-[280px] overflow-y-auto">
                {JSON.stringify(apiDetail.raw, null, 2)}
              </pre>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ClientFormDialog
        open={kawiilClientFormOpen}
        onOpenChange={(open) => {
          setKawiilClientFormOpen(open);
          if (!open) setSavioClientPrefill(null);
        }}
        savioPrefill={savioClientPrefill}
      />
    </div>
  );
}
