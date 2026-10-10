import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus, Building2, Pencil, Trash2, RefreshCw, CalendarPlus, Repeat, Power, PowerOff,
} from "lucide-react";
import {
  useRecurringExpenses,
  useDeleteRecurringExpense,
  useUpdateRecurringExpense,
  useGenerateExpenseFromRecurring,
  FREQUENCY_LABELS,
  monthlyEquivalent,
  type RecurringExpense,
} from "@/hooks/useRecurringExpenses";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/financePlanning";
import { RecurringExpenseFormDialog } from "./RecurringExpenseFormDialog";
import { GroupCompanyManagerDialog } from "./GroupCompanyManagerDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const CHARGE_TO_LABELS: Record<string, string> = {
  kawiil: "Kawiil",
  cliente: "Cliente",
  empresa_grupo: "Empresa grupo",
  reembolsar_trabajador: "Reembolso",
};

const fmtMoney = (n: number, currency = "MXN") =>
  `$${n.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${currency}`;

export function RecurringExpensesSection() {
  const { data: recurring = [], isLoading } = useRecurringExpenses(true);
  const deleteRecurring = useDeleteRecurringExpense();
  const updateRecurring = useUpdateRecurringExpense();
  const generate = useGenerateExpenseFromRecurring();

  const [showForm, setShowForm] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [toDelete, setToDelete] = useState<RecurringExpense | null>(null);

  const openNew = () => {
    setEditing(null);
    setShowForm(true);
  };
  const openEdit = (r: RecurringExpense) => {
    setEditing(r);
    setShowForm(true);
  };

  const handleGenerate = (r: RecurringExpense) => {
    const today = new Date();
    const day = Math.min(r.day_of_month ?? today.getDate(), 28);
    const ym = today.toISOString().slice(0, 7);
    generate.mutate({ recurring: r, expense_date: `${ym}-${String(day).padStart(2, "0")}` });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Repeat className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Gastos recurrentes</h3>
          <Badge variant="outline" className="text-[10px]">{recurring.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowGroups(true)}>
            <Building2 className="h-4 w-4 mr-1" /> Empresas del grupo
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> Nuevo recurrente
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      ) : recurring.length === 0 ? (
        <div className="glass-card border-border/50 p-6 text-center">
          <Repeat className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm font-medium">Aún no defines gastos recurrentes</p>
          <p className="text-xs text-muted-foreground">
            Registra renta, software, nómina o servicios para planear el compromiso mensual.
          </p>
          <Button size="sm" className="mt-3" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> Agregar el primero
          </Button>
        </div>
      ) : (
        <div className="glass-card overflow-hidden border-border/50 p-0">
          <div className="divide-y divide-border/40">
            {recurring.map((r) => (
              <div
                key={r.id}
                className={`flex flex-wrap items-center gap-3 px-3 py-2.5 md:px-4 ${r.active ? "" : "opacity-55"}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    {!r.active && <Badge variant="outline" className="text-[10px]">Inactivo</Badge>}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {EXPENSE_CATEGORY_LABELS[r.category] ?? r.category}
                    {r.vendor ? ` · ${r.vendor}` : ""}
                    {r.day_of_month ? ` · día ${r.day_of_month}` : ""}
                    {` · ${CHARGE_TO_LABELS[r.charge_to] ?? r.charge_to}`}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">{fmtMoney(Number(r.amount), r.currency)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {FREQUENCY_LABELS[r.frequency]} · ~{fmtMoney(monthlyEquivalent(r), r.currency)}/mes
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-[11px]"
                    title="Registrar el gasto de este mes"
                    onClick={() => handleGenerate(r)}
                    disabled={generate.isPending}
                  >
                    <CalendarPlus className="h-3.5 w-3.5" /> Registrar mes
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title={r.active ? "Desactivar" : "Activar"}
                    onClick={() => updateRecurring.mutate({ id: r.id, active: !r.active })}
                  >
                    {r.active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(r)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => setToDelete(r)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <RecurringExpenseFormDialog open={showForm} onOpenChange={setShowForm} editing={editing} />
      <GroupCompanyManagerDialog open={showGroups} onOpenChange={setShowGroups} />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este gasto recurrente?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la plantilla «{toDelete?.name}». Los gastos ya registrados no se ven afectados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete) deleteRecurring.mutate(toDelete.id);
                setToDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <RefreshCw className="hidden" /> Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
