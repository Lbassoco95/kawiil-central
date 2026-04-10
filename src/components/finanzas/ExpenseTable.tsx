import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { parseExpenseAttachments, type Expense } from "@/hooks/useExpenses";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Paperclip } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  terceros: "Terceros",
  viaticos: "Viáticos",
  operativo: "Operativo",
  contratacion_externa: "Contratación ext.",
};

const STATUS_STYLES: Record<string, string> = {
  solicitado: "bg-muted text-muted-foreground",
  en_revision: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  aprobado: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  rechazado: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  pagado: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

const STATUS_LABELS: Record<string, string> = {
  solicitado: "Solicitado",
  en_revision: "En revisión",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  pagado: "Pagado",
};

interface Props {
  expenses: Expense[];
  onSelect: (expense: Expense) => void;
  showRequester?: boolean;
}

export function ExpenseTable({ expenses, onSelect, showRequester = false }: Props) {
  const { data: users = [] } = useOrgUsers();

  const getUserName = (id: string) =>
    users.find((u) => u.user_id === id)?.full_name || "—";

  if (expenses.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No hay solicitudes de gasto
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Categoría</TableHead>
            {showRequester && <TableHead>Solicitante</TableHead>}
            <TableHead>Descripción</TableHead>
            <TableHead className="w-10 text-center" title="Adjuntos">
              <span className="sr-only">Adjuntos</span>
              <Paperclip className="h-3.5 w-3.5 mx-auto text-muted-foreground" />
            </TableHead>
            <TableHead className="text-right">Monto</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {expenses.map((exp) => (
            <TableRow
              key={exp.id}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => onSelect(exp)}
            >
              <TableCell className="whitespace-nowrap text-xs">
                {format(new Date(exp.expense_date), "dd MMM yy", { locale: es })}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {CATEGORY_LABELS[exp.category] || exp.category}
                </Badge>
              </TableCell>
              {showRequester && (
                <TableCell className="text-xs">{getUserName(exp.requested_by)}</TableCell>
              )}
              <TableCell className="max-w-[200px] truncate text-xs">
                {exp.description}
              </TableCell>
              <TableCell className="text-center text-muted-foreground">
                {parseExpenseAttachments(exp).length > 0 ? (
                  <Paperclip className="h-3.5 w-3.5 mx-auto" aria-label="Tiene comprobantes" />
                ) : (
                  <span className="text-xs">—</span>
                )}
              </TableCell>
              <TableCell className="text-right font-medium whitespace-nowrap">
                ${Number(exp.amount).toLocaleString("es-MX", { minimumFractionDigits: 2 })} {exp.currency}
              </TableCell>
              <TableCell>
                <Badge className={STATUS_STYLES[exp.status] + " text-[10px]"}>
                  {STATUS_LABELS[exp.status]}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
