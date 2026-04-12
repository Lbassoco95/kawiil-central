import { supabase } from "@/integrations/supabase/client";
import { urlBase64ToUint8Array } from "@/lib/webPush";

function rawErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.trim();
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m.trim();
  }
  return String(err ?? "").trim();
}

/** Mensaje en español para errores típicos de SW / PushManager (p. ej. permiso denegado). */
export function formatPushRegistrationUserMessage(err: unknown): string {
  const raw = rawErrorMessage(err);
  if (!raw || raw === "[object Object]") return "No se pudo completar el registro de push.";
  const m = raw.toLowerCase();
  if (
    m.includes("permission denied") ||
    m.includes("registration failed") ||
    m.includes("notallowederror") ||
    m.includes("not allowed") ||
    m.includes("user denied") ||
    m.includes("notifications are denied")
  ) {
    return "El navegador bloqueó el registro de avisos con la app cerrada. Concede «Notificaciones» para este sitio (candado en la barra de direcciones), recarga si hace falta, y vuelve a pulsar «Registrar push».";
  }
  if (m.includes("failed to update a serviceworker") || m.includes("serviceworker")) {
    return "No se pudo registrar el trabajador en segundo plano. Prueba en una ventana normal (no modo incógnito), HTTPS, y recargando la página.";
  }
  return raw;
}

/**
 * Registra el service worker, suscribe PushManager y guarda la suscripción vía edge push-subscribe.
 * No actualiza profiles.desktop_push_notifications (hazlo en el caller si aplica).
 * El caller debe asegurar Notification.permission === "granted" antes de llamar (salvo que aquí falle con mensaje claro).
 */
export async function registerWebPushSubscription(): Promise<void> {
  const vapid = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim();
  if (!vapid) {
    throw new Error("VAPID no configurado (VITE_VAPID_PUBLIC_KEY)");
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error(
      "Push solo funciona en HTTPS. Abre Kawiil desde la URL publicada de tu dominio (no desde una vista previa insegura).",
    );
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push no disponible en este navegador");
  }
  if (typeof Notification !== "undefined" && Notification.permission === "denied") {
    throw new Error(
      "Las notificaciones están bloqueadas para este sitio. Ábrelas en la configuración del navegador (candado) y vuelve a intentar.",
    );
  }

  let reg: ServiceWorkerRegistration;
  try {
    reg = await navigator.serviceWorker.register("/sw.js");
  } catch (e) {
    throw new Error(formatPushRegistrationUserMessage(e));
  }

  let sub: PushSubscription;
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid),
    });
  } catch (e) {
    throw new Error(formatPushRegistrationUserMessage(e));
  }

  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) {
    throw new Error("Suscripción inválida");
  }
  const { data, error } = await supabase.functions.invoke("push-subscribe", {
    body: { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } },
  });
  if (error) throw new Error(formatPushRegistrationUserMessage(error));
  const d = data as { error?: string };
  if (d?.error) throw new Error(d.error);
}
