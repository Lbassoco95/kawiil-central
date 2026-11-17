/**
 * Lógica pura del aviso «instala Kawiil / activa los avisos» (PWA en iPhone y Android).
 * Sin efectos: recibe el estado del dispositivo y decide qué mostrar.
 */

export type PushBannerMode = "install-ios" | "enable" | null;

export type PushBannerInput = {
  ios: boolean;
  standalone: boolean;
  pushSupported: boolean;
  permission: NotificationPermission | "unsupported";
  hasSubscription: boolean;
  toggleOn: boolean;
};

/** iPhone/iPad. iPadOS 13+ se presenta como Mac, por eso se mira también el multitáctil. */
export function isIosDevice(ua: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && maxTouchPoints > 1;
}

/** ¿Qué debe mostrar el aviso? `null` = nada. */
export function pushBannerMode(i: PushBannerInput): PushBannerMode {
  // En iOS el push solo existe si la app está instalada en la pantalla de inicio (iOS 16.4+).
  if (i.ios && !i.standalone) return "install-ios";
  if (!i.pushSupported) return null;
  if (i.permission === "denied" || i.permission === "unsupported") return null;
  if (i.permission === "granted" && i.hasSubscription && i.toggleOn) return null;
  return "enable";
}

export const PUSH_BANNER_DISMISS_KEY = "kawiil-push-banner-dismissed-at";
export const PUSH_BANNER_DISMISS_DAYS = 7;

/** ¿Sigue vigente el «ahora no»? */
export function dismissStillActive(dismissedAtMs: number | null, nowMs: number, days = PUSH_BANNER_DISMISS_DAYS): boolean {
  if (dismissedAtMs == null || Number.isNaN(dismissedAtMs)) return false;
  return nowMs - dismissedAtMs < days * 86_400_000;
}
