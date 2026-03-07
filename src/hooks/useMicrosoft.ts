import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useCallback, useEffect } from "react";

export function useMicrosoftConnection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const connectionQuery = useQuery({
    queryKey: ["microsoft-connection"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "check-connection" },
      });
      if (error) throw error;
      if (data?.code === "NOT_CONNECTED" || data?.error) return null;
      return data;
    },
    enabled: !!user,
    retry: false,
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-auth");
      if (error) throw error;
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
          // Timeout after 5 min
          setTimeout(() => {
            window.removeEventListener("message", handler);
            reject(new Error("Timeout"));
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
    isConnected: !!connectionQuery.data && !connectionQuery.data?.error,
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
        body: {
          action: "calendar-events",
          params: { start, end },
        },
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
    onError: (err: Error) => {
      toast.error("Error al crear evento: " + err.message);
    },
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
      toast.success("Evento eliminado");
    },
  });
}

export function useOutlookEmails(folder = "inbox", search?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["outlook-emails", folder, search],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: {
          action: "emails",
          params: { folder, search, top: 30 },
        },
      });
      if (error) throw error;
      return data?.value || [];
    },
    enabled: !!user,
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
      return data;
    },
    enabled: !!user && !!messageId,
  });
}
