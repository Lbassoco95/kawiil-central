import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import { formatPushRegistrationUserMessage, waitForActiveServiceWorker } from "./registerWebPush";

const reg = (active: unknown) => ({ active }) as unknown as ServiceWorkerRegistration;

describe("waitForActiveServiceWorker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("si el trabajador ya está activo, devuelve el mismo registro sin esperar", async () => {
    const activo = reg({});
    const ready = new Promise<ServiceWorkerRegistration>(() => {});
    await expect(waitForActiveServiceWorker(activo, 1000, { ready })).resolves.toBe(activo);
  });

  it("si aún se está instalando, espera a `ready` y usa ese registro (caso de la primera activación)", async () => {
    const instalando = reg(null);
    const listo = reg({});
    const resultado = waitForActiveServiceWorker(instalando, 10_000, { ready: Promise.resolve(listo) });
    await expect(resultado).resolves.toBe(listo);
  });

  it("si nunca se activa, falla con un mensaje claro en vez de colgarse", async () => {
    const ready = new Promise<ServiceWorkerRegistration>(() => {});
    const resultado = waitForActiveServiceWorker(reg(null), 5000, { ready });
    const verificado = expect(resultado).rejects.toThrow("tiempo de espera");
    await vi.advanceTimersByTimeAsync(5001);
    await verificado;
  });
});

describe("formatPushRegistrationUserMessage", () => {
  it("traduce el error de Safari «requires an active service worker»", () => {
    const msg = formatPushRegistrationUserMessage(new Error("Subscribing for push requires an active service worker"));
    expect(msg).toContain("trabajador en segundo plano");
  });

  it("traduce el tiempo de espera agotado del trabajador", () => {
    const msg = formatPushRegistrationUserMessage(new Error("service worker: tiempo de espera agotado"));
    expect(msg).toContain("trabajador en segundo plano");
  });

  it("sigue explicando el permiso denegado", () => {
    expect(formatPushRegistrationUserMessage(new Error("Permission denied"))).toContain("Notificaciones");
  });
});
