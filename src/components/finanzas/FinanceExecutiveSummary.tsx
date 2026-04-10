import { useMemo } from "react";
import { subDays } from "date-fns";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import type { Expense } from "@/hooks/useExpenses";
import { useSavioFinanceApiData } from "@/hooks/useSavioFinanceApi";
import { computeSavioIncomeBuckets } from "@/lib/savioApiNormalize";
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

function formatMoney(n: number) {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

interface Props {
  expenses: Expense[];
}

export function FinanceExecutiveSummary({ expenses }: Props) {
  const {
    invoiceRows,
    paymentAgg,
    isLoading: apiLoading,
    reactQueryError,
    invoicesMeta,
    paymentsMeta,
  } = useSavioFinanceApiData();

  const since = useMemo(() => subDays(new Date(), 30), []);

  const expenseMetrics = useMemo(() => {
    const inPeriod = (e: Expense) => new Date(e.expense_date) >= since;
    const paid = expenses.filter((e) => e.status === "pagado" && inPeriod(e));
    const approved = expenses.filter((e) => e.status === "aprobado");
    const pendingFlow = expenses.filter((e) => ["solicitado", "en_revision"].includes(e.status));
    const sum = (arr: Expense[]) => arr.reduce((s, e) => s + Number(e.amount), 0);
    return {
      paid30: sum(paid),
      paid30Count: paid.length,
      approvedTotal: sum(approved),
      approvedCount: approved.length,
      pendingTotal: sum(pendingFlow),
      pendingCount: pendingFlow.length,
    };
  }, [expenses, since]);

  const buckets = useMemo(() => computeSavioIncomeBuckets(invoiceRows), [invoiceRows]);

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

  const cobradoDesdePagos = paymentAgg.sum;
  const compareData = useMemo(
    () => [
      { name: "Ingresos (pagos Savio)", monto: cobradoDesdePagos },
      { name: "Gastos pagados (30 d)", monto: expenseMetrics.paid30 },
    ],
    [cobradoDesdePagos, expenseMetrics.paid30],
  );

  const apiIncomplete =
    !apiLoading &&
    invoicesMeta?.ok !== true &&
    paymentsMeta?.ok !== true &&
    invoiceRows.length === 0 &&
    paymentAgg.withAmount === 0;

  const savioConfigHint =
    savioFinanceApiFailureHint(invoicesMeta) ?? savioFinanceApiFailureHint(paymentsMeta);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground max-w-3xl">
        Vista consolidada (últimos 30 días para gastos pagados). Los cargos Savio se clasifican por texto de
        estado; si Savio usa otros valores, los totales se pueden afinar más adelante.
      </p>

      {(reactQueryError || savioConfigHint) && (
        <p className="text-xs text-destructive border border-destructive/30 rounded-lg px-3 py-2">
          {reactQueryError
            ? `Error al cargar Savio: ${reactQueryError.message}`
            : savioConfigHint}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card">
          <div className="text-muted-foreground text-xs mb-1">Gastos pagados (30 d)</div>
          <p className="text-lg font-semibold text-purple-600">{formatMoney(expenseMetrics.paid30)}</p>
          <p className="text-xs text-muted-foreground">{expenseMetrics.paid30Count} movimientos</p>
        </div>
        <div className="stat-card">
          <div className="text-muted-foreground text-xs mb-1">Gastos aprobados (total)</div>
          <p className="text-lg font-semibold text-amber-700">{formatMoney(expenseMetrics.approvedTotal)}</p>
          <p className="text-xs text-muted-foreground">{expenseMetrics.approvedCount} por pagar</p>
        </div>
        <div className="stat-card">
          <div className="text-muted-foreground text-xs mb-1">En flujo solicitud</div>
          <p className="text-lg font-semibold">{formatMoney(expenseMetrics.pendingTotal)}</p>
          <p className="text-xs text-muted-foreground">{expenseMetrics.pendingCount} solicitudes</p>
        </div>
        <div className="stat-card">
          <div className="text-muted-foreground text-xs mb-1">Pagos Savio (lista API)</div>
          <p className="text-lg font-semibold text-green-600">{formatMoney(cobradoDesdePagos)}</p>
          <p className="text-xs text-muted-foreground">{paymentAgg.withAmount} con monto</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass-card rounded-xl border border-border/50 p-4">
          <h3 className="text-sm font-medium mb-1">Cargos por estado (Savio)</h3>
          <p className="text-xs text-muted-foreground mb-4">Suma de montos en la lista de facturas/cargos</p>
          {apiLoading ? (
            <Skeleton className="h-[220px] w-full rounded-lg" />
          ) : pieData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground text-center px-4">
              {apiIncomplete
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

        <div className="glass-card rounded-xl border border-border/50 p-4">
          <h3 className="text-sm font-medium mb-1">Ingresos (pagos) vs gastos pagados</h3>
          <p className="text-xs text-muted-foreground mb-4">Misma ventana de 30 días en gastos; pagos Savio de la lista actual</p>
          {apiLoading ? (
            <Skeleton className="h-[220px] w-full rounded-lg" />
          ) : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={compareData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-12} textAnchor="end" height={56} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => formatMoney(v)} />
                  <Bar dataKey="monto" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
