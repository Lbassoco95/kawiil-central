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
import { Plus, Wallet, DollarSign, Clock, CheckCircle, XCircle, Landmark, LayoutDashboard } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useExpenses, Expense } from "@/hooks/useExpenses";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useSavioIncomeAccess } from "@/hooks/useSavioIncomeAccess";
import { ExpenseFormDialog } from "@/components/finanzas/ExpenseFormDialog";
import { ExpenseTable } from "@/components/finanzas/ExpenseTable";
import { ExpenseReviewDialog } from "@/components/finanzas/ExpenseReviewDialog";
import { SavioFinanceDashboard } from "@/components/finanzas/SavioFinanceDashboard";
import { FinanceExecutiveSummary } from "@/components/finanzas/FinanceExecutiveSummary";
import { PageHeader } from "@/components/shared/PageHeader";

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

type FinanceTab = "resumen" | "gastos" | "savio";

export default function Finanzas() {
  const { user } = useAuth();
  const { data: expenses = [], isLoading } = useExpenses();
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
    if (hasFinanceAccess && !savioIncomeLoading && !canViewSavioIncome && financeTab === "savio") {
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
    const sum = (arr: Expense[]) => arr.reduce((s, e) => s + Number(e.amount), 0);
    return {
      pending: sum(pending),
      pendingCount: pending.length,
      approved: sum(approved),
      approvedCount: approved.length,
      paid: sum(paid),
      paidCount: paid.length,
      rejected: rejected.length,
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

  const gastosSection = (
    <div className="space-y-4 mt-0">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card animate-fade-in stagger-1" style={{ animationFillMode: "both" }}>
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Clock className="h-3.5 w-3.5" /> Pendientes
          </div>
          <p className="text-lg font-semibold">${totals.pending.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</p>
          <p className="text-xs text-muted-foreground">{totals.pendingCount} solicitudes</p>
        </div>
        <div className="stat-card animate-fade-in stagger-2" style={{ animationFillMode: "both" }}>
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <CheckCircle className="h-3.5 w-3.5" /> Aprobados
          </div>
          <p className="text-lg font-semibold text-green-600">${totals.approved.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</p>
          <p className="text-xs text-muted-foreground">{totals.approvedCount} por pagar</p>
        </div>
        <div className="stat-card animate-fade-in stagger-3" style={{ animationFillMode: "both" }}>
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <DollarSign className="h-3.5 w-3.5" /> Pagados
          </div>
          <p className="text-lg font-semibold text-purple-600">${totals.paid.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</p>
          <p className="text-xs text-muted-foreground">{totals.paidCount} pagos</p>
        </div>
        <div className="stat-card animate-fade-in stagger-4" style={{ animationFillMode: "both" }}>
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <XCircle className="h-3.5 w-3.5" /> Rechazados
          </div>
          <p className="text-lg font-semibold text-destructive">{totals.rejected}</p>
          <p className="text-xs text-muted-foreground">solicitudes</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-48 h-8 text-xs"
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
          title="Finanzas"
          description={pageDescription}
          icon={<Wallet className="h-6 w-6" />}
          actions={
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-1" /> Nueva solicitud
            </Button>
          }
        />

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
              <TabsList className="h-9 flex-wrap">
                <TabsTrigger value="resumen" className="text-xs gap-1.5">
                  <LayoutDashboard className="h-3.5 w-3.5" /> Resumen
                </TabsTrigger>
                <TabsTrigger value="gastos" className="text-xs gap-1.5">
                  <Wallet className="h-3.5 w-3.5" /> Gastos internos
                </TabsTrigger>
                <TabsTrigger value="savio" className="text-xs gap-1.5">
                  <Landmark className="h-3.5 w-3.5" /> Ingresos facturados
                </TabsTrigger>
              </TabsList>

              <TabsContent value="resumen" className="mt-0">
                <FinanceExecutiveSummary expenses={expenses} savioEnabled />
              </TabsContent>

              <TabsContent value="gastos" className="mt-0">
                {gastosSection}
              </TabsContent>

              <TabsContent value="savio" className="mt-0">
                <SavioFinanceDashboard />
              </TabsContent>
            </Tabs>
          ) : (
            <Tabs value={financeTab} onValueChange={(v) => setFinanceTab(v as FinanceTab)} className="space-y-4">
              <TabsList className="h-9 flex-wrap">
                <TabsTrigger value="resumen" className="text-xs gap-1.5">
                  <LayoutDashboard className="h-3.5 w-3.5" /> Resumen
                </TabsTrigger>
                <TabsTrigger value="gastos" className="text-xs gap-1.5">
                  <Wallet className="h-3.5 w-3.5" /> Gastos internos
                </TabsTrigger>
              </TabsList>

              <TabsContent value="resumen" className="mt-0">
                <FinanceExecutiveSummary expenses={expenses} savioEnabled={false} />
              </TabsContent>

              <TabsContent value="gastos" className="mt-0">
                {gastosSection}
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
