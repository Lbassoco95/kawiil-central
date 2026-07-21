import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Check, X, Ban, ReceiptText, ArrowDownLeft, ArrowUpRight, Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  useBankMovements,
  useUpdateBankMovement,
  useCreateExpenseFromMovement,
  type BankStatement,
  type BankMovement,
  type MovementStatus,
} from "@/hooks/useBankMovements";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/financePlanning";

const CATEGORY_OPTIONS = ["operativo", "terceros", "viaticos", "contratacion_externa", "otro"];

const STATUS_META: Record<MovementStatus, { label: string; className: string }> = {
  pendiente: { label: "Pendiente", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  conciliado: { label: "Conciliado", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  ignorado: { label: "Ignorado", className: "bg-muted text-muted-foreground" },
  gasto_creado: { label: "Gasto creado", className: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300" },
};

const fmtMoney = (n: number, currency = "MXN") =>
  `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2 })} ${currency}`;

interface Props {
  statement: BankStatement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MovementReviewDialog({ statement, open, onOpenChange }: Props) {
  const { data: movements = [], isLoading } = useBankMovements(statement?.id);
  const updateMovement = useUpdateBankMovement();
  const createExpense = useCreateExpenseFromMovement();
  const [filter, setFilter] = useState<"todos" | "pendiente" | "cargo" | "abono">("todos");

  const filtered = useMemo(() => {
    let list = movements;
    if (filter === "pendiente") list = list.filter((m) => m.status === "pendiente");
    if (filter === "cargo") list = list.filter((m) => m.direction === "cargo");
    if (filter === "abono") list = list.filter((m) => m.direction === "abono");
    return list;
  }, [movements, filter]);

  const summary = useMemo(() => {
    const cargos = movements.filter((m) => m.direction === "cargo").reduce((s, m) => s + Number(m.amount), 0);
    const abonos = movements.filter((m) => m.direction === "abono").reduce((s, m) => s + Number(m.amount), 0);
    const pending = movements.filter((m) => m.status === "pendiente").length;
    return { cargos, abonos, pending, total: movements.length };
  }, [movements]);

  const setStatus = (m: BankMovement, status: MovementStatus) =>
    updateMovement.mutate({ id: m.id, status });
  const setCategory = (m: BankMovement, category: string) =>
    updateMovement.mutate({ id: m.id, category });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <ReceiptText className="h-4 w-4" />
            Revisión de movimientos
            {statement?.bank_name && <Badge variant="outline">{statement.bank_name}</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 pb-3">
          {statement?.ai_summary && (
            <p className="mb-3 flex items-start gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-[12px] text-primary">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {statement.ai_summary}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-muted-foreground">
              {summary.total} movimientos · <span className="text-amber-600">{summary.pending} pendientes</span>
            </span>
            <span className="text-rose-600">Cargos: {fmtMoney(summary.cargos)}</span>
            <span className="text-emerald-600">Abonos: {fmtMoney(summary.abonos)}</span>
            <div className="ml-auto">
              <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="pendiente">Pendientes</SelectItem>
                  <SelectItem value="cargo">Solo cargos</SelectItem>
                  <SelectItem value="abono">Solo abonos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-5 pb-5">
          {isLoading ? (
            [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No hay movimientos en este filtro.</p>
          ) : (
            filtered.map((m) => {
              const isCargo = m.direction === "cargo";
              const meta = STATUS_META[m.status];
              return (
                <div key={m.id} className="rounded-xl border border-border/50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <span
                        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                          isCargo
                            ? "bg-rose-100 text-rose-600 dark:bg-rose-900/30"
                            : "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30"
                        }`}
                      >
                        {isCargo ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{m.description || m.counterparty || "Movimiento"}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {m.movement_date ? format(new Date(m.movement_date), "dd MMM yyyy", { locale: es }) : "Sin fecha"}
                          {m.counterparty && m.description ? ` · ${m.counterparty}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-semibold tabular-nums ${isCargo ? "text-rose-600" : "text-emerald-600"}`}>
                        {isCargo ? "−" : "+"}{fmtMoney(m.amount, m.currency)}
                      </p>
                      <Badge className={`mt-0.5 border-0 text-[10px] ${meta.className}`}>{meta.label}</Badge>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Select value={m.category ?? m.suggested_category ?? ""} onValueChange={(v) => setCategory(m, v)}>
                      <SelectTrigger className="h-7 w-44 text-xs">
                        <SelectValue placeholder="Categoría…" />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORY_OPTIONS.map((c) => (
                          <SelectItem key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c] ?? c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {m.suggested_category && !m.category && (
                      <span className="flex items-center gap-1 text-[10px] text-primary">
                        <Sparkles className="h-3 w-3" /> Sugerido: {EXPENSE_CATEGORY_LABELS[m.suggested_category] ?? m.suggested_category}
                      </span>
                    )}

                    <div className="ml-auto flex items-center gap-1">
                      {m.status !== "gasto_creado" && isCargo && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-[11px]"
                          disabled={createExpense.isPending}
                          onClick={() => createExpense.mutate({ movement: m })}
                        >
                          <ReceiptText className="h-3.5 w-3.5" /> Crear gasto
                        </Button>
                      )}
                      {m.status !== "conciliado" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-emerald-600"
                          title="Marcar conciliado"
                          onClick={() => setStatus(m, "conciliado")}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      {m.status !== "ignorado" ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground"
                          title="Ignorar"
                          onClick={() => setStatus(m, "ignorado")}
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Reactivar"
                          onClick={() => setStatus(m, "pendiente")}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
