import { describe, it, expect, vi } from "vitest";
// El núcleo del servicio notify vive junto a las Edge Functions (Deno-free) para
// poder reutilizarse desde el servidor y a la vez testearse aquí con vitest.
import {
  validateNotificationRequest,
  renderTemplate,
  markdownBoldToSlackMrkdwn,
  sendNotification,
  isSupportedChannel,
  type NotifyDeps,
  type NotificationRequest,
} from "../../supabase/functions/_shared/notify";

// ── Fakes ─────────────────────────────────────────────────────────────────────
interface RecordedInsert {
  table: string;
  rows: unknown;
}

function makeAdmin() {
  const inserts: RecordedInsert[] = [];
  const admin = {
    inserts,
    from(table: string) {
      return {
        insert: async (rows: unknown) => {
          inserts.push({ table, rows });
          return { error: null };
        },
      };
    },
  };
  return admin;
}

function jsonResponse(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response;
}

const baseConfig = {
  slackBotToken: "xoxb-test",
  slackDefaultChannel: "#finanzas",
  graph: { tenant: "t", clientId: "c", clientSecret: "s", sender: "comercial@kawiil.mx" },
  whatsapp: {},
};

function deps(over: Partial<NotifyDeps> = {}): NotifyDeps {
  return {
    admin: makeAdmin(),
    config: baseConfig,
    fetchImpl: vi.fn(),
    now: () => "2026-07-23T00:00:00.000Z",
    ...over,
  };
}

// ── Utilidades puras ────────────────────────────────────────────────────────
describe("notify · utilidades puras", () => {
  it("reconoce canales soportados", () => {
    expect(isSupportedChannel("slack")).toBe(true);
    expect(isSupportedChannel("email")).toBe(true);
    expect(isSupportedChannel("whatsapp")).toBe(true);
    expect(isSupportedChannel("in_app")).toBe(true);
    expect(isSupportedChannel("telegram")).toBe(false);
    expect(isSupportedChannel(undefined)).toBe(false);
  });

  it("convierte **negritas** markdown a mrkdwn de Slack", () => {
    expect(markdownBoldToSlackMrkdwn("Pago **vencido** hoy")).toBe("Pago *vencido* hoy");
  });

  it("renderiza la plantilla raw usando datos directos", () => {
    const m = renderTemplate("raw", { subject: "Hola", text: "Cuerpo libre" });
    expect(m.subject).toBe("Hola");
    expect(m.text).toBe("Cuerpo libre");
    expect(m.html).toContain("Cuerpo libre");
  });

  it("renderiza la plantilla de cobranza con monto formateado", () => {
    const m = renderTemplate("cobranza_recordatorio", {
      cliente: "Sylon",
      folio: "F-101",
      monto: 12345.6,
      moneda: "MXN",
      vencimiento: "2026-07-30",
    });
    expect(m.subject).toContain("F-101");
    expect(m.text).toContain("Sylon");
    expect(m.text).toContain("$12,345.60 MXN");
    expect(m.text).toContain("2026-07-30");
  });

  it("lanza al renderizar una plantilla desconocida", () => {
    expect(() => renderTemplate("no_existe")).toThrow();
  });
});

// ── Router de canal / validación ──────────────────────────────────────────────
describe("notify · validación (router de canal)", () => {
  it("acepta una solicitud slack válida", () => {
    const r = validateNotificationRequest({ canal: "slack", plantilla: "generico", destino: "#x" });
    expect(r.ok).toBe(true);
  });

  it("permite slack sin destino (usa canal por defecto)", () => {
    const r = validateNotificationRequest({ canal: "slack", plantilla: "generico" });
    expect(r.ok).toBe(true);
  });

  it("exige destino para email", () => {
    const r = validateNotificationRequest({ canal: "email", plantilla: "generico" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/destino/i);
  });

  it("rechaza canal no soportado", () => {
    const r = validateNotificationRequest({ canal: "telegram" as never, plantilla: "generico", destino: "x" });
    expect(r.ok).toBe(false);
  });

  it("rechaza plantilla desconocida", () => {
    const r = validateNotificationRequest({ canal: "slack", plantilla: "xyz", destino: "#x" });
    expect(r.ok).toBe(false);
  });
});

// ── Envío por canal ─────────────────────────────────────────────────────────
describe("notify · sendNotification", () => {
  it("envía por Slack y registra en notification_log", async () => {
    const admin = makeAdmin();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const d = deps({ admin, fetchImpl });
    const req: NotificationRequest = {
      canal: "slack",
      destino: "#finanzas",
      plantilla: "alerta_liquidez",
      datos: { titulo: "Saldo bajo", detalle: "Revisar", monto: 1000 },
      organization_id: "org-1",
    };
    const res = await sendNotification(d, req);
    expect(res.ok).toBe(true);
    expect(res.estado).toBe("enviado");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toContain("chat.postMessage");
    const log = admin.inserts.find((i) => i.table === "notification_log");
    expect(log).toBeTruthy();
    expect((log!.rows as { estado: string }[])[0].estado).toBe("enviado");
  });

  it("omite Slack sin token sin llamar a la red", async () => {
    const fetchImpl = vi.fn();
    const d = deps({ fetchImpl, config: { ...baseConfig, slackBotToken: undefined } });
    const res = await sendNotification(d, {
      canal: "slack",
      destino: "#x",
      plantilla: "generico",
      datos: { titulo: "Hola" },
    });
    expect(res.estado).toBe("omitido");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("deja WhatsApp como stub (omitido) cuando no hay credenciales", async () => {
    const fetchImpl = vi.fn();
    const d = deps({ fetchImpl });
    const res = await sendNotification(d, {
      canal: "whatsapp",
      destino: "5215555555555",
      plantilla: "generico",
      datos: { titulo: "Hola" },
    });
    expect(res.estado).toBe("omitido");
    expect(res.error).toMatch(/whatsapp/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("inserta notificación in-app en la tabla notifications", async () => {
    const admin = makeAdmin();
    const d = deps({ admin });
    const res = await sendNotification(d, {
      canal: "in_app",
      destino: "11111111-1111-1111-1111-111111111111",
      plantilla: "generico",
      datos: { titulo: "Nueva tarea" },
      organization_id: "org-1",
      source_user_id: "user-2",
    });
    expect(res.ok).toBe(true);
    const notif = admin.inserts.find((i) => i.table === "notifications");
    expect(notif).toBeTruthy();
    expect((notif!.rows as { title: string }[])[0].title).toBe("Nueva tarea");
  });

  it("marca error (sin llamar red) ante una solicitud inválida y lo registra", async () => {
    const admin = makeAdmin();
    const fetchImpl = vi.fn();
    const d = deps({ admin, fetchImpl });
    const res = await sendNotification(d, {
      canal: "telegram" as never,
      destino: "x",
      plantilla: "generico",
    });
    expect(res.ok).toBe(false);
    expect(res.estado).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
    const log = admin.inserts.find((i) => i.table === "notification_log");
    expect((log!.rows as { estado: string }[])[0].estado).toBe("error");
  });
});
