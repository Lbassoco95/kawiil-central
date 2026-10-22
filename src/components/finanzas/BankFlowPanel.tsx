import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Landmark, PiggyBank, Plus, Scale, Trash2, Upload, Wallet, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import type { Expense } from "@/hooks/useExpenses";
import {
  useBankAccounts, useBankStatements, useBankTransactions, useDeleteStatement, useSavingsGoals,
  type SavingsGoal,
} from "@/hooks/useBankFinance";
import {
  cashPosition, goalMonthlyNeed, latestBalances, monthlyFlow, runwayMonths,
} from "@/lib/bankCashPosition";
import { KpiTile } from "./KpiTile";
import { BankStatementUploadDialog } from "./BankStatementUploadDialog";
import { SavingsGoalDialog } from "./SavingsGoalDialog";

const mxn = (n: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);

const MONTH_NAMES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const monthLabel = (key: string) => MONTH_NAMES[Number(key.slice(5, 7)) - 1];
const dayLabel = (d: string | null) => {
  if (!d) return "sin fecha";
  const [y, m, day] = d.split("-");
  return `${Number(day)} ${MONTH_NAMES[Number(m) - 1]} ${y}`;
};

export function BankFlowPanel({ expenses }: { expenses: Expense[] }) {
  const accountsQ = useBankAccounts();
  const statementsQ = useBankStatements();
  const txQ = useBankTransactions();
  const goalsQ = useSavingsGoals();
  const deleteStatement = useDeleteStatement();
  const [uploadFor, setUploadFor] = useState<string | null | undefined>(undefined);
  const [goalDialog, setGoalDialog] = useState<{ goal: SavingsGoal | null } | null>(null);

  const accounts = useMemo(() => accountsQ.data ?? [], [accountsQ.data]);
  const statements = useMemo(() => statementsQ.data ?? [], [statementsQ.data]);
  const txs = useMemo(() => txQ.data ?? [], [txQ.data]);
  const goals = useMemo(() => goalsQ.data ?? [], [goalsQ.data]);

  const balances = useMemo(() => latestBalances(statements, txs), [statements, txs]);
  const pos = useMemo(() => cashPosition({ balances, expenses, goals }), [balances, expenses, goals]);
  const flow = useMemo(() => monthlyFlow(txs, 6), [txs]);
  const runway = useMemo(() => runwayMonths(pos.banks, flow), [pos.banks, flow]);

  if (accountsQ.isLoading || statementsQ.isLoading || goalsQ.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (accountsQ.error || statementsQ.error) {
    return (
      <p className="text-sm text-muted-foreground">
        Algo no salió como esperábamos al leer los bancos. Si es la primera vez, falta aplicar la migración de estados de cuenta.
      </p>
    );
  }

  const hasData = accounts.length > 0 && balances.length > 0;
  const hasFlow = flow.some((m) => m.inflow > 0 || m.outflow > 0);
  const asOfDates = balances.map((b) => b.asOf).filter(Boolean) as string[];
  const oldest = asOfDates.sort()[0] ?? null;

  const confirmDelete = (id: string) => {
    const s = statements.find((x) => x.id === id);
    if (!s) return;
    if (!window.confirm("¿Quitar este estado de cuenta y sus movimientos?")) return;
    deleteStatement.mutate(s, {
      onSuccess: () => toast.success("Estado de cuenta eliminado"),
      onError: () => toast.error("No pudimos eliminarlo, inténtalo de nuevo en un momento."),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {hasData
            ? `Saldos al corte más reciente${oldest ? ` (${dayLabel(oldest)})` : ""}.`
            : "Carga tu primer estado de cuenta para ver cuánto hay disponible."}
        </p>
        <Button size="sm" onClick={() => setUploadFor(null)}>
          <Upload className="h-4 w-4 mr-1" /> Cargar estado de cuenta
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          title="En bancos"
          subtitle="Saldo final del último estado de cada cuenta."
          accentClass="before:bg-sky-500"
          icon={<Landmark className="h-4 w-4" />}
          footer={<p className="text-[11px] text-muted-foreground">{balances.length} cuenta{balances.length === 1 ? "" : "s"} con saldo</p>}
        >
          <p className="text-2xl font-semibold tabular-nums tracking-tight">{hasData ? mxn(pos.banks) : "—"}</p>
        </KpiTile>
        <KpiTile
          title="Comprometido"
          subtitle="Gastos aprobados y reembolsos por pagar."
          accentClass="before:bg-amber-500"
          icon={<Wallet className="h-4 w-4" />}
          footer={
            <p className="text-[11px] text-muted-foreground">
              {pos.committedCount} por pagar
              {pos.tentativeCount > 0 ? ` · ${mxn(pos.tentative)} más por aprobar` : ""}
            </p>
          }
        >
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-amber-700 dark:text-amber-400">
            {mxn(pos.committed)}
          </p>
        </KpiTile>
        <KpiTile
          title="Ahorro apartado"
          subtitle="Lo que ya está reservado en tus metas."
          accentClass="before:bg-emerald-600"
          icon={<PiggyBank className="h-4 w-4" />}
          footer={
            <p className="text-[11px] text-muted-foreground">
              {pos.monthlySavingsNeed > 0
                ? `Conviene apartar ${mxn(pos.monthlySavingsNeed)} al mes`
                : goals.length > 0 ? "Metas al día" : "Sin metas todavía"}
            </p>
          }
        >
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400">
            {mxn(pos.saved)}
          </p>
        </KpiTile>
        <KpiTile
          title="Disponible libre"
          subtitle="Bancos − comprometido − ahorro apartado."
          accentClass={pos.free >= 0 ? "before:bg-violet-600" : "before:bg-rose-400"}
          icon={<Scale className="h-4 w-4" />}
          footer={
            <p className="text-[11px] text-muted-foreground">
              {runway != null ? `Alcanza para ~${runway.toFixed(1)} meses al ritmo actual` : hasFlow ? "Entra más de lo que sale" : "Aún sin historial de flujo"}
            </p>
          }
        >
          <p className={`text-2xl font-semibold tabular-nums tracking-tight ${pos.free >= 0 ? "text-violet-700 dark:text-violet-400" : "text-rose-600 dark:text-rose-300"}`}>
            {hasData ? mxn(pos.free) : "—"}
          </p>
        </KpiTile>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="glass-card p-4 border-border/50 space-y-3">
          <h3 className="text-sm font-medium">Flujo de los últimos 6 meses</h3>
          {hasFlow ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={flow.map((m) => ({ ...m, label: monthLabel(m.month) }))}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v: number) => mxn(v)} />
                  <Legend />
                  <Bar dataKey="inflow" name="Entró" fill="#7fb59a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="outflow" name="Salió" fill="#e3a98a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Aparecerá aquí cuando cargues movimientos.</p>
          )}
          {hasFlow && (
            <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
              {flow.slice(-3).map((m) => (
                <div key={m.month}>
                  <span className="uppercase">{monthLabel(m.month)}</span>
                  <p className={`text-sm font-medium tabular-nums ${m.net >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                    {m.net >= 0 ? "+" : "−"}{mxn(Math.abs(m.net))}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="glass-card p-4 border-border/50 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Metas de ahorro</h3>
            <Button size="sm" variant="outline" onClick={() => setGoalDialog({ goal: null })}>
              <Plus className="h-4 w-4 mr-1" /> Meta
            </Button>
          </div>
          {goals.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Crea una meta (colchón, impuestos, aguinaldos…) y te decimos cuánto apartar cada mes.
            </p>
          ) : (
            <ul className="space-y-3">
              {goals.map((g) => {
                const pct = Math.min(100, (g.saved_amount / g.target_amount) * 100);
                const need = goalMonthlyNeed(g);
                return (
                  <li key={g.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium truncate">{g.name}</span>
                      <button
                        type="button"
                        aria-label={`Editar ${g.name}`}
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => setGoalDialog({ goal: g })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                    <p className="text-[11px] text-muted-foreground">
                      {mxn(g.saved_amount)} de {mxn(g.target_amount)}
                      {g.target_date ? ` · para ${dayLabel(g.target_date)}` : ""}
                      {need > 0 ? ` · apartar ${mxn(need)}/mes` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="glass-card p-4 border-border/50 space-y-3">
        <h3 className="text-sm font-medium">Cuentas y estados cargados</h3>
        {accounts.length === 0 ? (
          <p className="text-xs text-muted-foreground">Todavía no hay cuentas. Se crean al cargar el primer estado.</p>
        ) : (
          <div className="space-y-4">
            {accounts.map((a) => {
              const bal = balances.find((b) => b.accountId === a.id);
              const stmts = statements.filter((s) => s.account_id === a.id);
              return (
                <div key={a.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {a.name}{a.last4 ? ` ····${a.last4}` : ""}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">{a.bank}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {bal ? `${mxn(bal.balance)} al ${dayLabel(bal.asOf)}` : "Sin saldo cargado"}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setUploadFor(a.id)}>
                      <Upload className="h-3.5 w-3.5 mr-1" /> Cargar
                    </Button>
                  </div>
                  {stmts.length > 0 && (
                    <ul className="divide-y divide-border/40 rounded-xl border border-border/40">
                      {stmts.slice(0, 6).map((s) => (
                        <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                          <span className="truncate">
                            {dayLabel(s.period_start)} – {dayLabel(s.period_end)} · {s.tx_count} mov.
                          </span>
                          <span className="flex items-center gap-3 shrink-0">
                            <span className="tabular-nums text-muted-foreground">
                              {s.closing_balance != null ? mxn(s.closing_balance) : "—"}
                            </span>
                            <button
                              type="button"
                              aria-label="Eliminar estado"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => confirmDelete(s.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <BankStatementUploadDialog
        open={uploadFor !== undefined}
        onOpenChange={(o) => !o && setUploadFor(undefined)}
        accounts={accounts}
        defaultAccountId={uploadFor ?? null}
      />
      <SavingsGoalDialog
        open={!!goalDialog}
        onOpenChange={(o) => !o && setGoalDialog(null)}
        goal={goalDialog?.goal ?? null}
      />
    </div>
  );
}
