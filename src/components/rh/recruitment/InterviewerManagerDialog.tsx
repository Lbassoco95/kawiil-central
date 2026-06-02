import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserPlus, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import {
  useProcessInterviewers,
  useAddInterviewer,
  useRemoveInterviewer,
} from "@/hooks/useRecruitment";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  processId: string;
}

export function InterviewerManagerDialog({ open, onOpenChange, processId }: Props) {
  const { data: users = [] } = useOrgUsers();
  const { data: assigned = [] } = useProcessInterviewers(processId);
  const add = useAddInterviewer();
  const remove = useRemoveInterviewer();

  const nameOf = (userId: string) => users.find((u) => u.user_id === userId)?.full_name ?? "Usuario";
  const available = users.filter((u) => u.is_active && !assigned.includes(u.user_id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Entrevistadores de la vacante</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Los entrevistadores solo ven esta vacante y sus candidatos: pueden calificar la rúbrica y dejar notas,
          sin editar la configuración ni mover candidatos.
        </p>

        <div className="space-y-2">
          {assigned.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay entrevistadores asignados.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {assigned.map((uid) => (
                <Badge key={uid} variant="secondary" className="gap-1 pr-1">
                  {nameOf(uid)}
                  <button
                    type="button"
                    onClick={() => remove.mutate({ processId, userId: uid })}
                    className="rounded-full p-0.5 hover:bg-background/60"
                    aria-label="Quitar"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select value="" onValueChange={(userId) => add.mutate({ processId, userId })}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Agregar entrevistador…" /></SelectTrigger>
            <SelectContent>
              {available.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">No hay más usuarios</div>
              ) : (
                available.map((u) => (
                  <SelectItem key={u.user_id} value={u.user_id}>{u.full_name}</SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <UserPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
