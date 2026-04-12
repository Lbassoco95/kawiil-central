import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Landmark, PieChart as PieChartIcon, Receipt, Wallet } from "lucide-react";
import type { TooltipProps } from "recharts";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SavioFinanceWriteActions } from "@/components/finanzas/SavioFinanceWriteActions";
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
import { getSavioAppPanelUrl } from "@/lib/savioAppUrl";
import { SAVIO_FINANCE_PAGE_BOOST_STEP } from "@/lib/savioFinancePagedFetch";
import { cn } from "@/lib/utils";

const PIE_COLORS = {
  cobrado: "#0d9488",
  pendiente: "#d97706",
  por_cobrar: "#2563eb",
};

const PIE_LABELS: Record<string, string> = {
  cobrado: "Cobrado",
  pendiente: "Pendiente de cobro",
  por_cobrar: "Otros / sin clasificar",
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

function TrendTooltip({
  active,
  payload,
  label,
}: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-popover/95 px-3 py-2.5 text-sm shadow-xl backdrop-blur-md">
      <p className="mb-2 font-semibold capitalize text-foreground">{label}</p>
      <ul className="space-y-1.5">
        {payload.map((entry) => (
          <li key={String(entry.name)} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}
            </span>
            <span className="font-medium tabular-nums text-foreground">{formatMoney(Number(entry.value))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface KpiTileProps {
  title: string;
  subtitle: string;
  accentClass: string;
  icon: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}

function KpiTile({ title, subtitle, accentClass, icon, children, footer }: KpiTileProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border/50 bg-card/90 p-4 shadow-sm transition-all duration-300",
        "hover:-translate-y-0.5 hover:border-border hover:shadow-lg",
        "before:absolute before:inset-x-0 before:top-0 before:h-1 before:rounded-t-2xl",
        accentClass,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/90">{subtitle}</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-2 text-muted-foreground transition-colors group-hover:bg-muted">
          {icon}
        </div>
      </div>
      <div className="mt-3">{children}</div>
      <div className="mt-2 border-t border-border/40 pt-2">{footer}</div>
    </div>
  );
}

interface Props {
  expenses: Expense[];
  savioEnabled?: boolean;
  /** Cambia a la pestaña Ingresos facturados (listado Savio). */
  onGoToSavioTab?: () => void;
}

export function FinanceExecutiveSummary({ expenses, savioEnabled = true, onGoToSavioTab }: Props) {
  const [selectedYm, setSelectedYm] = useState<YearMonth>(() => yearMonthFromDate(new Date()));
  const gradId = useId().replace(/:/g, "");

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
    loadMoreSavioPages,
    canLoadMoreSavioPages,
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

  const invoicePickSummary = useMemo(
    () =>
      invoiceViews
        .filter((v) => v.id && v.id !== "—")
        .slice(0, 200)
        .map((v) => ({
          id: v.id,
          label: `${v.folio} · ${v.cliente !== "—" ? v.cliente : "Cliente"}${v.monto != null ? ` · ${formatMoney(v.monto)}` : ""}`,
        })),
    [invoiceViews],
  );

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

  const ingGrad = `ing-${gradId}`;
  const gastosGrad = `gastos-${gradId}`;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-muted/30 p-1 shadow-inner">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-lg"
              aria-label="Mes anterior"
              disabled={prevDisabled}
              onClick={() => setSelectedYm((ym) => addMonths(ym, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-lg"
              aria-label="Mes siguiente"
              disabled={nextDisabled}
              onClick={() => setSelectedYm((ym) => addMonths(ym, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="min-w-0 max-w-2xl">
            <p className="text-lg font-semibold capitalize tracking-tight text-foreground">{monthTitle(selectedYm)}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Vista mensual con el calendario de tu navegador. Los cobros se agrupan por la fecha en que se registró el
              pago; los gastos pagados, por la fecha de pago (o la del gasto si aún no hay pago registrado). Puedes
              desplazarte hasta {FINANCE_DASHBOARD_MONTH_LOOKBACK} meses hacia atrás.
            </p>
          </div>
        </div>
        {truncated && savioEnabled && (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-amber-900 shadow-sm dark:text-amber-100/90 space-y-2">
            <p>
              <span className="font-medium">Vista parcial.</span> Savio devolvió más registros de los que estamos
              trayendo por seguridad (paginación en el navegador). La cartera y algunos totales pueden quedar
              aproximados. Savio filtra por ventana de actualización, no siempre por fecha de pago o de factura.
            </p>
            <p className="text-[11px] opacity-95">
              Para subir el tope base configura{" "}
              <code className="rounded bg-amber-500/15 px-1">VITE_SAVIO_FINANCE_MAX_PAGES</code> y, si aplica,{" "}
              <code className="rounded bg-amber-500/15 px-1">VITE_SAVIO_FINANCE_PORTFOLIO_MAX_PAGES</code> (máximo
              efectivo acotado en la app).
            </p>
            {canLoadMoreSavioPages ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-amber-600/40 text-xs"
                disabled={isLoading}
                onClick={() => loadMoreSavioPages()}
                aria-label={`Aumentar hasta ${SAVIO_FINANCE_PAGE_BOOST_STEP} páginas extra por cada consulta a pagos y cartera`}
              >
                Cargar más (+{SAVIO_FINANCE_PAGE_BOOST_STEP} páginas por consulta)
              </Button>
            ) : (
              <p className="text-[11px] text-amber-950/80 dark:text-amber-100/80">
                Ya se alcanzó el límite de páginas en esta sesión. Revisa totales en Savio o eleva los topes en
                variables de entorno del front.
              </p>
            )}
          </div>
        )}
      </div>

      {savioEnabled && (
        <div className="rounded-xl border border-border/60 bg-card/60 p-4 shadow-sm space-y-2">
          <p className="text-xs font-medium text-foreground">Acciones Savio</p>
          <p className="text-[11px] text-muted-foreground max-w-2xl">
            Registrar pagos, crear cargos y dar de alta clientes desde aquí. Los permisos son los de Kawiil (rol
            Transformador o interruptor de escritura); el rol «admin» solo en Savio no habilita nada en este módulo. La
            API de Savio valida el formato (app.savio.mx).
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
            <SavioFinanceWriteActions
              invoicePickOptions={invoicePickSummary}
              savioAppUrl={getSavioAppPanelUrl()}
            />
            {onGoToSavioTab ? (
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={onGoToSavioTab}>
                Ir a Ingresos facturados (tablas y detalle)
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {(reactQueryError || savioHint) && savioEnabled && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          {reactQueryError ? `No se pudo cargar la facturación: ${reactQueryError.message}` : savioHint}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {savioEnabled ? (
          <>
            <KpiTile
              title="Ingresos cobrados"
              subtitle="Mes seleccionado, según fecha de pago registrada."
              accentClass="before:bg-teal-600"
              icon={<Landmark className="h-4 w-4" />}
              footer={
                <p className="text-[11px] text-muted-foreground">
                  {kpis.cobradoMes.count} pago{kpis.cobradoMes.count === 1 ? "" : "s"} en el periodo
                </p>
              }
            >
              {isLoading ? (
                <Skeleton className="h-8 w-32" />
              ) : (
                <p className="text-2xl font-semibold tabular-nums tracking-tight text-teal-700 dark:text-teal-400">
                  {formatMoney(kpis.cobradoMes.sum)}
                </p>
              )}
            </KpiTile>
            <KpiTile
              title="Gastos del mes"
              subtitle="Solo solicitudes ya pagadas."
              accentClass="before:bg-violet-600"
              icon={<Wallet className="h-4 w-4" />}
              footer={
                <p className="text-[11px] text-muted-foreground">
                  {kpis.gastosMes.count} movimiento{kpis.gastosMes.count === 1 ? "" : "s"}
                </p>
              }
            >
              <p className="text-2xl font-semibold tabular-nums tracking-tight text-violet-700 dark:text-violet-400">
                {formatMoney(kpis.gastosMes.sum)}
              </p>
            </KpiTile>
            <KpiTile
              title="Pendiente de cobro"
              subtitle="Saldo vivo de facturas abiertas; no pertenece a un solo mes."
              accentClass="before:bg-blue-600"
              icon={<Receipt className="h-4 w-4" />}
              footer={<p className="text-[11px] text-muted-foreground">Posición de cartera al cierre de la consulta</p>}
            >
              {isLoading ? (
                <Skeleton className="h-8 w-32" />
              ) : (
                <p className="text-2xl font-semibold tabular-nums tracking-tight text-blue-700 dark:text-blue-400">
                  {formatMoney(kpis.cartera.sum)}
                </p>
              )}
            </KpiTile>
            <KpiTile
              title="Facturación del mes"
              subtitle="Por fecha de emisión; no se incluyen facturas canceladas."
              accentClass="before:bg-emerald-600"
              icon={<Receipt className="h-4 w-4" />}
              footer={
                <p className="text-[11px] text-muted-foreground">
                  {kpis.facturadoMes.count} factura{kpis.facturadoMes.count === 1 ? "" : "s"} emitida
                  {kpis.facturadoMes.count === 1 ? "" : "s"} en el mes
                </p>
              }
            >
              {isLoading ? (
                <Skeleton className="h-8 w-32" />
              ) : (
                <p className="text-2xl font-semibold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400">
                  {formatMoney(kpis.facturadoMes.sum)}
                </p>
              )}
            </KpiTile>
          </>
        ) : (
          <>
            <KpiTile
              title="Gastos del mes"
              subtitle="Solo solicitudes ya pagadas."
              accentClass="before:bg-violet-600"
              icon={<Wallet className="h-4 w-4" />}
              footer={
                <p className="text-[11px] text-muted-foreground">
                  {kpis.gastosMes.count} movimiento{kpis.gastosMes.count === 1 ? "" : "s"}
                </p>
              }
            >
              <p className="text-2xl font-semibold tabular-nums tracking-tight text-violet-700 dark:text-violet-400">
                {formatMoney(kpis.gastosMes.sum)}
              </p>
            </KpiTile>
            <KpiTile
              title="Por pagar (aprobado)"
              subtitle="Total aprobado y pendiente de pago."
              accentClass="before:bg-amber-600"
              icon={<Wallet className="h-4 w-4" />}
              footer={
                <p className="text-[11px] text-muted-foreground">
                  {pipeline.approvedCount} solicitud{pipeline.approvedCount === 1 ? "" : "es"}
                </p>
              }
            >
              <p className="text-2xl font-semibold tabular-nums tracking-tight text-amber-700 dark:text-amber-400">
                {formatMoney(pipeline.approvedTotal)}
              </p>
            </KpiTile>
            <KpiTile
              title="En revisión"
              subtitle="Solicitudes en trámite."
              accentClass="before:bg-slate-500"
              icon={<Wallet className="h-4 w-4" />}
              footer={
                <p className="text-[11px] text-muted-foreground">
                  {pipeline.pendingCount} en proceso
                </p>
              }
            >
              <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                {formatMoney(pipeline.pendingTotal)}
              </p>
            </KpiTile>
            <KpiTile
              title="Tendencia"
              subtitle="Histórico de gastos pagados."
              accentClass="before:bg-muted-foreground/50"
              icon={<PieChartIcon className="h-4 w-4" />}
              footer={
                <p className="text-[11px] text-muted-foreground">
                  Los ingresos del despacho no se muestran en tu perfil.
                </p>
              }
            >
              <p className="text-sm text-muted-foreground">Últimos 12 meses en la gráfica inferior.</p>
            </KpiTile>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-border/50 bg-card/60 p-5 shadow-md backdrop-blur-sm dark:bg-card/40">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-base font-semibold tracking-tight">Evolución mensual</h3>
            <p className="text-xs text-muted-foreground">
              {savioEnabled
                ? "Comparativo de ingresos cobrados y gastos pagados, mes a mes."
                : "Gastos pagados mes a mes."}
            </p>
          </div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Últimos 12 meses</p>
        </div>
        {savioEnabled && isLoading ? (
          <Skeleton className="h-[300px] w-full rounded-xl" />
        ) : (
          <div className="h-[300px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 12, right: 12, left: 4, bottom: 8 }}
                barCategoryGap="18%"
                barGap={4}
              >
                <defs>
                  <linearGradient id={ingGrad} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14b8a6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#0d9488" stopOpacity={0.85} />
                  </linearGradient>
                  <linearGradient id={gastosGrad} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a78bfa" stopOpacity={1} />
                    <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.88} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="hsl(var(--border))"
                  strokeOpacity={0.85}
                />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`)}
                  width={48}
                />
                <Tooltip
                  content={<TrendTooltip />}
                  cursor={{ fill: "hsl(var(--muted) / 0.25)" }}
                  animationDuration={200}
                />
                <Legend
                  wrapperStyle={{ paddingTop: 16 }}
                  formatter={(value) => <span className="text-xs text-foreground">{value}</span>}
                />
                {savioEnabled && (
                  <Bar
                    dataKey="ingresos"
                    name="Ingresos cobrados"
                    fill={`url(#${ingGrad})`}
                    radius={[6, 6, 0, 0]}
                    maxBarSize={36}
                    animationDuration={900}
                    animationEasing="ease-out"
                    activeBar={{ fill: "#2dd4bf", opacity: 0.92, stroke: "#0f766e", strokeWidth: 1 }}
                  />
                )}
                <Bar
                  dataKey="gastos"
                  name="Gastos pagados"
                  fill={`url(#${gastosGrad})`}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={36}
                  animationDuration={900}
                  animationEasing="ease-out"
                  activeBar={{ fill: "#c4b5fd", opacity: 0.95, stroke: "#6d28d9", strokeWidth: 1 }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {!savioEnabled && chartData.every((d) => d.gastos === 0) && (
          <p className="py-8 text-center text-sm text-muted-foreground">No hay gastos pagados en este periodo.</p>
        )}
      </div>

      {savioEnabled && (
        <div className="rounded-2xl border border-border/50 bg-card/60 p-5 shadow-md backdrop-blur-sm dark:bg-card/40">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-muted/50 p-2 text-muted-foreground">
                <PieChartIcon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold tracking-tight">Distribución por situación</h3>
                <p className="text-xs text-muted-foreground">
                  Cómo se reparten los importes según el estado de cada cargo en el periodo consultado.
                </p>
              </div>
            </div>
          </div>
          {isLoading ? (
            <Skeleton className="h-[240px] w-full rounded-xl" />
          ) : pieData.length === 0 ? (
            <div className="flex h-[240px] items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20 px-6 text-center text-sm text-muted-foreground">
              {savioHint || reactQueryError
                ? "No se pudieron cargar los datos de facturación. Revisa la pestaña de ingresos o la conexión."
                : "No hay importes agrupados para mostrar. Puede que los estados vengan en otro formato."}
            </div>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={92}
                    paddingAngle={3}
                    animationDuration={800}
                    animationEasing="ease-out"
                  >
                    {pieData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.fill}
                        stroke="hsl(var(--card))"
                        strokeWidth={2}
                        className="outline-none transition-opacity hover:opacity-90 focus:opacity-90"
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => formatMoney(v)}
                    contentStyle={{
                      borderRadius: "0.75rem",
                      border: "1px solid hsl(var(--border) / 0.6)",
                      boxShadow: "0 10px 40px -10px rgb(0 0 0 / 0.2)",
                      background: "hsl(var(--popover) / 0.95)",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <ul className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
            <li className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
              <span className="text-muted-foreground">Cobrado</span>
              <span className="font-medium tabular-nums">{formatMoney(buckets.cobrado)}</span>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
              <span className="text-muted-foreground">Pendiente</span>
              <span className="font-medium tabular-nums">{formatMoney(buckets.pendiente)}</span>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2 sm:col-span-1">
              <span className="text-muted-foreground">Otros</span>
              <span className="font-medium tabular-nums">{formatMoney(buckets.por_cobrar)}</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
