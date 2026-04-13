import { useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSavioFinanceApiData } from "@/hooks/useSavioFinanceApi";
import { useSavioIncomeAccess } from "@/hooks/useSavioIncomeAccess";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useAuth } from "@/contexts/AuthContext";
import { SavioFinanceWriteActions } from "@/components/finanzas/SavioFinanceWriteActions";
import { getSavioAppPanelUrl } from "@/lib/savioAppUrl";
import { rollupSavioInvoicesByCustomer } from "@/lib/savioCustomerRollup";
import { fetchSavioResource } from "@/lib/savioFinanceInvoke";
import { pickSavioString } from "@/lib/savioApiNormalize";
import { clientSavioLinkStatus, normalizeRfcForCompare } from "@/lib/clientSavioLink";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

function formatMoney(n: number) {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

type ClientSavioFinanceSectionProps = {
  client: Tables<"clients">;
  /** Lista Savio de clientes (misma org) para sugerencias RFC; puede vacío si no hay permiso. */
  savioCustomerRowsForHints?: import("@/hooks/useSavioFinanceApi").SavioCustomerRowView[];
};

export function ClientSavioFinanceSection({
  client,
  savioCustomerRowsForHints = [],
}: ClientSavioFinanceSectionProps) {
  const savioPanelUrl = getSavioAppPanelUrl();
  const { user } = useAuth();
  const { hasFinanceAccess, isLoading: accessLoading } = useFinanceAccess();
  const { data: canViewSavioIncome = false, isLoading: savioAccessLoading } = useSavioIncomeAccess();

  const savioId = client.savio_customer_id?.trim() || null;
  const allowSavio = !!user && hasFinanceAccess && canViewSavioIncome && !accessLoading && !savioAccessLoading;

  const {
    invoiceRows,
    paymentRows,
    customerRows,
    invoicePickOptions,
    customerPickOptions,
    isLoading: apiLoading,
    isFetching: apiFetching,
    refetchAll,
    reactQueryError,
  } = useSavioFinanceApiData({
    invoiceCustomerId: savioId,
    fetchEnabled: !!savioId,
  });

  const customerRowsMerged = savioCustomerRowsForHints.length > 0 ? savioCustomerRowsForHints : customerRows;

  const invoiceIdSet = useMemo(() => new Set(invoiceRows.map((r) => r.id)), [invoiceRows]);
  const paymentRowsForClient = useMemo(
    () =>
      savioId
        ? paymentRows.filter((p) => {
            if (p.invoiceId && invoiceIdSet.has(p.invoiceId)) return true;
            const raw = p.raw;
            if (raw && typeof raw === "object") {
              const cid = pickSavioString(raw, ["customer_id", "customer_uuid", "customerId"]);
              return cid !== "—" && cid === savioId;
            }
            return false;
          })
        : [],
    [paymentRows, savioId, invoiceIdSet],
  );

  const rollupOne = useMemo(() => {
    const rows = rollupSavioInvoicesByCustomer(invoiceRows);
    return rows[0] ?? null;
  }, [invoiceRows]);

  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [savioDetailPayload, setSavioDetailPayload] = useState<unknown | null>(null);

  async function runReconcile() {
    if (!savioId) return;
    setReconcileLoading(true);
    setSavioDetailPayload(null);
    try {
      const res = await fetchSavioResource("customers", {}, savioId);
      setSavioDetailPayload(res.data ?? null);
      if (res.ok !== true) {
        toast.error(res.message || res.error || "No se pudo leer el cliente en Savio.");
        return;
      }
      toast.success("Datos de Savio actualizados en pantalla.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al consultar Savio.");
    } finally {
      setReconcileLoading(false);
    }
  }

  const linkInfo = clientSavioLinkStatus(
    {
      id: client.id,
      name: client.name,
      rfc: client.rfc,
      savio_customer_id: client.savio_customer_id,
    },
    customerRowsMerged,
    savioDetailPayload,
  );

  if (!allowSavio) {
    return (
      <p className="text-sm text-muted-foreground">
        No tienes permiso para ver ingresos Savio o el módulo Finanzas. Solicita acceso para ver cobranza aquí.
      </p>
    );
  }

  if (!savioId) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Este cliente no está enlazado con un registro en Savio. Edita el cliente y asigna el{" "}
          <strong className="text-foreground">id de cliente Savio</strong> o usa la sugerencia por RFC si aparece en
          Finanzas.
        </p>
        {linkInfo.status === "rfc_suggest" && linkInfo.suggestedSavioIds.length > 0 ? (
          <p className="text-amber-800 dark:text-amber-200 text-xs rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            Hay {linkInfo.suggestedSavioIds.length} cliente(s) en Savio con el mismo RFC. Abre{" "}
            <strong>Editar cliente</strong> y enlaza el correcto.
          </p>
        ) : null}
        {savioPanelUrl ? (
          <Button type="button" variant="outline" size="sm" asChild>
            <a href={savioPanelUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Abrir Savio
            </a>
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {reactQueryError && (
        <p className="text-xs text-destructive border border-destructive/30 rounded-lg px-3 py-2">
          {reactQueryError.message}
        </p>
      )}

      {linkInfo.status === "rfc_mismatch" ? (
        <p className="text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-950 dark:text-amber-100">
          El RFC en Kawiil (
          <span className="font-mono">{normalizeRfcForCompare(client.rfc) || "—"}</span>) no coincide con el último
          detalle leído de Savio. Revisa en Savio o corrige la ficha.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={apiFetching || reconcileLoading}
          onClick={() => void refetchAll()}
        >
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1", apiFetching && "animate-spin")} />
          Actualizar listas
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 text-xs"
          disabled={reconcileLoading}
          onClick={() => void runReconcile()}
        >
          {reconcileLoading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
          Reconciliar con Savio (GET cliente)
        </Button>
        {savioPanelUrl ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" asChild>
            <a href={savioPanelUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Savio
            </a>
          </Button>
        ) : null}
      </div>

      {apiLoading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="rounded-lg border bg-card/50 p-2">
            <p className="text-muted-foreground">Facturas (vista)</p>
            <p className="text-lg font-semibold">{invoiceRows.length}</p>
          </div>
          <div className="rounded-lg border bg-card/50 p-2">
            <p className="text-muted-foreground">Pendiente (suma)</p>
            <p className="text-lg font-semibold text-amber-700 dark:text-amber-400">
              {rollupOne ? formatMoney(rollupOne.totalPendiente) : "—"}
            </p>
          </div>
          <div className="rounded-lg border bg-card/50 p-2">
            <p className="text-muted-foreground">Al día / cobrado</p>
            <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">
              {rollupOne ? formatMoney(rollupOne.totalAlDia) : "—"}
            </p>
          </div>
          <div className="rounded-lg border bg-card/50 p-2">
            <p className="text-muted-foreground">Pagos (filtrados)</p>
            <p className="text-lg font-semibold">{paymentRowsForClient.length}</p>
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Hasta 100 facturas y 100 pagos por consulta a la API. Los pagos se filtran por cargos de este cliente o por{" "}
        <code className="text-[10px]">customer_id</code> en el payload si Savio lo envía.
      </p>

      <SavioFinanceWriteActions
        invoicePickOptions={invoicePickOptions}
        customerPickOptions={customerPickOptions}
        savioAppUrl={savioPanelUrl}
        initialCustomerId={savioId}
      />

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border overflow-hidden">
          <div className="px-2 py-1.5 border-b text-xs font-medium">Facturas / cargos</div>
          <div className="max-h-[240px] overflow-auto">
            {apiLoading ? (
              <Skeleton className="h-32 m-2" />
            ) : invoiceRows.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground text-center">Sin facturas en esta vista.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Folio</TableHead>
                    <TableHead className="text-xs">Estado</TableHead>
                    <TableHead className="text-right text-xs">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoiceRows.slice(0, 40).map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="text-xs font-mono truncate max-w-[100px]">{row.folio}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {row.estado}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs whitespace-nowrap">
                        {row.monto != null ? formatMoney(row.monto) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
        <div className="rounded-xl border overflow-hidden">
          <div className="px-2 py-1.5 border-b text-xs font-medium">Pagos relacionados</div>
          <div className="max-h-[240px] overflow-auto">
            {apiLoading ? (
              <Skeleton className="h-32 m-2" />
            ) : paymentRowsForClient.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground text-center">Sin pagos filtrados para este cliente.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Ref.</TableHead>
                    <TableHead className="text-xs">Fecha</TableHead>
                    <TableHead className="text-right text-xs">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentRowsForClient.slice(0, 40).map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="text-xs truncate max-w-[120px]">{row.referencia}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {row.fecha
                          ? Number.isNaN(Date.parse(row.fecha))
                            ? row.fecha
                            : format(new Date(row.fecha), "dd MMM yy", { locale: es })
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {row.monto != null ? formatMoney(row.monto) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
