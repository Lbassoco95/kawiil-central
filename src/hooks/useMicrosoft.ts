import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useMicrosoftConnection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const connectionQuery = useQuery({
    queryKey: ["microsoft-connection"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "check-connection" },
      });
      // If we get the NOT_CONNECTED code, return null (not an error)
      if (data?.code === "NOT_CONNECTED") return null;
      if (error) throw error;
      if (data?.error && data?.code !== "NOT_CONNECTED") throw new Error(data.error);
      return data;
    },
    enabled: !!user,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-auth");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.url) {
        const popup = window.open(data.url, "microsoft-auth", "width=600,height=700");
        return new Promise<void>((resolve, reject) => {
          const handler = (event: MessageEvent) => {
            if (event.data?.type === "microsoft-auth-success") {
              window.removeEventListener("message", handler);
              resolve();
            } else if (event.data?.type === "microsoft-auth-error") {
              window.removeEventListener("message", handler);
              reject(new Error(event.data.error));
            }
          };
          window.addEventListener("message", handler);
          setTimeout(() => {
            window.removeEventListener("message", handler);
            reject(new Error("Timeout - cierra la ventana e intenta de nuevo"));
          }, 300000);
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["microsoft-connection"] });
      toast.success("Microsoft 365 conectado exitosamente");
    },
    onError: (err: Error) => {
      toast.error("Error al conectar: " + err.message);
    },
  });

  return {
    isConnected: !!connectionQuery.data?.displayName || !!connectionQuery.data?.mail,
    profile: connectionQuery.data,
    isLoading: connectionQuery.isLoading,
    connect: connectMutation.mutate,
    isConnecting: connectMutation.isPending,
  };
}

export function useCalendarEvents(start?: string, end?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["calendar-events", start, end],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "calendar-events", params: { start, end } },
      });
      if (error) throw error;
      return data?.value || [];
    },
    enabled: !!user && !!start && !!end,
  });
}

export function useCreateCalendarEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (event: {
      subject: string;
      start: { dateTime: string; timeZone: string };
      end: { dateTime: string; timeZone: string };
      body?: { contentType: string; content: string };
      location?: { displayName: string };
      attendees?: { emailAddress: { address: string }; type?: string }[];
      categories?: string[];
      isOnlineMeeting?: boolean;
      onlineMeetingProvider?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "create-event", params: { event } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      toast.success("Evento creado en Outlook");
    },
    onError: (err: Error) => toast.error("Error al crear evento: " + err.message),
  });
}

export function useDeleteCalendarEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (eventId: string) => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "delete-event", params: { eventId } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-event-detail"] });
      toast.success("Evento eliminado");
    },
  });
}

export function useEventDetail(eventId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["calendar-event-detail", eventId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "event-detail", params: { eventId } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    enabled: !!user && !!eventId,
  });
}

export function useUpdateCalendarEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      eventId,
      payload,
    }: {
      eventId: string;
      payload: {
        subject?: string;
        start?: { dateTime: string; timeZone: string };
        end?: { dateTime: string; timeZone: string };
        body?: { contentType: string; content: string };
        location?: { displayName: string };
        categories?: string[];
        attendees?: { emailAddress: { address: string }; type?: string }[];
      };
    }) => {
      const res = await supabase.functions.invoke("microsoft-api", {
        body: { action: "update-event", params: { eventId, payload } },
      });
      if (res.error) {
        const msg = res.error?.message || String(res.error);
        if (msg.includes("Unexpected end of JSON") || msg.includes("json")) {
          return { success: true, eventId, payload };
        }
        throw res.error;
      }
      if (res.data?.error) throw new Error(res.data.error);
      return { ...(res.data || {}), success: true, eventId, payload };
    },
    onMutate: async ({ eventId, payload }) => {
      // Cancel outgoing refetches so they don't overwrite optimistic update
      await queryClient.cancelQueries({ queryKey: ["calendar-events"] });

      // Snapshot previous value
      const previousQueries = queryClient.getQueriesData({ queryKey: ["calendar-events"] });

      // Optimistically update all calendar-events queries
      queryClient.setQueriesData(
        { queryKey: ["calendar-events"] },
        (old: any) => {
          if (!old?.value && !Array.isArray(old)) return old;
          const events = old?.value || old;
          if (!Array.isArray(events)) return old;
          const updated = events.map((ev: any) => {
            if (ev.id !== eventId) return ev;
            return {
              ...ev,
              ...(payload.subject ? { subject: payload.subject } : {}),
              ...(payload.start ? { start: payload.start } : {}),
              ...(payload.end ? { end: payload.end } : {}),
              ...(payload.categories ? { categories: payload.categories } : {}),
            };
          });
          return old?.value ? { ...old, value: updated } : updated;
        }
      );

      return { previousQueries };
    },
    onError: (err: Error, _vars, context) => {
      // Rollback on error
      if (context?.previousQueries) {
        for (const [key, data] of context.previousQueries) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error("Error al actualizar evento: " + err.message);
    },
    onSuccess: (_data, vars) => {
      // Mantener el cambio visual inmediato y sincronizar después
      toast.success("Evento actualizado");

      // Refetch diferido para evitar que Graph devuelva estado viejo inmediato
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      }, 2500);

      // Segundo refetch de seguridad por consistencia eventual
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
        queryClient.invalidateQueries({ queryKey: ["calendar-event-detail", vars.eventId] });
      }, 7000);
    },
    onSettled: () => {
      // no-op: invalidación diferida en onSuccess
    },
  });
}

export function useOutlookCategories() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["outlook-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "outlook-categories" },
      });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    enabled: !!user,
  });
}

export function useOutlookEmails(folder = "inbox", search?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["outlook-emails", folder, search],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "emails", params: { folder, search, top: 30 } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data?.value || [];
    },
    enabled: !!user,
    refetchInterval: 60000, // sync read status every 60s
  });
}

export function useEmailDetail(messageId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["email-detail", messageId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "email-detail", params: { messageId } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    enabled: !!user && !!messageId,
  });
}

export function useReplyEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, comment, replyAll }: { messageId: string; comment: string; replyAll?: boolean }) => {
      const action = replyAll ? "reply-all" : "reply";
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action, params: { messageId, comment } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
      toast.success("Respuesta enviada");
    },
    onError: (err: Error) => toast.error("Error al responder: " + err.message),
  });
}



export function useMarkEmailRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageId: string) => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "mark-read", params: { messageId } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onMutate: async (messageId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["outlook-emails"] });
      await queryClient.cancelQueries({ queryKey: ["unread-email-count"] });

      // Optimistically update email list
      queryClient.setQueriesData({ queryKey: ["outlook-emails"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((e: any) => (e.id === messageId ? { ...e, isRead: true } : e));
      });

      // Optimistically decrement unread count
      queryClient.setQueryData(["unread-email-count"], (old: any) => {
        return typeof old === "number" && old > 0 ? old - 1 : 0;
      });
    },
    onSuccess: () => {
      // Refetch after a short delay to sync with server
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
        queryClient.invalidateQueries({ queryKey: ["unread-email-count"] });
      }, 2000);
    },
    onError: (err: Error) => {
      // Rollback on error
      queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
      queryClient.invalidateQueries({ queryKey: ["unread-email-count"] });
      toast.error("Error al marcar correo como leído: " + err.message);
    },
  });
}

export function useForwardEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, comment, toRecipients }: { messageId: string; comment: string; toRecipients: string[] }) => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: {
          action: "forward",
          params: {
            messageId,
            comment,
            toRecipients: toRecipients.map((email) => ({ emailAddress: { address: email } })),
          },
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Correo reenviado");
    },
    onError: (err: Error) => toast.error("Error al reenviar: " + err.message),
  });
}

export function useUnreadEmailCount() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["unread-email-count"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "emails", params: { folder: "inbox", top: 50 } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const emails = data?.value || [];
      return emails.filter((e: any) => !e.isRead).length;
    },
    enabled: !!user,
    refetchInterval: 60000, // poll every 60s
    staleTime: 30000,
  });
}
