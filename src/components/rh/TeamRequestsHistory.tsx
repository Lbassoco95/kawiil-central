import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, History } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ABSENCE_TYPE_EMOJI,
  ABSENCE_TYPE_LABEL,
  DAY_PART_LABEL,
  REQUEST_STATUS_LABEL,
  type RhAbsenceRequest,
  type RhRequestStatus,
} from "@/lib/rh";
import { useApprovableAbsenceRequests } from "@/hooks/useRh";
import { useOrgUsers } from "@/hooks/useOrgUsers";

const STATUS_STYLE: Record<RhRequestStatus, string> = {
  pending: "border-amber-300 text-amber-700 dark:text-amber-400",
  approved: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  rejected: "border-red-300 text-red-700 dark:text-red-400",
  cancelled: "border-border text-muted-foreground",
};

function fmtRange(r: RhAbsenceRequest): string {
  const f = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  return r.start_date === r.end_date ? f(r.start_date) : `${f(r.start_date)} – ${f(r.end_date)}`;
}

/** G4: historial de solicitudes/permisos del equipo, con filtros por colaborador y estado. */
export function TeamRequestsHistory() {
  const { data: requests = [], isLoading } = useApprovableAbsenceRequests();
  const { data: users = [] } = useOrgUsers();
  const [userId, setUserId] = useState("all");
  const [status, setStatus] = useState<"all" | RhRequestStatus>("all");

  const nameByUser = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.user_id, u.full_name);
    return m;
  }, [users]);

  const filtered = useMemo(
    () =>
      requests.filter(
        (r) => (userId === "all" || r.user_id === userId) && (status === "all" || r.status === status),
      ),
    [requests, userId, status],
  );

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-primary" />
          Historial de solicitudes del equipo
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="h-9 w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo el equipo</SelectItem>
              {users.filter((u) => u.is_active).map((u) => (
                <SelectItem key={u.user_id} value={u.user_id}>{u.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as "all" | RhRequestStatus)}>
            <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="approved">{REQUEST_STATUS_LABEL.approved}</SelectItem>
              <SelectItem value="rejected">{REQUEST_STATUS_LABEL.rejected}</SelectItem>
              <SelectItem value="pending">{REQUEST_STATUS_LABEL.pending}</SelectItem>
              <SelectItem value="cancelled">{REQUEST_STATUS_LABEL.cancelled}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Sin solicitudes que coincidan con los filtros.
          </p>
        ) : (
          <ul className="max-h-[26rem] divide-y overflow-y-auto pr-1">
            {filtered.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <span className="text-lg">{ABSENCE_TYPE_EMOJI[r.absence_type]}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{nameByUser.get(r.user_id) ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {ABSENCE_TYPE_LABEL[r.absence_type]} · {fmtRange(r)} · {DAY_PART_LABEL[r.day_part]}
                    {r.decision_note ? ` · "${r.decision_note}"` : ""}
                  </div>
                </div>
                <Badge variant="outline" className={cn(STATUS_STYLE[r.status])}>
                  {REQUEST_STATUS_LABEL[r.status]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
