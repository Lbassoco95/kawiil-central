/**
 * Menú de la junta: cancelar (conserva historial) o eliminar (solo si está vacía).
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { mtgDb, type MtgMeetingRow } from "@/lib/mtg/db";
import { cancelMeeting, deleteEmptyMeeting } from "@/lib/mtg/meetingLifecycle";

type MeetingLike = Pick<MtgMeetingRow, "id" | "organization_id" | "status">;

export function MtgMeetingActionsMenu(props: {
  meeting: MeetingLike;
  onChanged?: () => void;
  /** Tras eliminar (la junta ya no existe). */
  onDeleted?: () => void;
}) {
  const { user } = useAuth();
  const { isAdminOrManager } = useUserRole();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { meeting } = props;
  const canCancel = meeting.status === "planned" || meeting.status === "in_progress";
  const canDelete = isAdminOrManager;
  if (!user || (!canCancel && !canDelete)) return null;

  const fullMeeting = async (): Promise<MtgMeetingRow> => {
    const { data, error } = await mtgDb.from("mtg_meetings").select("*").eq("id", meeting.id).single();
    if (error) throw error;
    return data as MtgMeetingRow;
  };

  const refresh = () => {
    void qc.invalidateQueries();
    props.onChanged?.();
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo completar la acción");
    } finally {
      setBusy(false);
    }
  };

  const onCancel = () =>
    run(async () => {
      if (!window.confirm("¿Cancelar esta junta? Se conserva en «Cerradas / canceladas».")) return;
      await cancelMeeting({
        organizationId: meeting.organization_id,
        actorUserId: user.id,
        meeting: await fullMeeting(),
      });
      toast.success("Junta cancelada");
      refresh();
    });

  const onDelete = () =>
    run(async () => {
      if (!window.confirm("¿Eliminar esta junta? Solo se borra si no tiene nada guardado. No se puede deshacer.")) {
        return;
      }
      await deleteEmptyMeeting({
        organizationId: meeting.organization_id,
        actorUserId: user.id,
        meeting: await fullMeeting(),
      });
      toast.success("Junta eliminada");
      refresh();
      props.onDeleted?.();
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={busy}
          aria-label="Más acciones"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {canCancel && <DropdownMenuItem onSelect={() => void onCancel()}>Cancelar junta</DropdownMenuItem>}
        {canDelete && (
          <DropdownMenuItem className="text-destructive" onSelect={() => void onDelete()}>
            Eliminar (solo si está vacía)
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
