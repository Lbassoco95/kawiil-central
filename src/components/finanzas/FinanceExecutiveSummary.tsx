import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Expense } from "@/hooks/useExpenses";
import { useFinanceDashboardData } from "@/hooks/useFinanceDashboardData";
import {
  addMonths,
  FINANCE_DASHBOARD_MONTH_LOOKBACK,
  yearMonthFromDate,
  type YearMonth,
} from "@/lib/financeMonthMetrics";
import { computeSavioIncomeBuckets, toInvoiceRowView } from "@/lib/savioApiNormalize";
import { savioFinanceApiFailureHint } from "@/lib/savioFinanceApiHints";

const PIE_COLORS = {
  cobrado: "hsl(142 76% 36%)",
  pendiente: "hsl(38 92% 50%)",
  por_cobrar: "hsl(217 91% 60%)",
};

const PIE_LABELS: Record<string, string> = {
  cobrado: "Cobrado (cargos)",
  pendiente: "Pendiente",
  por_cobrar: "Por cobrar / otro",
};

function ymCompare(a: YearMonth, b: YearMonth): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

function formatMoney(n: number) {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function monthTitle(ym: YearMonth) {
  return format(new Date(ym.year, ym.month - 1, 1), "MMMM yyyy", { locale: es });
}

interface Props {
  expenses: Expense[];
  /** Si es false, no se consulta Savio: solo gastos y tendencia de gastos. */
  savioEnabled?: boolean;
}

export function FinanceExecutiveSummary({ expenses, savioEnabled = true }: Props) {
  const [selectedYm, setSelectedYm] = useState<YearMonth>(() => yearMonthFromDate(new Date()));

  const {
    kpis,
    trendBars,
    trendMonths,
    currentYm,
    truncated,
    isLoading,
    savioError,
    reactQueryError,
    invoiceRows,
  } = useFinanceDashboardData(selectedYm, expenses, { enableSavio: savioEnabled });

  const savioHint = savioFinanceApiFailureHint(savioError ?? undefined);

  const earliestSelectableYm = useMemo(
    () => addMonths(currentYm, -FINANCE_DASHBOARD_MONTH_LOOKBACK),
    [currentYm],
  );

  useEffect(() => {
    setSelectedYm((prev) => {
      if (ymCompare(prev, earliestSelectableYm) < 0) return earliestSelectableYm;
      if (ymCompare(prev, currentYm) > 0) return currentYm;
      return prev;
    });
  }, [currentYm, earliestSelectableYm]);

  const chartData = useMemo(
    () =>
      trendBars.map((row, i) => ({
        name: format(new Date(trendMonths[i].year, trendMonths[i].month - 1, 1), "MMM", { locale: es }),
        ingresos: row.ingresos,
        gastos: row.gastos,
      })),
    [trendBars, trendMonths],
  );

  const invoiceViews = useMemo(
    () => invoiceRows.map((raw, i) => toInvoiceRowView(raw, i)),
    [invoiceRows],
  );

  const buckets = useMemo(() => computeSavioIncomeBuckets(invoiceViews), [invoiceViews]);

  const pieData = useMemo(() => {
    const rows = [
      { key: "cobrado" as const, value: buckets.cobrado },
      { key: "pendiente" as const, value: buckets.pendiente },
      { key: "por_cobrar" as const, value: buckets.por_cobrar },
    ].filter((d) => d.value > 0);
    return rows.map((d) => ({
      name: PIE_LABELS[d.key],
      value: d.value,
      fill: PIE_COLORS[d.key],
    }));
  }, [buckets]);

  const pipeline = useMemo(() => {
    const approved = expenses.filter((e) => e.status === "aprobado");
    const pendingFlow = expenses.filter((e) => ["solicitado", "en_revision"].includes(e.status));
    const sum = (arr: Expense[]) => arr.reduce((s, e) => s + Number(e.amount), 0);
    return {
      approvedTotal: sum(approved),
      approvedCount: approved.length,
      pendingTotal: sum(pendingFlow),
      pendingCount: pendingFlow.length,
    };
  }, [expenses]);

  const nextDisabled = ymCompare(selectedYm, currentYm) >= 0;
  const prevDisabled = ymCompare(selectedYm, earliestSelectableYm) <= 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Mes anterior"
            disabled={prevDisabled}
            onClick={() => setSelectedYm((ym) => addMonths(ym, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Mes siguiente"
            disabled={nextDisabled}
            onClick={() => setSelectedYm((ym) => addMonths(ym, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div>
            <p className="text-sm font-medium capitalize">{monthTitle(selectedYm)}</p>
            <p className="text-xs text-muted-foreground max-w-xl">
              Mes calendario según la zona horaria de tu navegador. Cobrado: pagos Savio con{" "}
              <span className="font-medium">payment_date</span> en el mes. Gastos pagados:{" "}
              <span className="font-medium">paid_at</span> (o <span className="font-medium">expense_date</span> si no
              hay fecha de pago). Savio puede filtrar por fecha de actualización en servidor; las cifras del mes se
              afinan en cliente con las fechas del registro. Navegación limitada a los últimos{" "}
              {FINANCE_DASHBOARD_MONTH_LOOKBACK} meses respecto al mes actual.
            </p>
          </div>
        </div>
        {truncated && savioEnabled && (
          <p className="text-xs text-amber-700 dark:text-amber-500 border border-amber-500/40 rounded-lg px-3 py-2 max-w-md">
            Datos Savio truncados (límite de páginas). La cartera y los totales pueden quedar incompletos.
          </p>
        )}
      </div>

      {(reactQueryError || savioHint) && savioEnabled && (
        <p className="text-xs text-destructive border border-destructive/30 rounded-lg px-3 py-2">
          {reactQueryError
            ? `Error al cargar Savio: ${reactQueryError.message}`
            : savioHint}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {savioEnabled ? (
          <>
            <div className="stat-card">
              <div className="text-muted-foreground text-xs mb-1">Cobrado (mes)</div>
              {isLoading ? (
                <Skeleton className="h-7 w-28 mt-1" />
              ) : (
                <p className="text-lg font-semibold text-green-600">{formatMoney(kpis.cobradoMes.sum)}</p>
              )}
              <p className="text-xs text-muted-foreground">{kpis.cobradoMes.count} pagos en el mes</p>
            </div>
            <div className="stat-card">
              <div className="text-muted-foreground text-xs mb-1">Gastos pagados (mes)</div>
              <p className="text-lg font-semibold text-purple-600">{formatMoney(kpis.gastosMes.sum)}</p>
              <p className="text-xs text-muted-foreground">{kpis.gastosMes.count} movimientos</p>
            </div>
            <div className="stat-card">
              <div className="text-muted-foreground text-xs mb-1">Por cobrar (cartera)</div>
              {isLoading ? (
                <Skeleton className="h-7 w-28 mt-1" />
              ) : (
                <p className="text-lg font-semibold text-blue-600">{formatMoney(kpis.cartera.sum)}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Facturas <span className="font-medium">valid</span> con saldo; no es “del mes”.
              </p>
            </div>
            <div className="stat-card">
              <div className="text-muted-foreground text-xs mb-1">Facturado (mes)</div>
              {isLoading ? (
                <Skeleton className="h-7 w-28 mt-1" />
              ) : (
                <p className="text-lg font-semibold text-emerald-700">{formatMoney(kpis.facturadoMes.sum)}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {kpis.facturadoMes.count} facturas · invoice_date (excl. void)
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="stat-card">
              <div className="text-muted-foreground text-xs mb-1">Gastos pagados (mes)</div>
              <p className="text-lg font-semibold text-purple-600">{formatMoney(kpis.gastosMes.sum)}</p>
              <p className="text-xs text-muted-foreground">{kpis.gastosMes.count} movimientos</p>
            </div>
            <div className="stat-card">
              <div className="text-muted-foreground text-xs mb-1">Gastos aprobados (total)</div>
              <p className="text-lg font-semibold text-amber-700">{formatMoney(pipeline.approvedTotal)}</p>
              <p className="text-xs text-muted-foreground">{pipeline.approvedCount} por pagar</p>
            </div>
            <div className="stat-card">
              <div className="text-muted-foreground text-xs mb-1">En flujo solicitud</div>
              <p className="text-lg font-semibold">{formatMoney(pipeline.pendingTotal)}</p>
              <p className="text-xs text-muted-foreground">{pipeline.pendingCount} solicitudes</p>
            </div>
            <div className="stat-card">
              <div className="text-muted-foreground text-xs mb-1">Tendencia</div>
              <p className="text-xs text-muted-foreground leading-snug">
                Últimos 12 meses: solo gastos pagados (sin ingresos Savio en esta vista).
              </p>
            </div>
          </>
        )}
      </div>

      <div className="glass-card rounded-xl border border-border/50 p-4">
        <h3 className="text-sm font-medium mb-1">Tendencia: últimos 12 meses</h3>
        <p className="text-xs text-muted-foreground mb-4">
          {savioEnabled
            ? "Cobrado por payment_date vs gastos pagados por mes."
            : "Gastos pagados por mes (mismo criterio de fechas que arriba)."}
        </p>
        {savioEnabled && isLoading ? (
          <Skeleton className="h-[280px] w-full rounded-lg" />
        ) : (
          <div className="h-[280px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatMoney(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {savioEnabled && (
                  <Bar dataKey="ingresos" name="Cobrado (pagos)" fill="hsl(142 76% 36%)" radius={[4, 4, 0, 0]} />
                )}
                <Bar dataKey="gastos" name="Gastos pagados" fill="hsl(270 60% 52%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {!savioEnabled && chartData.every((d) => d.gastos === 0) && (
          <p className="text-sm text-muted-foreground text-center py-4">Sin gastos pagados en esta ventana.</p>
        )}
      </div>

      {savioEnabled && (
        <div className="glass-card rounded-xl border border-border/50 p-4">
          <h3 className="text-sm font-medium mb-1">Cargos por estado (Savio)</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Lista de facturas en la ventana consultada (hasta ~48 meses atrás); heurística por estado textual.
          </p>
          {isLoading ? (
            <Skeleton className="h-[220px] w-full rounded-lg" />
          ) : pieData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground text-center px-4">
              {savioHint || reactQueryError
                ? "Sin datos de cargos o la API no respondió. Revisa conexión Savio en la pestaña Ingresos."
                : "Ningún monto clasificado en cargos. Los estados pueden venir vacíos o en otro formato."}
            </div>
          ) : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={88}
                    paddingAngle={2}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatMoney(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <ul className="text-xs text-muted-foreground space-y-1 mt-2">
            <li>Cobrado: {formatMoney(buckets.cobrado)}</li>
            <li>Pendiente: {formatMoney(buckets.pendiente)}</li>
            <li>Por cobrar / otro: {formatMoney(buckets.por_cobrar)}</li>
          </ul>
        </div>
      )}
    </div>
  );
}
