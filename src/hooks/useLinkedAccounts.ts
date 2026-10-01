import { useSyncExternalStore } from "react";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEmailDetail, useEmailAttachments, useRespondEvent } from "@/hooks/useMicrosoft";
import { fetchMessageAttachmentBlob } from "@/lib/outlookEmailMedia";
import { AdminConsentRequiredError, isAdminConsentRequiredCode } from "@/lib/microsoftAdminConsent";
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

/** Envía un correo NUEVO desde una cuenta Outlook vinculada (send-as de esa cuenta). */
export function useSendLinkedOutlookEmail() {
  return useMutation({
    mutationFn: async (p: {
      accountId: string;
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject: string;
      bodyHtml: string;
      attachments?: { name: string; contentType: string; contentBytes: string }[];
    }) => {
      const { data, error } = await supabase.functions.invoke("outlook-account-api", {
        body: { action: "send-email", params: p },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data;
    },
  });
}

/** Envía un correo NUEVO desde una cuenta Gmail vinculada (send-as de esa cuenta). */
export function useSendLinkedGmailEmail() {
  return useMutation({
    mutationFn: async (p: {
      accountId: string;
      to: string[];
      cc?: string[];
      subject: string;
      bodyHtml: string;
      attachments?: { name: string; contentType: string; contentBytes: string }[];
    }) => {
      const { data, error } = await supabase.functions.invoke("google-api", {
        body: { action: "gmail-send", params: p },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data;
    },
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
export interface CalendarAccountDiagnostic {
  accountId: string;
  email: string | null;
  ok: boolean;
  reason?: "reconnect_needed" | "calendar_api_disabled" | "forbidden" | "api_error";
  message?: string;
  count?: number;
}

export function useGoogleCalendars(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["google-calendars"],
    queryFn: async (): Promise<{ value: GoogleCalendar[]; diagnostics: CalendarAccountDiagnostic[] }> => {
      const { data, error } = await supabase.functions.invoke("google-api", {
        body: { action: "calendars" },
      });
      if (error) throw error;
      return {
        value: (data?.value as GoogleCalendar[]) || [],
        diagnostics: (data?.diagnostics as CalendarAccountDiagnostic[]) || [],
      };
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

export type OutlookAdminConsentPrompt = { open: boolean; tenant: string | null };

let adminConsentPrompt: OutlookAdminConsentPrompt = { open: false, tenant: null };
const adminConsentListeners = new Set<() => void>();

function setAdminConsentPrompt(next: OutlookAdminConsentPrompt) {
  adminConsentPrompt = next;
  adminConsentListeners.forEach((l) => l());
}

function subscribeAdminConsentPrompt(listener: () => void) {
  adminConsentListeners.add(listener);
  return () => adminConsentListeners.delete(listener);
}

/** Estado del diálogo "requiere aprobación del administrador" (compartido por toda la app). */
export function useOutlookAdminConsentPrompt() {
  const prompt = useSyncExternalStore(subscribeAdminConsentPrompt, () => adminConsentPrompt);
  return {
    ...prompt,
    close: () => setAdminConsentPrompt({ open: false, tenant: prompt.tenant }),
  };
}

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
            if (isAdminConsentRequiredCode(event.data.error)) {
              reject(new AdminConsentRequiredError(typeof event.data.tenant === "string" ? event.data.tenant : null));
            } else {
              reject(new Error(String(event.data.error || "Error de Microsoft")));
            }
          } else if (event.data?.type === "outlook-admin-consent-success") {
            toast.success("Aprobado, ya puedes conectar");
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
    onError: (err: Error) => {
      if (err instanceof AdminConsentRequiredError) {
        setAdminConsentPrompt({ open: true, tenant: err.tenant });
        return;
      }
      toast.error("Error al conectar Outlook: " + err.message);
    },
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

// ─── RSVP ruteado por cuenta ──────────────────────────────────────────────────

export type CalendarProvider = "primary" | "outlook" | "google";

/**
 * Determina el proveedor y los ids crudos de un evento a partir de su id y calendarId.
 * - Principal Microsoft: id sin prefijo → microsoft-api.
 * - Outlook vinculado:  id `outlook:<rawId>`, calendarId `outlook:<accId>:<calId>`.
 * - Google vinculado:   id `google:<rawId>`,  calendarId `google:<accId>:<calId>`.
 */
export function parseCalendarEventRef(eventId: string | null, calendarId?: string | null): {
  provider: CalendarProvider;
  accountId: string | null;
  rawEventId: string | null;
  rawCalendarId: string | null;
} {
  if (!eventId) return { provider: "primary", accountId: null, rawEventId: null, rawCalendarId: null };
  const calParts = (calendarId || "").split(":");
  const accountId = calParts.length >= 2 ? calParts[1] : null;
  const rawCalendarId = calParts.length >= 3 ? calParts.slice(2).join(":") : null;
  if (eventId.startsWith("outlook:")) {
    return { provider: "outlook", accountId, rawEventId: eventId.slice("outlook:".length), rawCalendarId };
  }
  if (eventId.startsWith("google:")) {
    return { provider: "google", accountId, rawEventId: eventId.slice("google:".length), rawCalendarId };
  }
  return { provider: "primary", accountId: null, rawEventId: eventId, rawCalendarId: null };
}

/**
 * Responde una invitación (RSVP) en CUALQUIER cuenta conectada, ruteando al backend
 * correcto según el prefijo del evento (principal Microsoft, Outlook vinculado o Google).
 */
export function useRoutedRespondEvent() {
  const queryClient = useQueryClient();
  const primary = useRespondEvent();

  const respondLabel = (response: "accept" | "tentative" | "decline") =>
    response === "accept" ? "Invitación aceptada" : response === "tentative" ? "Marcada como tentativa" : "Invitación rechazada";

  const outlook = useMutation({
    mutationFn: async (vars: { accountId: string | null; eventId: string; response: "accept" | "tentative" | "decline" }) => {
      const { data, error } = await supabase.functions.invoke("outlook-account-api", {
        body: { action: "respond-event", params: { accountId: vars.accountId, eventId: vars.eventId, response: vars.response } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_d, vars) => {
      toast.success(respondLabel(vars.response));
      queryClient.invalidateQueries({ queryKey: ["outlook-account-events"] });
    },
    onError: (err: Error) => toast.error("No se pudo responder la invitación: " + err.message),
  });

  const google = useMutation({
    mutationFn: async (vars: { accountId: string | null; calendarId: string | null; eventId: string; response: "accept" | "tentative" | "decline" }) => {
      const { data, error } = await supabase.functions.invoke("google-api", {
        body: { action: "respond-event", params: { accountId: vars.accountId, calendarId: vars.calendarId, eventId: vars.eventId, response: vars.response } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_d, vars) => {
      toast.success(respondLabel(vars.response));
      queryClient.invalidateQueries({ queryKey: ["google-calendar-events"] });
    },
    onError: (err: Error) => toast.error("No se pudo responder la invitación: " + err.message),
  });

  const mutate = (args: { eventId: string; calendarId?: string | null; response: "accept" | "tentative" | "decline" }) => {
    const ref = parseCalendarEventRef(args.eventId, args.calendarId);
    if (ref.provider === "outlook") {
      outlook.mutate({ accountId: ref.accountId, eventId: ref.rawEventId!, response: args.response });
    } else if (ref.provider === "google") {
      google.mutate({ accountId: ref.accountId, calendarId: ref.rawCalendarId, eventId: ref.rawEventId!, response: args.response });
    } else {
      primary.mutate({ eventId: args.eventId, response: args.response });
    }
  };

  return { mutate, isPending: primary.isPending || outlook.isPending || google.isPending };
}

/**
 * Actualiza un evento (PATCH parcial) ruteando al backend correcto. Silencioso (sin
 * toasts) — pensado para sincronizaciones en segundo plano como reflejar las
 * categorías Kawiil en las categorías nativas de Outlook. Google no soporta
 * categorías de texto, así que ahí se ignora.
 */
export function useRoutedUpdateEvent() {
  const queryClient = useQueryClient();

  const primary = useMutation({
    mutationFn: async (vars: { eventId: string; payload: Record<string, any> }) => {
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "update-event", params: { eventId: vars.eventId, payload: vars.payload } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["calendar-events"] }), 1500);
    },
  });

  const outlook = useMutation({
    mutationFn: async (vars: { accountId: string | null; eventId: string; payload: Record<string, any> }) => {
      const { data, error } = await supabase.functions.invoke("outlook-account-api", {
        body: { action: "update-event", params: { accountId: vars.accountId, eventId: vars.eventId, payload: vars.payload } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["outlook-account-events"] }), 1500);
    },
  });

  const google = useMutation({
    mutationFn: async (vars: { accountId: string | null; calendarId: string | null; eventId: string; payload: Record<string, any> }) => {
      const { data, error } = await supabase.functions.invoke("google-api", {
        body: { action: "update-event", params: { accountId: vars.accountId, calendarId: vars.calendarId, eventId: vars.eventId, payload: vars.payload } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["google-calendar-events"] }), 1500);
    },
  });

  const mutate = (args: { eventId: string; calendarId?: string | null; payload: Record<string, any> }) => {
    const ref = parseCalendarEventRef(args.eventId, args.calendarId);
    if (ref.provider === "outlook") {
      outlook.mutate({ accountId: ref.accountId, eventId: ref.rawEventId!, payload: args.payload });
    } else if (ref.provider === "google") {
      // Google no tiene categorías; el backend ignora ese campo. Útil para mover fecha/hora.
      google.mutate({ accountId: ref.accountId, calendarId: ref.rawCalendarId, eventId: ref.rawEventId!, payload: args.payload });
    } else {
      primary.mutate({ eventId: args.eventId, payload: args.payload });
    }
  };

  return { mutate, isPending: primary.isPending || outlook.isPending || google.isPending };
}

/**
 * Edita un evento de una cuenta VINCULADA (Outlook o Google) desde el diálogo.
 * (La cuenta principal usa useUpdateCalendarEvent.) El payload va en estilo Graph;
 * google-api lo traduce a los campos de Google.
 */
export function useUpdateLinkedEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { eventId: string; calendarId?: string | null; payload: Record<string, any> }) => {
      const ref = parseCalendarEventRef(vars.eventId, vars.calendarId);
      if (ref.provider === "outlook") {
        const { data, error } = await supabase.functions.invoke("outlook-account-api", {
          body: { action: "update-event", params: { accountId: ref.accountId, eventId: ref.rawEventId, payload: vars.payload } },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        return data;
      }
      if (ref.provider === "google") {
        const { data, error } = await supabase.functions.invoke("google-api", {
          body: { action: "update-event", params: { accountId: ref.accountId, calendarId: ref.rawCalendarId, eventId: ref.rawEventId, payload: vars.payload } },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        return data;
      }
      throw new Error("Cuenta no soportada para edición");
    },
    onSuccess: (_d, vars) => {
      toast.success("Evento actualizado");
      const ref = parseCalendarEventRef(vars.eventId, vars.calendarId);
      const key = ref.provider === "google" ? "google-calendar-events" : "outlook-account-events";
      setTimeout(() => queryClient.invalidateQueries({ queryKey: [key] }), 800);
      setTimeout(() => queryClient.invalidateQueries({ queryKey: [key] }), 3000);
    },
    onError: (err: Error) => toast.error("No se pudo actualizar: " + err.message),
  });
}

/**
 * Crea un evento en una cuenta VINCULADA (Outlook o Google) a partir de un cuerpo
 * estilo Graph (el que arma el diálogo de crear). El backend traduce lo necesario.
 */
export function useCreateLinkedEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { provider: "microsoft" | "google"; accountId: string; event: Record<string, any> }) => {
      const fn = vars.provider === "google" ? "google-api" : "outlook-account-api";
      const { data, error } = await supabase.functions.invoke(fn, {
        body: { action: "create-event", params: { accountId: vars.accountId, event: vars.event } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_d, vars) => {
      const key = vars.provider === "google" ? "google-calendar-events" : "outlook-account-events";
      setTimeout(() => queryClient.invalidateQueries({ queryKey: [key] }), 800);
      setTimeout(() => queryClient.invalidateQueries({ queryKey: [key] }), 3000);
    },
    onError: (err: Error) => toast.error("No se pudo crear el evento: " + err.message),
  });
}

/** Elimina un evento de una cuenta VINCULADA (Outlook o Google). */
export function useDeleteLinkedEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { eventId: string; calendarId?: string | null }) => {
      const ref = parseCalendarEventRef(vars.eventId, vars.calendarId);
      const fn = ref.provider === "google" ? "google-api" : "outlook-account-api";
      const params = ref.provider === "google"
        ? { accountId: ref.accountId, calendarId: ref.rawCalendarId, eventId: ref.rawEventId }
        : { accountId: ref.accountId, eventId: ref.rawEventId };
      const { data, error } = await supabase.functions.invoke(fn, {
        body: { action: "delete-event", params },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_d, vars) => {
      toast.success("Evento eliminado");
      const ref = parseCalendarEventRef(vars.eventId, vars.calendarId);
      const key = ref.provider === "google" ? "google-calendar-events" : "outlook-account-events";
      setTimeout(() => queryClient.invalidateQueries({ queryKey: [key] }), 800);
    },
    onError: (err: Error) => toast.error("No se pudo eliminar: " + err.message),
  });
}

// ─── Categorías NATIVAS por cuenta (masterCategories de Outlook) ────────────────
// Una sola fuente de categorías, ligada a cada cuenta conectada y sincronizada con
// su bandeja. accountId === "microsoft-primary" es la cuenta principal (Kawiil).

const PRIMARY_MS_ACCOUNT_ID = "microsoft-primary";

export interface AccountCategory {
  id: string;
  displayName: string;
  color?: string;
  accountId: string;
}

/** Categorías nativas de TODAS las cuentas Microsoft conectadas (principal + Outlook vinculadas). */
export function useAccountCategories() {
  const { user } = useAuth();
  const { data: linked = [] } = useLinkedAccounts();
  const outlookAccounts = linked.filter((a) => a.provider === "microsoft" && a.status !== "disconnected");
  const acctKey = outlookAccounts.map((a) => a.id).sort().join(",");
  return useQuery({
    queryKey: ["account-categories", acctKey],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AccountCategory[]> => {
      const out: AccountCategory[] = [];
      const { data: primary } = await supabase.functions.invoke("microsoft-api", { body: { action: "outlook-categories" } });
      if (Array.isArray(primary)) {
        for (const c of primary) out.push({ id: c.id, displayName: c.displayName, color: c.color, accountId: PRIMARY_MS_ACCOUNT_ID });
      }
      for (const acc of outlookAccounts) {
        try {
          const { data } = await supabase.functions.invoke("outlook-account-api", { body: { action: "outlook-categories", params: { accountId: acc.id } } });
          for (const c of (data?.value ?? [])) out.push({ id: c.id, displayName: c.displayName, color: c.color, accountId: acc.id });
        } catch { /* cuenta sin acceso: se omite */ }
      }
      return out;
    },
  });
}

/** Crea una categoría nativa en la cuenta elegida (principal u Outlook vinculada). */
export function useCreateAccountCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, displayName }: { accountId: string; displayName: string }): Promise<AccountCategory | null> => {
      const isPrimary = accountId === PRIMARY_MS_ACCOUNT_ID;
      const { data, error } = await supabase.functions.invoke(isPrimary ? "microsoft-api" : "outlook-account-api", {
        body: { action: "create-outlook-category", params: isPrimary ? { displayName } : { accountId, displayName } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data ? { id: data.id, displayName: data.displayName, color: data.color, accountId } : null;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["account-categories"] }); toast.success("Categoría creada"); },
    onError: (e: Error) => toast.error("No se pudo crear la categoría: " + e.message),
  });
}

/** Elimina una categoría nativa de la cuenta indicada. */
export function useDeleteAccountCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, id }: { accountId: string; id: string }) => {
      const isPrimary = accountId === PRIMARY_MS_ACCOUNT_ID;
      const { data, error } = await supabase.functions.invoke(isPrimary ? "microsoft-api" : "outlook-account-api", {
        body: { action: "delete-outlook-category", params: isPrimary ? { id } : { accountId, id } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["account-categories"] }); toast.success("Categoría eliminada"); },
    onError: (e: Error) => toast.error("No se pudo eliminar: " + e.message),
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
  search?: string;
  enabled?: boolean;
}) {
  const { accountId, folder = "inbox", filterUnread, search, enabled = true } = options ?? {};
  const cleanSearch = (search || "").trim() || undefined;
  return useInfiniteQuery({
    queryKey: ["linked-outlook-emails", accountId ?? "all", folder, filterUnread, cleanSearch],
    queryFn: async ({ pageParam }: { pageParam: string | number }) => {
      const p: Record<string, unknown> = { accountId, folder, top: 25, filterUnread: filterUnread || undefined, search: cleanSearch };
      if (typeof pageParam === "string" && pageParam.startsWith("http")) p.nextLink = pageParam;
      else if (typeof pageParam === "number" && pageParam > 0) p.skip = pageParam;
      const { data, error } = await supabase.functions.invoke("outlook-account-api", {
        body: { action: "emails", params: p },
      });
      if (error) throw error;
      if (data?.error) {
        const err = new Error(String(data.error));
        (err as Error & { code?: string }).code = String(data.code || "");
        throw err;
      }
      return {
        emails: (data?.value ?? []) as Record<string, unknown>[],
        nextLink: data?.["@odata.nextLink"] as string | undefined,
      } as LinkedEmailPage;
    },
    initialPageParam: 0 as string | number,
    getNextPageParam: (last: LinkedEmailPage) => last.nextLink ?? undefined,
    enabled,
    staleTime: 30_000,
    retry: 1,
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
      if (!accountId) return { folders: [] as Record<string, unknown>[], error: null };
      const { data, error } = await supabase.functions.invoke("outlook-account-api", {
        body: { action: "mail-folders", params: { accountId } },
      });
      if (error || data?.error) {
        return {
          folders: [] as Record<string, unknown>[],
          error: data?.error || String(error),
        };
      }
      const folders = (data?.folders ?? []) as Record<string, unknown>[];
      return {
        folders: folders.map((f) => {
          const rawParent = f.parentFolderId ? String(f.parentFolderId) : undefined;
          return {
            ...f,
            id: String(f.id),
            displayName: String(f.displayName || ""),
            parentFolderId: rawParent ? `outlook:${accountId}:${rawParent}` : undefined,
            childFolderCount: typeof f.childFolderCount === "number" ? f.childFolderCount : 0,
            wellKnownFolderName: f.wellKnownFolderName || undefined,
            unreadItemCount: typeof f.unreadItemCount === "number" ? f.unreadItemCount : undefined,
            totalItemCount: typeof f.totalItemCount === "number" ? f.totalItemCount : undefined,
          };
        }),
        accountId,
        error: null,
      };
    },
    enabled: !!accountId,
    staleTime: 0,
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
  search?: string;
  enabled?: boolean;
}) {
  const { accountId, labelId = "INBOX", filterUnread, search, enabled = true } = options ?? {};
  const cleanSearch = (search || "").trim() || undefined;
  return useInfiniteQuery({
    queryKey: ["gmail-emails", accountId ?? "all", labelId, filterUnread, cleanSearch],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const p: Record<string, unknown> = { accountId, labelId, maxResults: 25, filterUnread: filterUnread || undefined, search: cleanSearch };
      if (pageParam) p.pageToken = pageParam;
      const { data, error } = await supabase.functions.invoke("google-api", {
        body: { action: "gmail-emails", params: p },
      });
      if (error) throw error;
      if (data?.error) {
        const err = new Error(String(data.error));
        (err as Error & { code?: string }).code = String(data.code || "");
        throw err;
      }
      return {
        emails: (data?.value ?? []) as Record<string, unknown>[],
        nextPageToken: data?.nextPageToken as string | undefined,
      } as GmailEmailPage;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: GmailEmailPage) => last.nextPageToken ?? undefined,
    enabled,
    staleTime: 30_000,
    retry: 1,
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

/** Desglosa un ID de correo con prefijo de cuenta: "outlook:{acc}:{id}" | "gmail:{acc}:{id}" | primario. */
export function parseEmailAccountRef(emailId: string | null): {
  provider: "primary" | "outlook" | "gmail";
  accountId: string | null;
} {
  if (!emailId) return { provider: "primary", accountId: null };
  const parts = emailId.split(":");
  if (parts.length >= 3 && (parts[0] === "outlook" || parts[0] === "gmail") && parts[1]) {
    return { provider: parts[0] as "outlook" | "gmail", accountId: parts[1] };
  }
  return { provider: "primary", accountId: null };
}

/** Detalle de un correo ruteado por prefijo de ID (cuenta principal, Outlook vinculado o Gmail). */
export function useRoutedEmailDetail(emailId: string | null) {
  const ref = parseEmailAccountRef(emailId);
  const primary = useEmailDetail(ref.provider === "primary" ? emailId : null);
  const linkedOutlook = useLinkedOutlookEmailDetail(
    ref.provider === "outlook" ? ref.accountId : null,
    ref.provider === "outlook" ? emailId : null,
  );
  const gmail = useGmailEmailDetail(
    ref.provider === "gmail" ? ref.accountId : null,
    ref.provider === "gmail" ? emailId : null,
  );
  if (ref.provider === "outlook") return { ...linkedOutlook, accountRef: ref };
  if (ref.provider === "gmail") return { ...gmail, accountRef: ref };
  return { ...primary, accountRef: ref };
}

// ─── Adjuntos ruteados por cuenta ─────────────────────────────────────────────

export interface EmailAttachmentMeta {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline?: boolean;
  contentId?: string;
  "@odata.type"?: string;
}

/** Lista de adjuntos de un correo, ruteada por prefijo de ID (principal, Outlook o Gmail). */
export function useRoutedEmailAttachments(emailId: string | null) {
  const ref = parseEmailAccountRef(emailId);
  const primary = useEmailAttachments(ref.provider === "primary" ? (emailId ?? undefined) : undefined);
  const linkedOutlook = useQuery({
    queryKey: ["linked-outlook-attachments", ref.accountId, emailId],
    queryFn: async (): Promise<EmailAttachmentMeta[]> => {
      const { data, error } = await supabase.functions.invoke("outlook-account-api", {
        body: { action: "email-attachments", params: { accountId: ref.accountId, emailId } },
      });
      if (error || data?.error) return [];
      return (data?.value ?? []) as EmailAttachmentMeta[];
    },
    enabled: ref.provider === "outlook" && !!emailId,
    staleTime: 5 * 60_000,
  });
  const gmail = useQuery({
    queryKey: ["gmail-attachments", ref.accountId, emailId],
    queryFn: async (): Promise<EmailAttachmentMeta[]> => {
      const { data, error } = await supabase.functions.invoke("google-api", {
        body: { action: "gmail-attachments", params: { accountId: ref.accountId, emailId } },
      });
      if (error || data?.error) return [];
      return (data?.value ?? []) as EmailAttachmentMeta[];
    },
    enabled: ref.provider === "gmail" && !!emailId,
    staleTime: 5 * 60_000,
  });
  if (ref.provider === "outlook") return linkedOutlook;
  if (ref.provider === "gmail") return gmail;
  return primary as unknown as typeof linkedOutlook;
}

function base64ToBlob(b64: string, contentType: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: contentType || "application/octet-stream" });
}

/** Descarga los bytes de un adjunto, ruteando por prefijo de ID. Devuelve un Blob. */
export async function fetchRoutedAttachmentBlob(
  emailId: string,
  att: EmailAttachmentMeta,
): Promise<{ blob: Blob; name: string; contentType: string }> {
  const ref = parseEmailAccountRef(emailId);
  if (ref.provider === "primary") {
    const r = await fetchMessageAttachmentBlob(emailId, att.id);
    return { blob: r.blob, name: att.name || r.name || "adjunto", contentType: r.contentType || att.contentType };
  }
  const fn = ref.provider === "outlook" ? "outlook-account-api" : "google-api";
  const actionName = ref.provider === "outlook" ? "attachment-content" : "gmail-attachment-content";
  const { data, error } = await supabase.functions.invoke(fn, {
    body: { action: actionName, params: { accountId: ref.accountId, emailId, attachmentId: att.id, name: att.name, contentType: att.contentType } },
  });
  if (error || data?.error || !data?.contentBytes) {
    throw new Error(data?.error || "No se pudo descargar el adjunto.");
  }
  const contentType = data.contentType || att.contentType || "application/octet-stream";
  return { blob: base64ToBlob(data.contentBytes, contentType), name: data.name || att.name || "adjunto", contentType };
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
