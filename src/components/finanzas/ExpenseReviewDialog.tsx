import { useState } from "react";
import {
  Dialog, DialogContent,
} from "@/components/ui/dialog";
import { KAWIIL_AI_HEADER_BG } from "@/lib/kawiilAi";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  useUpdateExpenseStatus,
  Expense,
  parseExpenseAttachments,
} from "@/hooks/useExpenses";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Check, X, CreditCard, Eye, Paperclip, Download, Receipt } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  terceros: "Terceros / cliente",
  viaticos: "Viáticos",
  operativo: "Operativo interno",
  contratacion_externa: "Contratación externa",
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
  expense: Expense | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
}

export function ExpenseReviewDialog({ expense, open, onOpenChange, canManage }: Props) {
  const [rejectionReason, setRejectionReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const updateStatus = useUpdateExpenseStatus();
  const { data: users = [] } = useOrgUsers();
  const attachments = expense ? parseExpenseAttachments(expense) : [];

  if (!expense) return null;

  const getUserName = (id: string | null) => {
    if (!id) return "—";
    return users.find((u) => u.user_id === id)?.full_name || "—";
  };

  const openAttachment = async (path: string, name: string) => {
    setDownloadingPath(path);
    try {
      const { data, error } = await supabase.storage
        .from("documents")
        .createSignedUrl(path, 3600, { download: name });
      if (error) throw error;
      if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "No se pudo abrir el archivo";
      toast.error(msg);
    } finally {
      setDownloadingPath(null);
    }
  };

  const handleAction = async (status: string) => {
    if (status === "rechazado" && !rejectionReason.trim()) {
      setShowReject(true);
      return;
    }
    await updateStatus.mutateAsync({
      id: expense.id,
      status,
      rejection_reason: status === "rechazado" ? rejectionReason : undefined,
    });
    setShowReject(false);
    setRejectionReason("");
    onOpenChange(false);
  };

  const canReview = canManage && expense.status === "solicitado";
  const canApprove = canManage && expense.status === "en_revision";
  const canPay = canManage && expense.status === "aprobado";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden p-0 [&>button.absolute]:hidden flex flex-col rounded-2xl border-sky-200/40 dark:border-sky-900/40">
        <header
          className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5 text-white shrink-0"
          style={{ background: KAWIIL_AI_HEADER_BG }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/15 backdrop-blur-sm">
              <Receipt className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex items-center gap-2">
              <p className="truncate text-[14px] font-semibold leading-tight">
                Detalle de gasto
              </p>
              <Badge className={`${STATUS_STYLES[expense.status]} border-0 text-[10px] font-semibold`}>
                {STATUS_LABELS[expense.status]}
              </Badge>
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1.5 text-white/90 hover:bg-white/15"
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-3 text-sm px-4 pb-4 pt-3 sm:px-5 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-muted-foreground">Categoría</span>
              <p className="font-medium">{CATEGORY_LABELS[expense.category] || expense.category}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Fecha</span>
              <p className="font-medium">
                {format(new Date(expense.expense_date), "dd MMM yyyy", { locale: es })}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-muted-foreground">Monto</span>
              <p className="font-semibold text-lg">
                ${Number(expense.amount).toLocaleString("es-MX", { minimumFractionDigits: 2 })} {expense.currency}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Solicitante</span>
              <p className="font-medium">{getUserName(expense.requested_by)}</p>
            </div>
          </div>

          <div>
            <span className="text-muted-foreground">Descripción</span>
            <p>{expense.description}</p>
          </div>

          {expense.notes && (
            <div>
              <span className="text-muted-foreground">Notas</span>
              <p>{expense.notes}</p>
            </div>
          )}

          {attachments.length > 0 && (
            <div>
              <span className="text-muted-foreground flex items-center gap-1">
                <Paperclip className="h-3.5 w-3.5" />
                Comprobantes
              </span>
              <ul className="mt-1.5 space-y-1">
                {attachments.map((a) => (
                  <li key={a.path}>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-sm font-normal inline-flex items-center gap-1"
                      disabled={downloadingPath === a.path}
                      onClick={() => openAttachment(a.path, a.name)}
                    >
                      <Download className="h-3.5 w-3.5 shrink-0" />
                      {downloadingPath === a.path ? "Abriendo…" : a.name}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {expense.rejection_reason && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <span className="text-destructive font-medium text-xs">Motivo de rechazo</span>
              <p className="text-sm">{expense.rejection_reason}</p>
            </div>
          )}

          {(expense.reviewed_by || expense.approved_by || expense.paid_by) && (
            <div className="border-t pt-3 space-y-1 text-xs text-muted-foreground">
              {expense.reviewed_by && (
                <p>Revisado por {getUserName(expense.reviewed_by)} el {expense.reviewed_at ? format(new Date(expense.reviewed_at), "dd/MM/yyyy HH:mm") : ""}</p>
              )}
              {expense.approved_by && (
                <p>{expense.status === "rechazado" ? "Rechazado" : "Aprobado"} por {getUserName(expense.approved_by)} el {expense.approved_at ? format(new Date(expense.approved_at), "dd/MM/yyyy HH:mm") : ""}</p>
              )}
              {expense.paid_by && (
                <p>Pagado por {getUserName(expense.paid_by)} el {expense.paid_at ? format(new Date(expense.paid_at), "dd/MM/yyyy HH:mm") : ""}</p>
              )}
            </div>
          )}
        </div>

        {showReject && (
          <div className="space-y-2">
            <Textarea
              placeholder="Motivo del rechazo..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              rows={2}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={!rejectionReason.trim() || updateStatus.isPending}
                onClick={() => handleAction("rechazado")}
              >
                Confirmar rechazo
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowReject(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {canManage && !showReject && (
          <div className="flex gap-2 pt-2 border-t">
            {canReview && (
              <Button size="sm" onClick={() => handleAction("en_revision")} disabled={updateStatus.isPending}>
                <Eye className="h-3.5 w-3.5 mr-1" /> Marcar en revisión
              </Button>
            )}
            {canApprove && (
              <>
                <Button size="sm" onClick={() => handleAction("aprobado")} disabled={updateStatus.isPending}>
                  <Check className="h-3.5 w-3.5 mr-1" /> Aprobar
                </Button>
                <Button size="sm" variant="destructive" onClick={() => handleAction("rechazado")} disabled={updateStatus.isPending}>
                  <X className="h-3.5 w-3.5 mr-1" /> Rechazar
                </Button>
              </>
            )}
            {canPay && (
              <Button size="sm" onClick={() => handleAction("pagado")} disabled={updateStatus.isPending}>
                <CreditCard className="h-3.5 w-3.5 mr-1" /> Marcar pagado
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
