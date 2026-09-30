/**
 * Abrir / crear junta Múuch' desde un evento de calendario.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { findOrCreateMeetingFromCalendar } from "@/lib/mtg/createFromCalendar";
import { toast } from "sonner";

async function resolveOrgId(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  if (!data?.organization_id) throw new Error("Tu usuario no tiene organización asignada.");
  return data.organization_id;
}

function durationMinutes(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return Math.max(5, Math.round((b - a) / 60000));
}

export function useOpenMeetingFromCalendar() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (event: {
      id: string;
      subject?: string | null;
      start?: { dateTime?: string; date?: string } | string | null;
      end?: { dateTime?: string; date?: string } | string | null;
      onlineMeeting?: { joinUrl?: string | null } | null;
      onlineMeetingUrl?: string | null;
    }) => {
      if (!user) throw new Error("Sesión requerida");
      const orgId = await resolveOrgId(user.id);
      const startRaw =
        typeof event.start === "string"
          ? event.start
          : event.start?.dateTime || event.start?.date || null;
      if (!startRaw) throw new Error("El evento no tiene fecha de inicio");
      const endRaw =
        typeof event.end === "string"
          ? event.end
          : event.end?.dateTime || event.end?.date || null;
      const joinUrl =
        event.onlineMeeting?.joinUrl || event.onlineMeetingUrl || null;

      // Conservamos el id compuesto (outlook:… / google:… / Graph id) para
      // idempotencia entre cuentas conectadas.
      return findOrCreateMeetingFromCalendar({
        organizationId: orgId,
        actorUserId: user.id,
        source: {
          outlookEventId: event.id,
          title: (event.subject || "Junta").trim(),
          scheduledAt: new Date(startRaw).toISOString(),
          durationMin: durationMinutes(startRaw, endRaw),
          teamsJoinUrl: joinUrl,
        },
      });
    },
    onSuccess: ({ meeting, created }) => {
      queryClient.invalidateQueries({ queryKey: ["mtg-meetings-org"] });
      toast.success(created ? "Junta creada desde el calendario" : "Abriendo junta existente");
      navigate(`/juntas/${meeting.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
