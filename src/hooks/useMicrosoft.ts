import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { ComposerAttachment } from "@/lib/emailComposer";

/** No leídos de Bandeja de entrada (Graph `mailFolders/inbox.unreadItemCount`). Sidebar + módulo correo. */
export const INBOX_UNREAD_QUERY_KEY = ["inbox-unread-count"] as const;

function invalidateInboxUnreadAndMailFolders(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: INBOX_UNREAD_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: ["mail-folders"] });
}

function isNotConnectedError(data: any, error: any) {
  const errorMessage = String(error?.message || "").toLowerCase();
  const dataCode = String(data?.code || "");
  const dataError = String(data?.error || "").toLowerCase();

  return (
    dataCode === "NOT_CONNECTED" ||
    dataError.includes("microsoft not connected") ||
    errorMessage.includes("not_connected") ||
    errorMessage.includes("microsoft not connected")
  );
}

function getActionableError(err: Error): string {
  const message = String(err?.message || "");
  const lower = message.toLowerCase();
  if (lower.includes("permission_required")) {
    return "Faltan permisos de Microsoft. Reconecta tu cuenta de Microsoft 365.";
  }
  if (lower.includes("not_connected")) {
    return "Tu cuenta no está conectada. Vuelve a conectar Microsoft 365.";
  }
  if (lower.includes("invalid") || lower.includes("recipient")) {
    return "Hay destinatarios inválidos. Revisa los correos en Para/CC/BCC.";
  }
  if (lower.includes("attachment") || lower.includes("size")) {
    return "No se pudo adjuntar el archivo. Verifica tipo/tamaño e inténtalo de nuevo.";
  }
  return message;
}

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
        window.open(data.url, "microsoft-auth", "width=600,height=700");
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
      if (isNotConnectedError(data, error)) return [];
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
      if (isNotConnectedError(data, error)) return null;
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
      if (res.data?.code === "ITEM_NOT_FOUND") {
        throw new Error("El evento no fue encontrado. Puede que haya sido eliminado o modificado.");
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
      if (isNotConnectedError(data, error)) return [];
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    enabled: !!user,
  });
}

export function useOutlookEmails(folderId = "inbox", search?: string) {
  const { user } = useAuth();
  const PAGE_SIZE = 25;

  return useInfiniteQuery({
    queryKey: ["outlook-emails", folderId, search],
    queryFn: async ({ pageParam = 0 }) => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "emails", params: { folder: folderId, search, top: PAGE_SIZE, skip: pageParam } },
      });
      if (isNotConnectedError(data, error)) return { emails: [], nextSkip: null, totalCount: 0 };
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const emails = data?.value || [];
      const totalCount = data?.["@odata.count"] ?? null;
      const hasMore = emails.length === PAGE_SIZE;
      return {
        emails,
        nextSkip: hasMore ? pageParam + PAGE_SIZE : null,
        totalCount,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextSkip,
    enabled: !!user,
    refetchInterval: 60000,
  });
}

export function useMarkEmailUnread() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageId: string) => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "mark-unread", params: { messageId } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onMutate: async (messageId) => {
      await queryClient.cancelQueries({ queryKey: ["outlook-emails"] });
      let wasRead = false;
      queryClient.setQueriesData({ queryKey: ["outlook-emails"] }, (old: any) => {
        if (!old?.pages) return old;
        for (const page of old.pages) {
          const e = page.emails.find((em: any) => em.id === messageId);
          if (e?.isRead) wasRead = true;
        }
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            emails: page.emails.map((e: any) => (e.id === messageId ? { ...e, isRead: false } : e)),
          })),
        };
      });
      if (wasRead) {
        queryClient.setQueryData(INBOX_UNREAD_QUERY_KEY, (old: any) =>
          typeof old === "number" ? old + 1 : 1
        );
      }
    },
    onSuccess: () => {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
        invalidateInboxUnreadAndMailFolders(queryClient);
      }, 2000);
    },
  });
}

export function useArchiveEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageId: string) => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "archive-email", params: { messageId } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onMutate: async (messageId) => {
      await queryClient.cancelQueries({ queryKey: ["outlook-emails"] });
      let wasUnread = false;
      queryClient.setQueriesData({ queryKey: ["outlook-emails"] }, (old: any) => {
        if (!old?.pages) return old;
        for (const page of old.pages) {
          const e = page.emails.find((em: any) => em.id === messageId);
          if (e && !e.isRead) wasUnread = true;
        }
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            emails: page.emails.filter((e: any) => e.id !== messageId),
          })),
        };
      });
      if (wasUnread) {
        queryClient.setQueryData(INBOX_UNREAD_QUERY_KEY, (old: any) =>
          typeof old === "number" && old > 0 ? old - 1 : 0
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
      invalidateInboxUnreadAndMailFolders(queryClient);
    },
  });
}

export function useMailFolders() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["mail-folders"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "mail-folders" },
      });
      if (isNotConnectedError(data, error)) return [];
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEmailConversation(conversationId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["email-conversation", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "email-conversation", params: { conversationId } },
      });
      if (isNotConnectedError(data, error)) return [];
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    enabled: !!user && !!conversationId,
  });
}

export type CreateReplyDraftResult =
  | (Record<string, unknown> & { id: string })
  | { unsupported: true; message: string };

export function useCreateReplyDraft() {
  return useMutation({
    mutationFn: async ({ messageId, replyAll }: { messageId: string; replyAll?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "create-reply-draft", params: { messageId, replyAll } },
      });
      if (error) throw error;
      if (data?.code === "REFERENCE_NOT_SUPPORTED") {
        return {
          unsupported: true as const,
          message: String(data.error || "Este mensaje no admite respuesta con borrador."),
        };
      }
      if (data?.error) throw new Error(data.error);
      return data as CreateReplyDraftResult;
    },
  });
}

export function useCreateForwardDraft() {
  return useMutation({
    mutationFn: async ({ messageId }: { messageId: string }) => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "create-forward-draft", params: { messageId } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
  });
}

/** Firma para redactar correo nuevo: perfil Microsoft (/me) + heurística opcional con borrador. */
export function useOutlookComposeSignature(enabled: boolean) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["outlook-compose-signature"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "get-email-signature-html" },
      });
      if (isNotConnectedError(data, error)) return null;
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { html: string; source?: string; displayName?: string; mail?: string };
    },
    enabled: !!user && enabled,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

export function useSendDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      draftId,
      body,
      attachments,
      toRecipients,
    }: {
      draftId: string;
      body?: { contentType: string; content: string };
      attachments?: ComposerAttachment[];
      /** Para reenvíos: destinatarios del borrador antes de enviar. */
      toRecipients?: { emailAddress: { address: string } }[];
    }) => {
      const patch: Record<string, unknown> = {};
      if (body) patch.body = body;
      if (toRecipients?.length) patch.toRecipients = toRecipients;
      if (Object.keys(patch).length > 0) {
        const { error: updateError } = await supabase.functions.invoke("microsoft-api", {
          body: { action: "update-draft", params: { draftId, payload: patch } },
        });
        if (updateError) throw updateError;
      }
      if (attachments?.length) {
        for (const attachment of attachments) {
          const { error: attachError } = await supabase.functions.invoke("microsoft-api", {
            body: { action: "add-draft-attachment", params: { draftId, attachment } },
          });
          if (attachError) throw attachError;
        }
      }
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "send-draft", params: { draftId } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
      invalidateInboxUnreadAndMailFolders(queryClient);
      toast.success("Correo enviado");
    },
    onError: (err: Error) => toast.error("Error al enviar: " + getActionableError(err)),
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
      if (isNotConnectedError(data, error)) return null;
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
    onError: (err: Error) => toast.error("Error al responder: " + getActionableError(err)),
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
      await queryClient.cancelQueries({ queryKey: ["outlook-emails"] });
      await queryClient.cancelQueries({ queryKey: INBOX_UNREAD_QUERY_KEY });

      let wasUnread = false;
      queryClient.setQueriesData({ queryKey: ["outlook-emails"] }, (old: any) => {
        if (!old?.pages) return old;
        for (const page of old.pages) {
          const e = page.emails.find((em: any) => em.id === messageId);
          if (e && !e.isRead) wasUnread = true;
        }
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            emails: page.emails.map((e: any) => (e.id === messageId ? { ...e, isRead: true } : e)),
          })),
        };
      });

      if (wasUnread) {
        queryClient.setQueryData(INBOX_UNREAD_QUERY_KEY, (old: any) =>
          typeof old === "number" && old > 0 ? old - 1 : 0
        );
      }
    },
    onSuccess: () => {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
        invalidateInboxUnreadAndMailFolders(queryClient);
      }, 2000);
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
      invalidateInboxUnreadAndMailFolders(queryClient);
      toast.error("Error al marcar correo como leído: " + err.message);
    },
  });
}

export function useForwardEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      messageId,
      comment,
      toRecipients,
      attachments,
    }: {
      messageId: string;
      comment: string;
      toRecipients: string[];
      attachments?: ComposerAttachment[];
    }) => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: {
          action: "forward",
          params: {
            messageId,
            comment,
            toRecipients: toRecipients.map((email) => ({ emailAddress: { address: email } })),
            attachments,
          },
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Correo reenviado");
    },
    onError: (err: Error) => toast.error("Error al reenviar: " + getActionableError(err)),
  });
}

export function useCreateMailFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (displayName: string) => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "create-mail-folder", params: { displayName } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mail-folders"] });
      toast.success("Carpeta creada");
    },
    onError: (err: Error) => toast.error("Error al crear carpeta: " + err.message),
  });
}

export function useMoveEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, destinationId }: { messageId: string; destinationId: string }) => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "move-email", params: { messageId, destinationId } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onMutate: async ({ messageId }) => {
      await queryClient.cancelQueries({ queryKey: ["outlook-emails"] });
      const previousQueries = queryClient.getQueriesData({ queryKey: ["outlook-emails"] });
      queryClient.setQueriesData({ queryKey: ["outlook-emails"] }, (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            emails: page.emails.filter((e: any) => e.id !== messageId),
          })),
        };
      });
      return { previousQueries };
    },
    onError: (_err: Error, _vars, context) => {
      if (context?.previousQueries) {
        for (const [key, data] of context.previousQueries) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error("Error al mover correo");
    },
    onSuccess: () => {
      toast.success("Correo movido");
      queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
      invalidateInboxUnreadAndMailFolders(queryClient);
    },
  });
}

export function useSendNewEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
      attachments,
    }: {
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject: string;
      bodyHtml: string;
      attachments?: ComposerAttachment[];
    }) => {
      const message: any = {
        subject,
        body: { contentType: "HTML", content: bodyHtml },
        toRecipients: to.map((e) => ({ emailAddress: { address: e.trim() } })),
      };
      if (cc?.length) {
        message.ccRecipients = cc.map((e) => ({ emailAddress: { address: e.trim() } }));
      }
      if (bcc?.length) {
        message.bccRecipients = bcc.map((e) => ({ emailAddress: { address: e.trim() } }));
      }
      if (attachments?.length) {
        message.attachments = attachments.map((attachment) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: attachment.name,
          contentType: attachment.contentType,
          contentBytes: attachment.contentBytes,
        }));
      }
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "send-email", params: { message } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
      toast.success("Correo enviado");
    },
    onError: (err: Error) => toast.error("Error al enviar correo: " + getActionableError(err)),
  });
}

export function useDeleteEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageId: string) => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "delete-email", params: { messageId } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onMutate: async (messageId) => {
      await queryClient.cancelQueries({ queryKey: ["outlook-emails"] });
      const previousQueries = queryClient.getQueriesData({ queryKey: ["outlook-emails"] });
      let wasUnread = false;
      queryClient.setQueriesData({ queryKey: ["outlook-emails"] }, (old: any) => {
        if (!old?.pages) return old;
        for (const page of old.pages) {
          const e = page.emails.find((em: any) => em.id === messageId);
          if (e && !e.isRead) wasUnread = true;
        }
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            emails: page.emails.filter((e: any) => e.id !== messageId),
          })),
        };
      });
      if (wasUnread) {
        queryClient.setQueryData(INBOX_UNREAD_QUERY_KEY, (old: any) =>
          typeof old === "number" && old > 0 ? old - 1 : 0
        );
      }
      return { previousQueries };
    },
    onError: (_err: Error, _vars, context) => {
      if (context?.previousQueries) {
        for (const [key, data] of context.previousQueries) {
          queryClient.setQueryData(key, data);
        }
      }
      invalidateInboxUnreadAndMailFolders(queryClient);
      toast.error("Error al eliminar correo");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
      invalidateInboxUnreadAndMailFolders(queryClient);
      toast.success("Correo eliminado");
    },
  });
}

export function useEmailAttachments(messageId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["email-attachments", messageId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "email-attachments", params: { messageId } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data?.value || []) as Array<{
        id: string;
        name: string;
        contentType: string;
        size: number;
        contentBytes?: string;
        contentId?: string;
        isInline?: boolean;
        "@odata.type"?: string;
      }>;
    },
    enabled: !!user && !!messageId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUnreadEmailCount() {
  const { user } = useAuth();

  return useQuery({
    queryKey: INBOX_UNREAD_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "inbox-folder-meta" },
      });
      if (isNotConnectedError(data, error)) return 0;
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return Number(data?.unreadItemCount ?? 0);
    },
    enabled: !!user,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

