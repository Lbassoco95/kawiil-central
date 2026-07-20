import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type AccountProvider = "microsoft" | "google" | "imap";

export interface LinkedAccount {
  id: string;
  provider: AccountProvider;
  email: string | null;
  display_name: string | null;
  status: "connected" | "error" | "disconnected";
  calendar_enabled: boolean;
  mail_enabled: boolean;
  last_error: string | null;
  created_at: string;
}

/** Cuentas vinculadas del usuario (metadatos; los tokens nunca llegan al cliente). */
export function useLinkedAccounts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["linked-accounts"],
    queryFn: async (): Promise<LinkedAccount[]> => {
      // linked_accounts aún no está en los tipos generados de Supabase.
      const { data, error } = await (supabase as any)
        .from("linked_accounts")
        .select("id, provider, email, display_name, status, calendar_enabled, mail_enabled, last_error, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as LinkedAccount[];
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });
}

/** Renombra una cuenta vinculada (display_name) y lo persiste en Supabase. */
export function useRenameLinkedAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await (supabase as any)
        .from("linked_accounts")
        .update({ display_name: name.trim() || null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["linked-accounts"] });
      toast.success("Nombre de la cuenta actualizado");
    },
    onError: (err: Error) => toast.error("No se pudo renombrar: " + err.message),
  });
}

/** Conecta / desconecta una cuenta de Google (calendario). */
export function useGoogleConnection() {
  const queryClient = useQueryClient();

  const connect = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("google-auth");
      if (error) {
        const msg = String(error.message || error);
        // La función aún no está desplegada o falta configuración.
        if (/edge function|failed to send|not found|non-2xx/i.test(msg)) {
          throw new Error(
            "La conexión con Google todavía no está activada. Falta desplegar las funciones (google-auth/callback/api) y configurar GOOGLE_CLIENT_ID/SECRET en Supabase.",
          );
        }
        throw error;
      }
      if (data?.error) {
        if (data.error === "Google credentials not configured") {
          throw new Error("Faltan las credenciales de Google (GOOGLE_CLIENT_ID/SECRET) en Supabase.");
        }
        throw new Error(data.error);
      }
      if (!data?.url) throw new Error("No se recibió URL de autorización");
      window.open(data.url, "google-auth", "width=600,height=700");
      return new Promise<void>((resolve, reject) => {
        const handler = (event: MessageEvent) => {
          if (event.data?.type === "google-auth-success") {
            window.removeEventListener("message", handler);
            resolve();
          } else if (event.data?.type === "google-auth-error") {
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["linked-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["google-calendar-events"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      toast.success("Cuenta de Google conectada");
    },
    onError: (err: Error) => toast.error("Error al conectar Google: " + err.message),
  });

  const disconnect = useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await (supabase as any).from("linked_accounts").delete().eq("id", accountId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["linked-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["google-calendar-events"] });
      toast.success("Cuenta desconectada");
    },
    onError: (err: Error) => toast.error("Error al desconectar: " + err.message),
  });

  return { connect: connect.mutate, isConnecting: connect.isPending, disconnect: disconnect.mutate };
}

/** Crea un evento en el calendario principal de la cuenta Google conectada. */
export function useCreateGoogleEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      summary: string;
      description?: string;
      location?: string;
      date?: string;
      startDateTime?: string;
      endDateTime?: string;
    }): Promise<{ id: string; htmlLink?: string }> => {
      const { data, error } = await supabase.functions.invoke("google-api", {
        body: { action: "create-event", params },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { id: string; htmlLink?: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-events"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}

export interface GoogleCalendar {
  id: string;            // namespace: google:<accountId>:<calId>
  name: string;
  hexColor?: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
  _accountId: string;
}

/** Lista los calendarios de las cuentas Google conectadas (con id namespaced). */
export function useGoogleCalendars(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["google-calendars"],
    queryFn: async (): Promise<GoogleCalendar[]> => {
      const { data, error } = await supabase.functions.invoke("google-api", {
        body: { action: "calendars" },
      });
      if (error) throw error;
      return (data?.value as GoogleCalendar[]) || [];
    },
    enabled: !!user && enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** Eventos de calendario de las cuentas Google conectadas (formato normalizado tipo Graph). */
export function useGoogleCalendarEvents(start?: string, end?: string, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["google-calendar-events", start, end],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("google-api", {
        body: { action: "calendar-events", params: { start, end } },
      });
      if (error) throw error;
      return (data?.value as any[]) || [];
    },
    enabled: !!user && !!start && !!end && enabled,
    staleTime: 60 * 1000,
  });
}

// ───────────────────────── Outlook (cuentas adicionales) ─────────────────────────

/** Conecta / desconecta una cuenta ADICIONAL de Outlook/Microsoft (aparte del buzón principal). */
export function useOutlookConnection() {
  const queryClient = useQueryClient();

  const connect = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("outlook-account-auth");
      if (error) {
        const msg = String(error.message || error);
        if (/edge function|failed to send|not found|non-2xx/i.test(msg)) {
          throw new Error("La conexión con Outlook todavía no está activada. Falta desplegar las funciones (outlook-account-*).");
        }
        throw error;
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("No se recibió URL de autorización");
      window.open(data.url, "outlook-auth", "width=600,height=700");
      return new Promise<void>((resolve, reject) => {
        const handler = (event: MessageEvent) => {
          if (event.data?.type === "outlook-auth-success") {
            window.removeEventListener("message", handler);
            resolve();
          } else if (event.data?.type === "outlook-auth-error") {
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["linked-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["outlook-account-events"] });
      queryClient.invalidateQueries({ queryKey: ["outlook-account-calendars"] });
      toast.success("Cuenta de Outlook conectada");
    },
    onError: (err: Error) => toast.error("Error al conectar Outlook: " + err.message),
  });

  const disconnect = useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await (supabase as any).from("linked_accounts").delete().eq("id", accountId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["linked-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["outlook-account-events"] });
      toast.success("Cuenta desconectada");
    },
    onError: (err: Error) => toast.error("Error al desconectar: " + err.message),
  });

  return { connect: connect.mutate, isConnecting: connect.isPending, disconnect: disconnect.mutate };
}

/** Lista los calendarios de las cuentas Outlook adicionales (id namespaced outlook:<acc>:<cal>). */
export function useOutlookAccountCalendars(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["outlook-account-calendars"],
    queryFn: async (): Promise<GoogleCalendar[]> => {
      const { data, error } = await supabase.functions.invoke("outlook-account-api", {
        body: { action: "calendars" },
      });
      if (error) throw error;
      return (data?.value as GoogleCalendar[]) || [];
    },
    enabled: !!user && enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** Eventos de las cuentas Outlook adicionales (formato Graph, etiquetados con calendarId). */
export function useOutlookAccountEvents(start?: string, end?: string, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["outlook-account-events", start, end],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("outlook-account-api", {
        body: { action: "calendar-events", params: { start, end } },
      });
      if (error) throw error;
      return (data?.value as any[]) || [];
    },
    enabled: !!user && !!start && !!end && enabled,
    staleTime: 60 * 1000,
  });
}

/** Crea un evento en el calendario principal de la primera cuenta Outlook adicional. */
export function useCreateOutlookAccountEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      summary: string; description?: string; location?: string; date?: string; startDateTime?: string; endDateTime?: string;
    }): Promise<{ id: string; htmlLink?: string }> => {
      const { data, error } = await supabase.functions.invoke("outlook-account-api", {
        body: { action: "create-event", params },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { id: string; htmlLink?: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outlook-account-events"] });
    },
  });
}

// ─── Account color utility ────────────────────────────────────────────────────
const LINKED_ACCOUNT_COLORS = [
  "hsl(210 100% 47%)",
  "hsl(157 72% 36%)",
  "hsl(32 90% 48%)",
  "hsl(282 60% 45%)",
  "hsl(340 82% 52%)",
  "hsl(174 72% 35%)",
];

export function linkedAccountColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) & 0xffffffff;
  return LINKED_ACCOUNT_COLORS[Math.abs(hash) % LINKED_ACCOUNT_COLORS.length];
}

// ─── Linked Outlook Email Hooks ───────────────────────────────────────────────

export interface LinkedEmailPage {
  emails: Record<string, unknown>[];
  nextLink?: string;
}

export function useLinkedOutlookEmailsAll(options?: {
  accountId?: string;
  folder?: string;
  filterUnread?: boolean;
  enabled?: boolean;
}) {
  const { accountId, folder = "inbox", filterUnread, enabled = true } = options ?? {};
  return useInfiniteQuery({
    queryKey: ["linked-outlook-emails", accountId ?? "all", folder, filterUnread],
    queryFn: async ({ pageParam }: { pageParam: string | number }) => {
      const p: Record<string, unknown> = { accountId, folder, top: 25, filterUnread: filterUnread || undefined };
      if (typeof pageParam === "string" && pageParam.startsWith("http")) p.nextLink = pageParam;
      else if (typeof pageParam === "number" && pageParam > 0) p.skip = pageParam;
      const { data, error } = await supabase.functions.invoke("outlook-account-api", {
        body: { action: "emails", params: p },
      });
      if (error || data?.error) return { emails: [], nextLink: undefined } as LinkedEmailPage;
      return {
        emails: (data?.value ?? []) as Record<string, unknown>[],
        nextLink: data?.["@odata.nextLink"] as string | undefined,
      } as LinkedEmailPage;
    },
    initialPageParam: 0 as string | number,
    getNextPageParam: (last: LinkedEmailPage) => last.nextLink ?? undefined,
    enabled,
    staleTime: 30_000,
  });
}

export function useLinkedOutlookEmailDetail(accountId: string | null, emailId: string | null) {
  return useQuery({
    queryKey: ["linked-outlook-email-detail", accountId, emailId],
    queryFn: async () => {
      if (!accountId || !emailId) return null;
      const { data, error } = await supabase.functions.invoke("outlook-account-api", {
        body: { action: "email-detail", params: { accountId, emailId } },
      });
      if (error || data?.error) return null;
      return data as Record<string, unknown>;
    },
    enabled: !!accountId && !!emailId,
    staleTime: 60_000,
  });
}

export function useLinkedOutlookMailFolders(accountId: string | null) {
  return useQuery({
    queryKey: ["linked-outlook-mail-folders", accountId],
    queryFn: async () => {
      if (!accountId) return { folders: [] as Record<string, unknown>[] };
      const { data, error } = await supabase.functions.invoke("outlook-account-api", {
        body: { action: "mail-folders", params: { accountId } },
      });
      if (error || data?.error) return { folders: [] as Record<string, unknown>[] };
      return { folders: (data?.folders ?? []) as Record<string, unknown>[], accountId };
    },
    enabled: !!accountId,
    staleTime: 5 * 60_000,
  });
}

export function useLinkedOutlookInboxMeta() {
  return useQuery({
    queryKey: ["linked-outlook-inbox-meta"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("outlook-account-api", {
        body: { action: "inbox-meta", params: {} },
      });
      if (error || data?.error) return { accounts: [] as { accountId: string; email: string; unreadItemCount: number }[] };
      return { accounts: (data?.accounts ?? []) as { accountId: string; email: string; unreadItemCount: number }[] };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useMarkLinkedOutlookEmailRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, emailId }: { accountId: string; emailId: string }) => {
      await supabase.functions.invoke("outlook-account-api", {
        body: { action: "mark-read", params: { accountId, emailId } },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["linked-outlook-emails"] });
      queryClient.invalidateQueries({ queryKey: ["linked-outlook-inbox-meta"] });
    },
  });
}

export function useArchiveLinkedOutlookEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, emailId }: { accountId: string; emailId: string }) => {
      await supabase.functions.invoke("outlook-account-api", {
        body: { action: "archive-email", params: { accountId, emailId } },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["linked-outlook-emails"] });
      queryClient.invalidateQueries({ queryKey: ["linked-outlook-inbox-meta"] });
    },
  });
}

// ─── Gmail Email Hooks ────────────────────────────────────────────────────────

export interface GmailEmailPage {
  emails: Record<string, unknown>[];
  nextPageToken?: string;
}

export function useGmailEmailsAll(options?: {
  accountId?: string;
  labelId?: string;
  filterUnread?: boolean;
  enabled?: boolean;
}) {
  const { accountId, labelId = "INBOX", filterUnread, enabled = true } = options ?? {};
  return useInfiniteQuery({
    queryKey: ["gmail-emails", accountId ?? "all", labelId, filterUnread],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const p: Record<string, unknown> = { accountId, labelId, maxResults: 25, filterUnread: filterUnread || undefined };
      if (pageParam) p.pageToken = pageParam;
      const { data, error } = await supabase.functions.invoke("google-api", {
        body: { action: "gmail-emails", params: p },
      });
      if (error || data?.error) return { emails: [], nextPageToken: undefined } as GmailEmailPage;
      return {
        emails: (data?.value ?? []) as Record<string, unknown>[],
        nextPageToken: data?.nextPageToken as string | undefined,
      } as GmailEmailPage;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: GmailEmailPage) => last.nextPageToken ?? undefined,
    enabled,
    staleTime: 30_000,
  });
}

export function useGmailEmailDetail(accountId: string | null, emailId: string | null) {
  return useQuery({
    queryKey: ["gmail-email-detail", accountId, emailId],
    queryFn: async () => {
      if (!accountId || !emailId) return null;
      const { data, error } = await supabase.functions.invoke("google-api", {
        body: { action: "gmail-detail", params: { accountId, emailId } },
      });
      if (error || data?.error) return null;
      return data as Record<string, unknown>;
    },
    enabled: !!accountId && !!emailId,
    staleTime: 60_000,
  });
}

export function useGmailLabels(accountId: string | null) {
  return useQuery({
    queryKey: ["gmail-labels", accountId],
    queryFn: async () => {
      if (!accountId) return { value: [] as Record<string, unknown>[] };
      const { data, error } = await supabase.functions.invoke("google-api", {
        body: { action: "gmail-labels", params: { accountId } },
      });
      if (error || data?.error) return { value: [] as Record<string, unknown>[] };
      return { value: (data?.value ?? []) as Record<string, unknown>[], accountId };
    },
    enabled: !!accountId,
    staleTime: 5 * 60_000,
  });
}

export function useGmailInboxMeta() {
  return useQuery({
    queryKey: ["gmail-inbox-meta"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("google-api", {
        body: { action: "gmail-inbox-meta", params: {} },
      });
      if (error || data?.error) return { accounts: [] as { accountId: string; email: string; unreadItemCount: number }[] };
      return { accounts: (data?.accounts ?? []) as { accountId: string; email: string; unreadItemCount: number }[] };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useMarkGmailRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, emailId }: { accountId: string; emailId: string }) => {
      await supabase.functions.invoke("google-api", {
        body: { action: "gmail-mark-read", params: { accountId, emailId } },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gmail-emails"] });
      queryClient.invalidateQueries({ queryKey: ["gmail-inbox-meta"] });
    },
  });
}

export function useArchiveGmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, emailId }: { accountId: string; emailId: string }) => {
      await supabase.functions.invoke("google-api", {
        body: { action: "gmail-archive", params: { accountId, emailId } },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gmail-emails"] });
      queryClient.invalidateQueries({ queryKey: ["gmail-inbox-meta"] });
    },
  });
}
