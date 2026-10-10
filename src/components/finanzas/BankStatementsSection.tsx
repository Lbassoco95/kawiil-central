import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle, Trash2, Eye, Landmark,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  useBankStatements,
  useDeleteBankStatement,
  type BankStatement,
  type StatementStatus,
} from "@/hooks/useBankMovements";
import { BankStatementUploadDialog } from "./BankStatementUploadDialog";
import { MovementReviewDialog } from "./MovementReviewDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const STATUS_META: Record<StatementStatus, { label: string; icon: React.ReactNode; className: string }> = {
  procesando: { label: "Procesando", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, className: "text-sky-600" },
  listo: { label: "Listo para revisar", icon: <CheckCircle2 className="h-3.5 w-3.5" />, className: "text-emerald-600" },
  revisado: { label: "Revisado", icon: <CheckCircle2 className="h-3.5 w-3.5" />, className: "text-violet-600" },
  error: { label: "Error", icon: <AlertCircle className="h-3.5 w-3.5" />, className: "text-destructive" },
};

const SOURCE_LABELS: Record<string, string> = {
  pdf: "PDF", excel: "Excel", csv: "CSV", image: "Imagen", manual: "Manual",
};

export function BankStatementsSection() {
  const { data: statements = [], isLoading } = useBankStatements();
  const deleteStatement = useDeleteBankStatement();
  const [showUpload, setShowUpload] = useState(false);
  const [reviewing, setReviewing] = useState<BankStatement | null>(null);
  const [toDelete, setToDelete] = useState<BankStatement | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Landmark className="h-4 w-4 text-primary" /> Estados de cuenta y movimientos
          </h3>
          <p className="text-xs text-muted-foreground">
            Carga tus estados de cuenta y deja que la IA los desglose para revisarlos y conciliarlos.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowUpload(true)}>
          <Upload className="h-4 w-4 mr-1" /> Cargar estado de cuenta
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : statements.length === 0 ? (
        <div className="glass-card border-border/50 p-6 text-center">
          <FileSpreadsheet className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm font-medium">Aún no cargas movimientos</p>
          <p className="text-xs text-muted-foreground">
            Sube un PDF, Excel/CSV o una foto para empezar a llevar un control preciso del dinero.
          </p>
          <Button size="sm" className="mt-3" onClick={() => setShowUpload(true)}>
            <Upload className="h-4 w-4 mr-1" /> Cargar el primero
          </Button>
        </div>
      ) : (
        <div className="glass-card overflow-hidden border-border/50 p-0">
          <div className="divide-y divide-border/40">
            {statements.map((s) => {
              const meta = STATUS_META[s.status];
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-3 md:px-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{s.bank_name || s.file_name || "Estado de cuenta"}</p>
                      <Badge variant="outline" className="text-[10px]">{SOURCE_LABELS[s.source_type] ?? s.source_type}</Badge>
                    </div>
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className={`inline-flex items-center gap-1 ${meta.className}`}>
                        {meta.icon} {meta.label}
                      </span>
                      · {s.movements_count} movimientos
                      · {format(new Date(s.created_at), "dd MMM yyyy", { locale: es })}
                    </p>
                    {s.status === "error" && s.error_message && (
                      <p className="mt-1 text-[11px] text-destructive">{s.error_message}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 text-xs"
                      disabled={s.status === "procesando" || s.movements_count === 0}
                      onClick={() => setReviewing(s)}
                    >
                      <Eye className="h-3.5 w-3.5" /> Revisar
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setToDelete(s)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <BankStatementUploadDialog open={showUpload} onOpenChange={setShowUpload} />
      <MovementReviewDialog statement={reviewing} open={!!reviewing} onOpenChange={(o) => !o && setReviewing(null)} />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este estado de cuenta?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán también sus {toDelete?.movements_count ?? 0} movimientos. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete) deleteStatement.mutate(toDelete);
                setToDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
