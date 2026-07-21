import { useState, useMemo, useEffect, useRef } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Wallet, DollarSign, Clock, CheckCircle, XCircle, Landmark, LayoutDashboard, BarChart3, HandCoins, RefreshCcw, CalendarClock, ReceiptText } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useExpenses, Expense } from "@/hooks/useExpenses";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useSavioIncomeAccess } from "@/hooks/useSavioIncomeAccess";
import { ExpenseFormDialog } from "@/components/finanzas/ExpenseFormDialog";
import { ExpenseTable } from "@/components/finanzas/ExpenseTable";
import { ExpenseReviewDialog } from "@/components/finanzas/ExpenseReviewDialog";
import { SavioFinanceDashboard } from "@/components/finanzas/SavioFinanceDashboard";
import { FinanceExecutiveSummary } from "@/components/finanzas/FinanceExecutiveSummary";
import { FinanceCashflowAlerts } from "@/components/finanzas/FinanceCashflowAlerts";
import { FinanceIntelligenceBoards } from "@/components/finanzas/FinanceIntelligenceBoards";
import { FinancePlanningDashboard } from "@/components/finanzas/FinancePlanningDashboard";
import { BankStatementsSection } from "@/components/finanzas/BankStatementsSection";
import { KpiTile } from "@/components/finanzas/KpiTile";
import { PageHeader, type PageHeaderStat } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";
import { FinanceKawiilCard } from "@/components/finanzas/FinanceKawiilCard";
import { useClients } from "@/hooks/useClients";
import { useFinanceDashboardData } from "@/hooks/useFinanceDashboardData";
import { yearMonthFromDate } from "@/lib/financeMonthMetrics";

const STATUS_FILTERS = [
  { value: "todos", label: "Todos" },
  { value: "solicitado", label: "Solicitados" },
  { value: "en_revision", label: "En revisión" },
  { value: "aprobado", label: "Aprobados" },
  { value: "rechazado", label: "Rechazados" },
  { value: "pagado", label: "Pagados" },
];

const CATEGORY_FILTERS = [
  { value: "todos", label: "Todas" },
  { value: "terceros", label: "Terceros" },
  { value: "viaticos", label: "Viáticos" },
  { value: "operativo", label: "Operativo" },
  { value: "contratacion_externa", label: "Contratación ext." },
];

type FinanceTab = "resumen" | "gastos" | "planeacion" | "movimientos" | "savio" | "tableros";

export default function Finanzas() {
  const { user } = useAuth();
  const { data: expenses = [], isLoading } = useExpenses();
  const { data: clients = [] } = useClients();
  const { hasFinanceAccess } = useFinanceAccess();
  const { data: canViewSavioIncome = false, isLoading: savioIncomeLoading } = useSavioIncomeAccess();
  const [showForm, setShowForm] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [statusFilter, setStatusFilter] = useState("todos");
  const [categoryFilter, setCategoryFilter] = useState("todos");
  const [search, setSearch] = useState("");
  const [financeTab, setFinanceTab] = useState<FinanceTab>("gastos");
  const savioDefaultTabApplied = useRef(false);

  useEffect(() => {
    savioDefaultTabApplied.current = false;
  }, [user?.id]);

  useEffect(() => {
    if (hasFinanceAccess && canViewSavioIncome && !savioDefaultTabApplied.current) {
      savioDefaultTabApplied.current = true;
      setFinanceTab("resumen");
    }
  }, [hasFinanceAccess, canViewSavioIncome]);

  useEffect(() => {
    if (
      hasFinanceAccess &&
      !savioIncomeLoading &&
      !canViewSavioIncome &&
      (financeTab === "savio" || financeTab === "tableros")
    ) {
      setFinanceTab("gastos");
    }
  }, [hasFinanceAccess, savioIncomeLoading, canViewSavioIncome, financeTab]);

  const myExpenses = useMemo(
    () => expenses.filter((e) => e.requested_by === user?.id),
    [expenses, user]
  );

  const filteredAll = useMemo(() => {
    let list = expenses;
    if (statusFilter !== "todos") list = list.filter((e) => e.status === statusFilter);
    if (categoryFilter !== "todos") list = list.filter((e) => e.category === categoryFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.description.toLowerCase().includes(s) ||
          e.notes?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [expenses, statusFilter, categoryFilter, search]);

  const totals = useMemo(() => {
    const pending = expenses.filter((e) => ["solicitado", "en_revision"].includes(e.status));
    const approved = expenses.filter((e) => e.status === "aprobado");
    const paid = expenses.filter((e) => e.status === "pagado");
    const rejected = expenses.filter((e) => e.status === "rechazado");
    // Reembolsos pendientes: gastos aprobados/pagados que aún no se cobran/reembolsan.
    // Excluye rechazados (su reembolso ya no aplica).
    const reimbursable = (type: string) =>
      expenses.filter(
        (e) =>
          e.reimbursement_type === type &&
          e.reimbursement_status === "pendiente" &&
          e.status !== "rechazado",
      );
    const toCollect = reimbursable("cobrar_cliente");
    const toReimburse = reimbursable("reembolsar_trabajador");
    const sum = (arr: Expense[]) => arr.reduce((s, e) => s + Number(e.amount), 0);
    return {
      pending: sum(pending),
      pendingCount: pending.length,
      approved: sum(approved),
      approvedCount: approved.length,
      paid: sum(paid),
      paidCount: paid.length,
      rejected: rejected.length,
      toCollect: sum(toCollect),
      toCollectCount: toCollect.length,
      toReimburse: sum(toReimburse),
      toReimburseCount: toReimburse.length,
    };
  }, [expenses]);

  const pageDescription = useMemo(() => {
    if (!hasFinanceAccess) {
      return "Registra solicitudes de pago y da seguimiento a tus solicitudes.";
    }
    if (canViewSavioIncome) {
      return "Control financiero del despacho: resumen mensual, gastos internos e ingresos facturados.";
    }
    return "Resumen mensual de gastos, aprobaciones y pagos del despacho.";
  }, [hasFinanceAccess, canViewSavioIncome]);

  const fmtMoney = (n: number) =>
    `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;

  // ─── Hero stats ──────────────────────────────────────────────
  const currentYm = useMemo(() => yearMonthFromDate(new Date()), []);
  const financeData = useFinanceDashboardData(currentYm, expenses, {
    enableSavio: hasFinanceAccess && canViewSavioIncome,
  });

  const fmtMoneyShort = (n: number) =>
    new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 0,
    }).format(n);

  const heroStats = useMemo<Array<PageHeaderStat | false>>(() => {
    if (!hasFinanceAccess) return [];

    if (canViewSavioIncome) {
      const k = financeData.kpis;
      // Los KPIs de Savio (cartera, cobrado, facturado) dependen de una query remota.
      // Mientras carga o si falla, mostrar el estado en vez de $0 silencioso (que se
      // confunde con "no hay datos"). "Gastos mes" sale de gastos locales y siempre aplica.
      const savioLoading = financeData.isLoading;
      const savioErrored = !savioLoading && !!(financeData.savioError || financeData.reactQueryError);
      const savioValue = (formatted: string) =>
        savioLoading ? "…" : savioErrored ? "—" : formatted;
      const savioSub = (normalSub: string) =>
        savioLoading ? "cargando ingresos…" : savioErrored ? "datos no disponibles" : normalSub;
      return [
        {
          label: "Gastos mes",
          value: fmtMoneyShort(k.gastosMes.sum),
          sub:
            k.gastosMes.count > 0
              ? `${k.gastosMes.count} pago${k.gastosMes.count === 1 ? "" : "s"} liquidado${k.gastosMes.count === 1 ? "" : "s"}`
              : "sin pagos liquidados",
          tone: "default" as const,
        },
        {
          label: "Pendiente cobro",
          value: savioValue(fmtMoneyShort(k.cartera.sum)),
          sub: savioSub(
            k.cartera.count > 0
              ? `${k.cartera.count} factura${k.cartera.count === 1 ? "" : "s"}`
              : "cartera al día",
          ),
          tone: k.cartera.sum > 0 ? ("warning" as const) : ("default" as const),
        },
        {
          label: "Ingresos mes",
          value: savioValue(fmtMoneyShort(k.cobradoMes.sum)),
          sub: savioSub(
            k.cobradoMes.count > 0
              ? `${k.cobradoMes.count} pago${k.cobradoMes.count === 1 ? "" : "s"} cobrado${k.cobradoMes.count === 1 ? "" : "s"}`
              : "sin cobros",
          ),
          tone: "success" as const,
        },
        {
          label: "Facturación mes",
          value: savioValue(fmtMoneyShort(k.facturadoMes.sum)),
          sub: savioSub(
            k.facturadoMes.count > 0
              ? `${k.facturadoMes.count} factura${k.facturadoMes.count === 1 ? "" : "s"} emitida${k.facturadoMes.count === 1 ? "" : "s"}`
              : "sin emisión",
          ),
          tone: "primary" as const,
        },
      ];
    }

    return [
      {
        label: "Gastos pagados",
        value: fmtMoneyShort(totals.paid),
        sub: `${totals.paidCount} pago${totals.paidCount === 1 ? "" : "s"} este periodo`,
        tone: "default" as const,
      },
      {
        label: "Aprobados",
        value: fmtMoneyShort(totals.approved),
        sub: `${totals.approvedCount} listos para pago`,
        tone: "success" as const,
      },
      {
        label: "Pendientes",
        value: fmtMoneyShort(totals.pending),
        sub: `${totals.pendingCount} en revisión`,
        tone: totals.pendingCount > 0 ? ("warning" as const) : ("default" as const),
      },
    ];
  }, [
    hasFinanceAccess,
    canViewSavioIncome,
    financeData.kpis,
    financeData.isLoading,
    financeData.savioError,
    financeData.reactQueryError,
    totals,
  ]);

  const gastosSection = (
    <div className="space-y-4 mt-0">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          title="Pendientes"
          subtitle="Solicitudes en revisión / por aprobar."
          accentClass="before:bg-amber-500"
          icon={<Clock className="h-4 w-4" />}
          footer={<p className="text-[11px] text-muted-foreground">{totals.pendingCount} solicitudes</p>}
        >
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-amber-700 dark:text-amber-400">
            {fmtMoney(totals.pending)}
          </p>
        </KpiTile>
        <KpiTile
          title="Aprobados"
          subtitle="Listos para pago."
          accentClass="before:bg-emerald-600"
          icon={<CheckCircle className="h-4 w-4" />}
          footer={<p className="text-[11px] text-muted-foreground">{totals.approvedCount} por pagar</p>}
        >
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400">
            {fmtMoney(totals.approved)}
          </p>
        </KpiTile>
        <KpiTile
          title="Pagados"
          subtitle="Egresos realizados en el periodo."
          accentClass="before:bg-violet-600"
          icon={<DollarSign className="h-4 w-4" />}
          footer={<p className="text-[11px] text-muted-foreground">{totals.paidCount} pagos</p>}
        >
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-violet-700 dark:text-violet-400">
            {fmtMoney(totals.paid)}
          </p>
        </KpiTile>
        <KpiTile
          title="Rechazados"
          subtitle="Solicitudes descartadas."
          accentClass="before:bg-destructive"
          icon={<XCircle className="h-4 w-4" />}
          footer={<p className="text-[11px] text-muted-foreground">solicitudes</p>}
        >
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-destructive">
            {totals.rejected}
          </p>
        </KpiTile>
      </div>

      {(totals.toCollect > 0 || totals.toReimburse > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <KpiTile
            title="Por cobrar a clientes"
            subtitle="Gastos que el despacho absorbió y hay que cobrar al cliente."
            accentClass="before:bg-amber-500"
            icon={<HandCoins className="h-4 w-4" />}
            footer={<p className="text-[11px] text-muted-foreground">{totals.toCollectCount} pendiente{totals.toCollectCount === 1 ? "" : "s"}</p>}
          >
            <p className="text-2xl font-semibold tabular-nums tracking-tight text-amber-700 dark:text-amber-400">
              {fmtMoney(totals.toCollect)}
            </p>
          </KpiTile>
          <KpiTile
            title="Por reembolsar"
            subtitle="Gastos que el trabajador pagó y el despacho debe reembolsar."
            accentClass="before:bg-sky-500"
            icon={<RefreshCcw className="h-4 w-4" />}
            footer={<p className="text-[11px] text-muted-foreground">{totals.toReimburseCount} pendiente{totals.toReimburseCount === 1 ? "" : "s"}</p>}
          >
            <p className="text-2xl font-semibold tabular-nums tracking-tight text-sky-700 dark:text-sky-400">
              {fmtMoney(totals.toReimburse)}
            </p>
          </KpiTile>
        </div>
      )}

      <div className="surface-toolbar flex flex-wrap items-center gap-2 p-3 md:p-4">
        <Input
          placeholder="Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-48 border-border/50 bg-background/60 text-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="glass-card overflow-hidden p-0 border-border/50">
        <ExpenseTable
          expenses={filteredAll}
          onSelect={setSelectedExpense}
          showRequester
        />
      </div>
    </div>
  );

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          variant="hero"
          breadcrumb={["Kawiil OS", "Operación", "Finanzas"]}
          title="Finanzas"
          description={pageDescription}
          icon={<Wallet />}
          iconAccent={KAWIIL_AI_GRADIENT}
          stats={heroStats}
          actions={
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="hidden sm:inline-flex border-sky-300/70 bg-sky-50/70 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300"
              >
                v2.4
              </Badge>
              <Button size="sm" onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4 mr-1" /> Nueva solicitud
              </Button>
            </div>
          }
        />

        {!isLoading && hasFinanceAccess && (
          <FinanceKawiilCard
            pendingCount={totals.pendingCount}
            pendingAmount={totals.pending}
            approvedCount={totals.approvedCount}
            approvedAmount={totals.approved}
            paidCount={totals.paidCount}
            paidAmount={totals.paid}
            cobradoMes={canViewSavioIncome ? financeData.kpis.cobradoMes.sum : null}
            facturadoMes={canViewSavioIncome ? financeData.kpis.facturadoMes.sum : null}
            carteraSum={canViewSavioIncome ? financeData.kpis.cartera.sum : null}
            carteraCount={canViewSavioIncome ? financeData.kpis.cartera.count : null}
            onGoToTab={(t) => setFinanceTab(t)}
          />
        )}

        {isLoading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-24 rounded-2xl" />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-8 w-48 rounded-md" />
              <Skeleton className="h-8 w-36 rounded-md" />
              <Skeleton className="h-8 w-40 rounded-md" />
            </div>
            <Skeleton className="h-[280px] w-full rounded-2xl" />
          </div>
        ) : hasFinanceAccess ? (
          savioIncomeLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-9 w-full max-w-md rounded-md" />
              <Skeleton className="h-64 w-full rounded-2xl" />
            </div>
          ) : canViewSavioIncome ? (
            <Tabs value={financeTab} onValueChange={(v) => setFinanceTab(v as FinanceTab)} className="space-y-4">
              <div className="surface-toolbar inline-flex w-full max-w-full p-2 md:w-fit">
              <TabsList className="h-9 flex-wrap bg-transparent">
                <TabsTrigger value="resumen" className="text-xs gap-1.5">
                  <LayoutDashboard className="h-3.5 w-3.5" /> Resumen
                </TabsTrigger>
                <TabsTrigger value="gastos" className="text-xs gap-1.5">
                  <Wallet className="h-3.5 w-3.5" /> Gastos internos
                </TabsTrigger>
                <TabsTrigger value="planeacion" className="text-xs gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" /> Planeación
                </TabsTrigger>
                <TabsTrigger value="movimientos" className="text-xs gap-1.5">
                  <ReceiptText className="h-3.5 w-3.5" /> Movimientos
                </TabsTrigger>
                <TabsTrigger value="savio" className="text-xs gap-1.5">
                  <Landmark className="h-3.5 w-3.5" /> Ingresos facturados
                </TabsTrigger>
                <TabsTrigger value="tableros" className="text-xs gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5" /> Tableros
                </TabsTrigger>
              </TabsList>
              </div>

              <TabsContent value="resumen" className="mt-0 space-y-4">
                <FinanceCashflowAlerts
                  expenses={expenses}
                  kpis={financeData.kpis}
                  trendBars={financeData.trendBars}
                  savioEnabled
                  onGoToSavio={() => setFinanceTab("savio")}
                  onGoToGastos={() => setFinanceTab("gastos")}
                />
                <FinanceExecutiveSummary
                  expenses={expenses}
                  savioEnabled
                  onGoToSavioTab={() => setFinanceTab("savio")}
                />
              </TabsContent>

              <TabsContent value="gastos" className="mt-0">
                {gastosSection}
              </TabsContent>

              <TabsContent value="planeacion" className="mt-0">
                <FinancePlanningDashboard expenses={expenses} />
              </TabsContent>

              <TabsContent value="movimientos" className="mt-0">
                <BankStatementsSection />
              </TabsContent>

              <TabsContent value="savio" className="mt-0">
                <SavioFinanceDashboard />
              </TabsContent>

              <TabsContent value="tableros" className="mt-0">
                <FinanceIntelligenceBoards expenses={expenses} clients={clients} savioEnabled />
              </TabsContent>
            </Tabs>
          ) : (
            <Tabs value={financeTab} onValueChange={(v) => setFinanceTab(v as FinanceTab)} className="space-y-4">
              <div className="surface-toolbar inline-flex w-full max-w-full p-2 md:w-fit">
              <TabsList className="h-9 flex-wrap bg-transparent">
                <TabsTrigger value="resumen" className="text-xs gap-1.5">
                  <LayoutDashboard className="h-3.5 w-3.5" /> Resumen
                </TabsTrigger>
                <TabsTrigger value="gastos" className="text-xs gap-1.5">
                  <Wallet className="h-3.5 w-3.5" /> Gastos internos
                </TabsTrigger>
                <TabsTrigger value="planeacion" className="text-xs gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" /> Planeación
                </TabsTrigger>
                <TabsTrigger value="movimientos" className="text-xs gap-1.5">
                  <ReceiptText className="h-3.5 w-3.5" /> Movimientos
                </TabsTrigger>
              </TabsList>
              </div>

              <TabsContent value="resumen" className="mt-0 space-y-4">
                <FinanceCashflowAlerts
                  expenses={expenses}
                  savioEnabled={false}
                  onGoToGastos={() => setFinanceTab("gastos")}
                />
                <FinanceExecutiveSummary expenses={expenses} savioEnabled={false} />
              </TabsContent>

              <TabsContent value="gastos" className="mt-0">
                {gastosSection}
              </TabsContent>

              <TabsContent value="planeacion" className="mt-0">
                <FinancePlanningDashboard expenses={expenses} />
              </TabsContent>

              <TabsContent value="movimientos" className="mt-0">
                <BankStatementsSection />
              </TabsContent>
            </Tabs>
          )
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Aquí puedes registrar solicitudes de pago y dar seguimiento a tus solicitudes.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <Card variant="glass">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <Clock className="h-3.5 w-3.5" /> Pendientes
                  </div>
                  <p className="text-lg font-bold">
                    {myExpenses.filter((e) => ["solicitado", "en_revision"].includes(e.status)).length}
                  </p>
                </CardContent>
              </Card>
              <Card variant="glass">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <CheckCircle className="h-3.5 w-3.5" /> Aprobados
                  </div>
                  <p className="text-lg font-bold text-green-600">
                    {myExpenses.filter((e) => e.status === "aprobado").length}
                  </p>
                </CardContent>
              </Card>
              <Card variant="glass">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <DollarSign className="h-3.5 w-3.5" /> Pagados
                  </div>
                  <p className="text-lg font-bold text-purple-600">
                    {myExpenses.filter((e) => e.status === "pagado").length}
                  </p>
                </CardContent>
              </Card>
            </div>
            <h2 className="text-sm font-medium text-muted-foreground">Mis solicitudes</h2>
            <div className="glass-card overflow-hidden p-0 border-border/50">
              <ExpenseTable
                expenses={myExpenses}
                onSelect={setSelectedExpense}
              />
            </div>
          </div>
        )}
      </div>

      <ExpenseFormDialog open={showForm} onOpenChange={setShowForm} />
      <ExpenseReviewDialog
        expense={selectedExpense}
        open={!!selectedExpense}
        onOpenChange={(o) => !o && setSelectedExpense(null)}
        canManage={hasFinanceAccess}
      />
    </AppLayout>
  );
}
