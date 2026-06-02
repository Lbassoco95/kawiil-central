import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Loader2, CalendarDays, Inbox, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ABSENCE_TYPE_EMOJI,
  ABSENCE_TYPE_LABEL,
  DAY_PART_LABEL,
  REQUEST_STATUS_LABEL,
  type RhAbsenceRequest,
  type RhRequestStatus,
} from "@/lib/rh";
import {
  useMyAbsenceRequests,
  useCancelAbsenceRequest,
  useMyResponsibleCelulas,
  useCelulaAbsenceRequests,
  useDecideAbsenceRequest,
} from "@/hooks/useRh";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { AbsenceRequestDialog } from "./AbsenceRequestDialog";

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

export function SolicitudesPanel() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: myRequests = [], isLoading } = useMyAbsenceRequests();
  const cancel = useCancelAbsenceRequest();
  const { data: responsibleCelulas = [] } = useMyResponsibleCelulas();
  const isApprover = responsibleCelulas.length > 0;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-primary" />
            Mis solicitudes
          </CardTitle>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Nueva
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : myRequests.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No tienes solicitudes. Crea una con "Nueva".
            </p>
          ) : (
            <ul className="divide-y">
              {myRequests.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
                  <span className="text-lg">{ABSENCE_TYPE_EMOJI[r.absence_type]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{ABSENCE_TYPE_LABEL[r.absence_type]}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtRange(r)} · {DAY_PART_LABEL[r.day_part]}
                    </div>
                  </div>
                  <Badge variant="outline" className={cn(STATUS_STYLE[r.status])}>
                    {REQUEST_STATUS_LABEL[r.status]}
                  </Badge>
                  {r.status === "pending" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(r.id)}
                    >
                      Cancelar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {isApprover && <ApprovalsCard celulaIds={responsibleCelulas.map((c) => c.id)} />}

      <AbsenceRequestDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

function ApprovalsCard({ celulaIds }: { celulaIds: string[] }) {
  const { data: requests = [], isLoading } = useCelulaAbsenceRequests(celulaIds);
  const { data: users = [] } = useOrgUsers();
  const decide = useDecideAbsenceRequest();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const nameByUser = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.user_id, u.full_name);
    return m;
  }, [users]);

  const pending = requests.filter((r) => r.status === "pending");
  const recent = requests.filter((r) => r.status !== "pending").slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4 text-primary" />
          Por aprobar (mi célula)
          {pending.length > 0 && <Badge variant="secondary" className="ml-1">{pending.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : pending.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Sin solicitudes pendientes.</p>
        ) : (
          <ul className="space-y-3">
            {pending.map((r) => (
              <li key={r.id} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{ABSENCE_TYPE_EMOJI[r.absence_type]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{nameByUser.get(r.user_id) ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {ABSENCE_TYPE_LABEL[r.absence_type]} · {fmtRange(r)} · {DAY_PART_LABEL[r.day_part]}
                    </div>
                  </div>
                </div>
                {r.reason && <p className="mt-2 text-xs text-muted-foreground">"{r.reason}"</p>}
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    placeholder="Nota (opcional)"
                    className="h-8 flex-1 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 border-red-300 text-red-600 hover:bg-red-50"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: r.id, decision: "rejected", note: notes[r.id] || null })}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: r.id, decision: "approved", note: notes[r.id] || null })}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Aprobar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {recent.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Recientes</p>
            <ul className="divide-y">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-1.5 text-xs">
                  <span>{ABSENCE_TYPE_EMOJI[r.absence_type]}</span>
                  <span className="flex-1 truncate">
                    {nameByUser.get(r.user_id) ?? "—"} · {fmtRange(r)}
                  </span>
                  <Badge variant="outline" className={cn(STATUS_STYLE[r.status])}>
                    {REQUEST_STATUS_LABEL[r.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
