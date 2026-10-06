/**
 * Cloudflare Turnstile para las pantallas públicas (C3).
 *
 * El token dura ~5 minutos y sirve UNA vez. Para que quien deja la pantalla
 * abierta no quede bloqueado (defecto visto en MATI):
 *   · `refresh-expired: "auto"`: Turnstile renueva solo el reto al vencer;
 *   · `expired-callback`: borramos el token vencido y reiniciamos el widget;
 *   · `reset()` expuesto: el formulario lo llama después de cada envío.
 * Sin VITE_TURNSTILE_SITE_KEY el formulario queda CERRADO (falla cerrado).
 * Llaves de prueba de Cloudflare: ver docs/portal/RUNBOOK.md §2.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Notice } from "./ui";

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id?: string): void;
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { scriptPromise = null; reject(new Error("turnstile")); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface TurnstileHandle { reset(): void }

export function turnstileSiteKey(): string {
  return String(import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "").trim();
}

const Turnstile = forwardRef<TurnstileHandle, { onToken: (token: string | null) => void; siteKey?: string }>(
  function Turnstile({ onToken, siteKey = turnstileSiteKey() }, ref) {
    const el = useRef<HTMLDivElement>(null);
    const id = useRef<string | null>(null);
    const cb = useRef(onToken);
    cb.current = onToken;

    useImperativeHandle(ref, () => ({
      reset() {
        cb.current(null);
        if (window.turnstile && id.current) window.turnstile.reset(id.current);
      },
    }));

    useEffect(() => {
      if (!siteKey || !el.current) return;
      let cancelled = false;
      loadScript().then(() => {
        if (cancelled || !el.current || !window.turnstile) return;
        id.current = window.turnstile.render(el.current, {
          sitekey: siteKey,
          language: "es-MX",
          theme: "light",
          "refresh-expired": "auto",
          "refresh-timeout": "auto",
          callback: (t: string) => cb.current(t),
          "expired-callback": () => {
            cb.current(null);
            if (window.turnstile && id.current) window.turnstile.reset(id.current);
          },
          "timeout-callback": () => cb.current(null),
          "error-callback": () => cb.current(null),
        });
      }).catch(() => cb.current(null));
      return () => {
        cancelled = true;
        if (window.turnstile && id.current) window.turnstile.remove(id.current);
        id.current = null;
      };
    }, [siteKey]);

    if (!siteKey) {
      return <Notice tone="warn" title="Cerrado temporalmente">El registro y la recuperación de cuentas no están disponibles en este momento. Intente más tarde o escriba a Kawiil.</Notice>;
    }
    return <div ref={el} className="min-h-[65px]" aria-label="Verificación de que no es un robot" />;
  },
);
export default Turnstile;
