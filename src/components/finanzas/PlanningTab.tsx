import { useEffect, useMemo, useState } from "react";
import { Target, TrendingUp, Users, Hourglass, Save } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePipelineLeads, usePipelineStages } from "@/hooks/usePipeline";
import {
  useFinanceAccounts, useFinanceGoals, useFinanceMovements, useSaveGoals, type FinanceGoal,
} from "@/hooks/useFinanceBank";
import {
  accountBalances, addMonthsKey, monthlyFlow, newClientsNeeded, project, runRate, stageProbabilities,
} from "@/lib/finance/planning";

const money = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const short = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const MONTH_NAMES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const label = (key: string) => `${MONTH_NAMES[Number(key.slice(5)) - 1]} ${key.slice(2, 4)}`;
const HORIZON = 6;

function NumField({ value, onChange, className }: { value: number; onChange: (n: number) => void; className?: string }) {
  return <Input type="number" min="0" value={value || ""} onChange={(e) => onChange(Number(e.target.value) || 0)} className={`h-8 text-right ${className ?? ""}`} />;
}

export function PlanningTab() {
  const { data: movements = [], isLoading } = useFinanceMovements();
  const { data: accounts = [] } = useFinanceAccounts();
  const { data: goals = [] } = useFinanceGoals();
  const { data: leads = [] } = usePipelineLeads(false);
  const { data: stages = [] } = usePipelineStages();
  const saveGoals = useSaveGoals();

  const nowKey = new Date().toISOString().slice(0, 7);
  const startKey = addMonthsKey(nowKey, 1);
  const monthKeys = useMemo(() => Array.from({ length: HORIZON }, (_, i) => addMonthsKey(startKey, i)), [startKey]);

  // Supuestos editables
  const [newPerMonth, setNewPerMonth] = useState(2);
  const [avgTicket, setAvgTicket] = useState(10000);
  const [pipelineMonthly, setPipelineMonthly] = useState("unico");
  const [monthsToClose, setMonthsToClose] = useState(3);
  const [rows, setRows] = useState<Record<string, FinanceGoal>>({});

  useEffect(() => {
    const next: Record<string, FinanceGoal> = {};
    for (const key of monthKeys) {
      const [y, m] = key.split("-").map(Number);
      next[key] = goals.find((g) => g.year === y && g.month === m) ?? { year: y, month: m, income_target: 0, expense_budget: 0, new_clients_target: 0, avg_new_client_monthly: 0 };
    }
    setRows(next);
    const g = goals.find((x) => x.avg_new_client_monthly > 0);
    if (g) setAvgTicket(Number(g.avg_new_client_monthly));
    const n = goals.find((x) => x.new_clients_target > 0);
    if (n) setNewPerMonth(n.new_clients_target);
  }, [goals, monthKeys]);

  const history = useMemo(() => monthlyFlow(movements).filter((f) => f.key < nowKey), [movements, nowKey]);
  const current = useMemo(() => monthlyFlow(movements).find((f) => f.key === nowKey), [movements, nowKey]);
  const rr = useMemo(() => runRate(history, 3), [history]);
  const available = useMemo(
    () => accountBalances(accounts, movements.map((m) => ({ account_id: m.account_id, debit: Number(m.debit), credit: Number(m.credit) }))).available,
    [accounts, movements],
  );

  const probs = useMemo(() => stageProbabilities(stages), [stages]);
  const { pipelineWeighted, openCount, expectedWins, closeRate } = useMemo(() => {
    const stageById = new Map(stages.map((s) => [s.id, s]));
    let weighted = 0; let open = 0; let wins = 0; let won = 0; let lost = 0;
    for (const l of leads) {
      const st = stageById.get(l.stage_id);
      if (!st) continue;
      if (st.is_terminal) { if (probs[st.id] === 1) won++; else lost++; continue; }
      if (!l.is_active) continue;
      open++; wins += probs[st.id] ?? 0; weighted += Number(l.estimated_value ?? 0) * (probs[st.id] ?? 0);
    }
    return { pipelineWeighted: weighted, openCount: open, expectedWins: wins, closeRate: won + lost >= 5 ? won / (won + lost) : 0.2 };
  }, [leads, stages, probs]);

  const targets = useMemo(() => Object.fromEntries(monthKeys.map((k) => [k, Number(rows[k]?.income_target ?? 0)])), [rows, monthKeys]);
  const proj = useMemo(() => project({
    history, startKey, months: HORIZON, baseIncome: rr.income, baseExpense: rr.expense, newClientsPerMonth: newPerMonth,
    avgNewClientMonthly: avgTicket, pipelineWeighted, pipelineIsMonthly: pipelineMonthly === "mensual", pipelineMonthsToClose: monthsToClose,
    openingCash: available, incomeTargets: targets,
  }), [history, startKey, rr, newPerMonth, avgTicket, pipelineWeighted, pipelineMonthly, monthsToClose, available, targets]);

  const last = proj[proj.length - 1];
  const lastTarget = targets[last.key] || 0;
  const need = newClientsNeeded({ targetIncome: lastTarget, projectedIncome: rr.income + (pipelineMonthly === "mensual" ? pipelineWeighted : 0), avgMonthly: avgTicket, closeRate, pipelineExpectedWins: expectedWins });
  const burn = rr.expense - rr.income;
  const runwayMonths = burn > 0 ? available / burn : null;

  const chart = [
    ...history.slice(-6).map((f) => ({ name: label(f.key), Ingresos: Math.round(f.income), Gastos: Math.round(f.expense), tipo: "real" })),
    ...(current ? [{ name: `${label(nowKey)}*`, Ingresos: Math.round(current.income), Gastos: Math.round(current.expense), tipo: "real" }] : []),
    ...proj.map((p) => ({ name: label(p.key), "Ingresos proy.": Math.round(p.income), "Gastos proy.": Math.round(p.expense), Meta: p.target || undefined, "Caja proy.": Math.round(p.cash) })),
  ];

  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (history.length === 0) {
    return <Card variant="glass"><CardContent className="p-8 text-center text-sm text-muted-foreground">
      Para proyectar necesito historial: carga movimientos en «Bancos y caja» (al menos un mes completo).
    </CardContent></Card>;
  }

  const kpi = (icon: React.ReactNode, title: string, value: string, hint: string) => (
    <Card variant="glass"><CardContent className="p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">{icon}{title}</div>
      <p className="text-lg font-semibold tabular-nums">{value}</p><p className="text-[11px] text-muted-foreground">{hint}</p>
    </CardContent></Card>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpi(<TrendingUp className="h-3.5 w-3.5" />, "Ritmo actual (3 meses)", money(rr.income), `ingresos/mes · gastos ${money(rr.expense)}`)}
        {kpi(<Hourglass className="h-3.5 w-3.5" />, "Autonomía de caja", runwayMonths == null ? "Sin quema" : `${runwayMonths.toFixed(1)} meses`, `disponible ${money(available)}`)}
        {kpi(<Users className="h-3.5 w-3.5" />, "Pipeline ponderado", money(pipelineWeighted), `${openCount} leads abiertos · ~${expectedWins.toFixed(1)} cierres esperados`)}
        {kpi(<Target className="h-3.5 w-3.5" />, `Meta ${label(last.key)}`, lastTarget ? money(lastTarget) : "Define metas ↓",
          lastTarget ? (need.gap > 0 ? `faltan ${money(need.gap)}/mes → ${need.clients} clientes nuevos (${need.leadsToGenerate} leads por generar)` : "ya cubierta con el ritmo actual") : "para calcular cuántos clientes faltan")}
      </div>

      <Card variant="glass"><CardContent className="p-4">
        <p className="text-sm font-medium mb-3">Real y proyección</p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={short} tick={{ fontSize: 11 }} width={48} />
              <Tooltip formatter={(v: number) => money(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Ingresos" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Gastos" fill="hsl(var(--muted-foreground))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Ingresos proy." fill="hsl(var(--primary))" fillOpacity={0.4} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Gastos proy." fill="hsl(var(--muted-foreground))" fillOpacity={0.4} radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="Meta" stroke="#16a34a" strokeDasharray="4 3" dot={false} />
              <Line type="monotone" dataKey="Caja proy." stroke="#f59e0b" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">* mes en curso (parcial). El flujo excluye traspasos internos y dinero de terceros.</p>
      </CardContent></Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card variant="glass"><CardContent className="p-4 space-y-3">
          <p className="text-sm font-medium">Supuestos de crecimiento</p>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Clientes nuevos por mes</Label><NumField value={newPerMonth} onChange={setNewPerMonth} /></div>
            <div><Label className="text-xs">Mensualidad promedio por cliente nuevo</Label><NumField value={avgTicket} onChange={setAvgTicket} /></div>
            <div>
              <Label className="text-xs">El valor estimado de un lead es…</Label>
              <Select value={pipelineMonthly} onValueChange={setPipelineMonthly}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="unico">Pago único</SelectItem><SelectItem value="mensual">Mensualidad recurrente</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Meses para cerrar el pipeline</Label><NumField value={monthsToClose} onChange={(n) => setMonthsToClose(Math.max(1, n))} /></div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Tasa de cierre histórica: {(closeRate * 100).toFixed(0)}% (con menos de 5 leads cerrados se usa 20%). Probabilidad por etapa: crece con el avance del embudo.
          </p>
        </CardContent></Card>

        <Card variant="glass"><CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Metas por mes</p>
            <Button size="sm" disabled={saveGoals.isPending} onClick={() => saveGoals.mutate(Object.values(rows).map((r) => ({ ...r, avg_new_client_monthly: avgTicket, new_clients_target: newPerMonth })))}>
              <Save className="h-3.5 w-3.5 mr-1.5" /> Guardar
            </Button>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Mes</TableHead><TableHead className="text-right">Meta de ingreso</TableHead><TableHead className="text-right">Presupuesto de gasto</TableHead><TableHead className="text-right">Proyectado</TableHead></TableRow></TableHeader>
            <TableBody>
              {monthKeys.map((k, i) => (
                <TableRow key={k}>
                  <TableCell className="text-xs">{label(k)}</TableCell>
                  <TableCell><NumField value={Number(rows[k]?.income_target ?? 0)} onChange={(n) => setRows((r) => ({ ...r, [k]: { ...r[k], income_target: n } }))} /></TableCell>
                  <TableCell><NumField value={Number(rows[k]?.expense_budget ?? 0)} onChange={(n) => setRows((r) => ({ ...r, [k]: { ...r[k], expense_budget: n } }))} /></TableCell>
                  <TableCell className={`text-right text-xs tabular-nums ${targets[k] && proj[i].income < targets[k] ? "text-amber-600" : "text-green-700"}`}>{money(proj[i].income)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </div>
    </div>
  );
}
