import type { RequestItem } from "../design/types";
import { REQUESTS } from "./sampleData";

const KEY = "kawiil-os-demo-requests-v1";
const TOAST_KEY = "kawiil-os-demo-toast";

export type DemoRequest = RequestItem & {
  id: string;
  statusLabel: "Solicitada" | "En proceso" | "Emitida" | "Subido" | "En revisión" | "Registrado";
  createdAt: string;
};

function statusFromStep(kind: RequestItem["kind"], step: number): DemoRequest["statusLabel"] {
  if (kind === "recibo") {
    return (["Subido", "En revisión", "Registrado"] as const)[Math.min(step, 2)];
  }
  return (["Solicitada", "En proceso", "Emitida"] as const)[Math.min(step, 2)];
}

function seed(): DemoRequest[] {
  return REQUESTS.map((r, i) => ({
    ...r,
    id: `seed-${i}`,
    statusLabel: statusFromStep(r.kind, r.step),
    createdAt: `2026-09-${28 + i}`,
  }));
}

export function loadDemoRequests(): DemoRequest[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw) as DemoRequest[];
    return Array.isArray(parsed) && parsed.length ? parsed : seed();
  } catch {
    return seed();
  }
}

export function saveDemoRequests(items: DemoRequest[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function addDemoRequest(partial: Omit<DemoRequest, "id" | "createdAt" | "statusLabel"> & { statusLabel?: DemoRequest["statusLabel"] }): DemoRequest {
  const item: DemoRequest = {
    ...partial,
    id: `demo-${Date.now()}`,
    createdAt: new Date().toISOString(),
    statusLabel: partial.statusLabel ?? statusFromStep(partial.kind, partial.step),
  };
  const next = [item, ...loadDemoRequests()];
  saveDemoRequests(next);
  return item;
}

export type DemoToast = { tone: "ok" | "info" | "warn"; text: string };

export function pushDemoToast(toast: DemoToast) {
  window.dispatchEvent(new CustomEvent(TOAST_KEY, { detail: toast }));
}

export function onDemoToast(handler: (t: DemoToast) => void) {
  const fn = (e: Event) => handler((e as CustomEvent<DemoToast>).detail);
  window.addEventListener(TOAST_KEY, fn);
  return () => window.removeEventListener(TOAST_KEY, fn);
}

export function resetDemoRequests() {
  localStorage.removeItem(KEY);
}
