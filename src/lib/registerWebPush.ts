import { supabase } from "@/integrations/supabase/client";
import { urlBase64ToUint8Array } from "@/lib/webPush";

/**
 * Registra el service worker, suscribe PushManager y guarda la suscripción vía edge push-subscribe.
 * No actualiza profiles.desktop_push_notifications (hazlo en el caller si aplica).
 */
export async function registerWebPushSubscription(): Promise<void> {
  const vapid = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim();
  if (!vapid) {
    throw new Error("VAPID no configurado (VITE_VAPID_PUBLIC_KEY)");
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push no disponible en este navegador");
  }
  const reg = await navigator.serviceWorker.register("/sw.js");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid),
  });
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) {
    throw new Error("Suscripción inválida");
  }
  const { data, error } = await supabase.functions.invoke("push-subscribe", {
    body: { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } },
  });
  if (error) throw error;
  const d = data as { error?: string };
  if (d?.error) throw new Error(d.error);
}
