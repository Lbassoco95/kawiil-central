import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ABSENCE_TYPE_EMOJI,
  ABSENCE_TYPE_LABEL,
  DAY_PART_LABEL,
  REQUEST_STATUS_LABEL,
  type RhAbsenceRequest,
  type RhRequestStatus,
} from "@/lib/rh";
import { useUserAbsenceRequests } from "@/hooks/useRh";

const STATUS_STYLE: Record<RhRequestStatus, string> = {
  pending: "border-amber-300 text-amber-700 dark:text-amber-400",
  approved: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  rejected: "border-red-300 text-red-700 dark:text-red-400",
  cancelled: "border-border text-muted-foreground",
};

function fmtRange(r: RhAbsenceRequest): string {
  const f = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
  return r.start_date === r.end_date ? f(r.start_date) : `${f(r.start_date)} – ${f(r.end_date)}`;
}

/**
 * Historial de solicitudes/permisos de un colaborador, para su expediente.
 * Por defecto muestra las autorizadas (aprobadas); se puede ver todo.
 */
export function EmployeeAbsenceHistory({ userId }: { userId: string | null }) {
  const { data: requests = [], isLoading } = useUserAbsenceRequests(userId);
  const [onlyApproved, setOnlyApproved] = useState(true);

  const list = useMemo(
    () => (onlyApproved ? requests.filter((r) => r.status === "approved") : requests),
    [requests, onlyApproved],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Solicitudes y permisos</p>
        <button
          type="button"
          className="text-[11px] text-primary hover:underline"
          onClick={() => setOnlyApproved((v) => !v)}
        >
          {onlyApproved ? "Ver todas" : "Solo autorizadas"}
        </button>
      </div>

      {isLoading ? (
        <div className="flex h-16 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {onlyApproved ? "Sin solicitudes autorizadas." : "Sin solicitudes registradas."}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {list.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2">
              <span className="text-lg">{ABSENCE_TYPE_EMOJI[r.absence_type]}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{ABSENCE_TYPE_LABEL[r.absence_type]}</div>
                <div className="text-xs text-muted-foreground">
                  {fmtRange(r)} · {DAY_PART_LABEL[r.day_part]}
                  {r.decision_note ? ` · "${r.decision_note}"` : ""}
                </div>
              </div>
              <Badge variant="outline" className={cn("text-[10px]", STATUS_STYLE[r.status])}>
                {REQUEST_STATUS_LABEL[r.status]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
