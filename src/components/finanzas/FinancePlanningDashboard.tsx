import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CalendarClock, TrendingUp, Repeat, Building2, AlertTriangle, Wallet,
} from "lucide-react";
import type { Expense } from "@/hooks/useExpenses";
import { useRecurringExpenses } from "@/hooks/useRecurringExpenses";
import { useGroupCompanies } from "@/hooks/useGroupCompanies";
import {
  computePlanningTotals,
  upcomingRecurring,
  groupCompanyReceivables,
} from "@/lib/financePlanning";
import { KpiTile } from "./KpiTile";
import { RecurringExpensesSection } from "./RecurringExpensesSection";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);

function currentYm() {
  return new Date().toISOString().slice(0, 7);
}

interface Props {
  expenses: Expense[];
}

export function FinancePlanningDashboard({ expenses }: Props) {
  const [ym, setYm] = useState(currentYm());
  const { data: recurring = [] } = useRecurringExpenses(true);
  const { data: groupCompanies = [] } = useGroupCompanies(true);

  const totals = useMemo(() => computePlanningTotals(recurring, expenses, ym), [recurring, expenses, ym]);
  const upcoming = useMemo(() => upcomingRecurring(recurring, ym), [recurring, ym]);
  const receivables = useMemo(() => groupCompanyReceivables(expenses), [expenses]);

  const companyName = (id: string) =>
    id === "sin_empresa" ? "Sin empresa asignada" : groupCompanies.find((g) => g.id === id)?.name ?? "Empresa";

  const executionPct =
    totals.expectedMonth > 0 ? Math.min(100, Math.round((totals.actualMonth / totals.expectedMonth) * 100)) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Planeación financiera: compromiso esperado vs. lo registrado, con base en tus gastos recurrentes.
        </p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Mes</label>
          <Input type="month" value={ym} onChange={(e) => setYm(e.target.value)} className="h-8 w-40 text-xs" />
        </div>
      </div>

      {/* KPIs de planeación */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          title="Esperado del mes"
          subtitle="Compromiso recurrente que cae en el mes."
          accentClass="before:bg-sky-500"
          icon={<CalendarClock className="h-4 w-4" />}
          footer={<p className="text-[11px] text-muted-foreground">{totals.activeCount} recurrentes activos</p>}
        >
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-sky-700 dark:text-sky-400">
            {fmtMoney(totals.expectedMonth)}
          </p>
        </KpiTile>
        <KpiTile
          title="Registrado del mes"
          subtitle="Gastos aprobados y pagados del mes."
          accentClass="before:bg-violet-600"
          icon={<Wallet className="h-4 w-4" />}
          footer={<p className="text-[11px] text-muted-foreground">{fmtMoney(totals.paidMonth)} pagado</p>}
        >
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-violet-700 dark:text-violet-400">
            {fmtMoney(totals.actualMonth)}
          </p>
        </KpiTile>
        <KpiTile
          title="Promedio mensual"
          subtitle="Recurrentes normalizados a mes."
          accentClass="before:bg-emerald-600"
          icon={<Repeat className="h-4 w-4" />}
          footer={<p className="text-[11px] text-muted-foreground">compromiso base</p>}
        >
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400">
            {fmtMoney(totals.monthlyAverage)}
          </p>
        </KpiTile>
        <KpiTile
          title="Proyección anual"
          subtitle="Compromiso recurrente al año."
          accentClass="before:bg-amber-500"
          icon={<TrendingUp className="h-4 w-4" />}
          footer={<p className="text-[11px] text-muted-foreground">12 meses</p>}
        >
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-amber-700 dark:text-amber-400">
            {fmtMoney(totals.annual)}
          </p>
        </KpiTile>
      </div>

      {/* Ejecución del mes */}
      <Card variant="glass">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Ejecución del compromiso del mes</span>
            <span className="tabular-nums text-muted-foreground">
              {fmtMoney(totals.actualMonth)} / {fmtMoney(totals.expectedMonth)}
            </span>
          </div>
          <Progress value={executionPct} className="h-2" />
          <p className="text-[11px] text-muted-foreground">
            {executionPct}% del compromiso recurrente esperado ya está registrado este mes.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Planeado vs real por categoría */}
        <Card variant="glass">
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Planeado vs. registrado por categoría</h3>
            {totals.byCategory.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Sin datos para este mes.</p>
            ) : (
              <div className="space-y-3">
                {totals.byCategory.map((c) => {
                  const max = Math.max(c.expected, c.actual, 1);
                  return (
                    <div key={c.category} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{c.label}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {fmtMoney(c.actual)} / {fmtMoney(c.expected)}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div className="h-2 rounded-full bg-muted">
                          <div className="h-2 rounded-full bg-sky-400/70" style={{ width: `${(c.expected / max) * 100}%` }} />
                        </div>
                        <div className="h-2 rounded-full bg-muted">
                          <div className="h-2 rounded-full bg-violet-500" style={{ width: `${(c.actual / max) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-4 pt-1 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-400/70" /> Esperado</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-500" /> Registrado</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Próximos pagos recurrentes */}
        <Card variant="glass">
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Próximos pagos recurrentes del mes</h3>
            {upcoming.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No hay pagos recurrentes este mes.</p>
            ) : (
              <ul className="space-y-2">
                {upcoming.slice(0, 8).map(({ recurring: r, expected, day }) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-sky-100 text-[10px] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                        {day ?? "—"}
                      </span>
                      <span className="truncate">{r.name}</span>
                    </div>
                    <span className="tabular-nums font-medium">{fmtMoney(expected)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cuentas por cobrar a empresas del grupo */}
      {receivables.count > 0 && (
        <Card variant="glass">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Building2 className="h-4 w-4 text-amber-600" /> Por cobrar a empresas del grupo
              </h3>
              <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                {fmtMoney(receivables.total)}
              </Badge>
            </div>
            <ul className="space-y-2">
              {receivables.byCompany.map((rc) => (
                <li key={rc.group_company_id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    {rc.group_company_id === "sin_empresa" && (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    )}
                    {companyName(rc.group_company_id)}
                    <Badge variant="outline" className="text-[10px]">{rc.count}</Badge>
                  </span>
                  <span className="tabular-nums font-medium">{fmtMoney(rc.amount)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Gestión de gastos recurrentes */}
      <div className="glass-card border-border/50 p-4">
        <RecurringExpensesSection />
      </div>
    </div>
  );
}
