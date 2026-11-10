import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { aprobarPlan, cancelarPlan, mensajesDelHilo, planEnMarcha, planPublico } from "../../supabase/functions/_shared/seguimiento";
import { HiloAgente } from "@/components/agentes/HiloAgente";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

const T = "0b47849a-312c-4ad0-81ce-d173d61f9348";
const PLAN = {
  version: 1, fase: "propuesto", objetivo: "Verificar libros corporativos", alcance: { seleccion: "todos", total: 104, sin_carpeta: 6 },
  criterios: [{ id: "libro_actas", nombre: "Libro de actas", que_verificar: "Actas al día", severidad: "alta" }, { id: "titulos", nombre: "Títulos de acciones", que_verificar: "Emitidos", severidad: "media" }],
  auxiliares: 1, seguimiento_dias: 30, supuestos: ["Dropbox es la fuente"], unidades: [{ id: "c1", nombre: "ACME", tarea_id: "oculto" }], aprobado: null,
  progreso: { hechas: 0, total: 104, con_error: 0, fallas_seguidas: 0 },
};
const tarea = (estado: string, plan: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
  id: T, task_type: "manual", status: estado, created_at: "2026-11-10T10:00:00Z", updated_at: "2026-11-10T10:05:00Z", instructions: "Revisa a todos los clientes",
  result: { analysis: "Te propongo este plan.", ...(plan ? { plan } : {}) }, ...extra,
});

describe("plan público", () => {
  it("lee solo lo necesario: sin ids de unidades ni tareas", () => {
    const p = planPublico({ plan: PLAN })!;
    expect(p).toMatchObject({ fase: "propuesto", total: 104, sin_carpeta: 6, auxiliares: 1, seguimiento_dias: 30, resultado: null });
    expect(p.criterios[0]).toEqual({ nombre: "Libro de actas", que_verificar: "Actas al día", severidad: "alta" });
    expect(JSON.stringify(p)).not.toMatch(/oculto|c1|tarea_id/);
  });
  it("tolera basura: fase desconocida o ausente → null; números inválidos → 0", () => {
    expect(planPublico(null)).toBeNull(); expect(planPublico({ plan: { fase: "hackeada" } })).toBeNull(); expect(planPublico({ plan: "x" })).toBeNull();
    const p = planPublico({ plan: { fase: "ejecutando", alcance: { total: -3 }, progreso: { hechas: "7", total: NaN }, criterios: [null, 5] } })!;
    expect(p.total).toBe(0); expect(p.progreso).toEqual({ hechas: 0, total: 0, con_error: 0 }); expect(p.criterios).toHaveLength(2);
  });
  it("solo aprobado/ejecutando cuentan como «en marcha»", () => {
    for (const [f, v] of [["propuesto", false], ["pausado", false], ["terminado", false], ["cancelado", false], ["aprobado", true], ["ejecutando", true]] as const)
      expect(planEnMarcha(planPublico({ plan: { fase: f } }))).toBe(v);
    expect(planEnMarcha(null)).toBe(false);
  });
});

describe("aprobar y cancelar", () => {
  it("aprobar un plan propuesto lo deja «aprobado» con quién y cuándo, sin tocar el resto", () => {
    const r = aprobarPlan({ analysis: "a", plan: PLAN }, "u1", "2026-11-10T11:00:00Z")!;
    expect((r.plan as Record<string, unknown>).fase).toBe("aprobado");
    expect((r.plan as Record<string, unknown>).aprobado).toEqual({ por: "u1", en: "2026-11-10T11:00:00Z" });
    expect(r.analysis).toBe("a"); expect((r.plan as Record<string, unknown>).unidades).toEqual(PLAN.unidades);
  });
  it("reanudar un plan pausado vuelve a «ejecutando» y reinicia las fallas seguidas", () => {
    const r = aprobarPlan({ plan: { ...PLAN, fase: "pausado", motivo: "5 fallas seguidas", progreso: { hechas: 40, total: 104, con_error: 5, fallas_seguidas: 5 } } }, "u1", "t")!;
    const p = r.plan as Record<string, unknown>;
    expect(p.fase).toBe("ejecutando"); expect(p.progreso).toEqual({ hechas: 40, total: 104, con_error: 5, fallas_seguidas: 0 }); expect("motivo" in p).toBe(false);
  });
  it.each(["aprobado", "ejecutando", "terminado", "cancelado", "reemplazado"])("no se puede aprobar un plan en fase %s", (f) => {
    expect(aprobarPlan({ plan: { ...PLAN, fase: f } }, "u1", "t")).toBeNull();
  });
  it("sin plan no hay nada que aprobar ni cancelar", () => { expect(aprobarPlan({}, "u", "t")).toBeNull(); expect(cancelarPlan({ plan: 3 }, "x")).toBeNull(); });
  it.each(["propuesto", "aprobado", "ejecutando", "pausado"])("se puede cancelar en fase %s", (f) => {
    expect((cancelarPlan({ plan: { ...PLAN, fase: f } }, "Cancelado por Dirección.")!.plan as Record<string, unknown>)).toMatchObject({ fase: "cancelado", motivo: "Cancelado por Dirección." });
  });
  it.each(["terminado", "cancelado", "reemplazado"])("no se cancela lo que ya terminó (%s)", (f) => { expect(cancelarPlan({ plan: { ...PLAN, fase: f } }, "x")).toBeNull(); });
});

describe("el plan en el hilo", () => {
  it("un plan propuesto muestra la explicación del agente y la tarjeta, no «Trabajando…»", () => {
    const m = mensajesDelHilo([tarea("waiting_approval", PLAN)]);
    const a = m.find((x) => x.rol === "agente")!;
    expect(a.texto).toBe("Te propongo este plan."); expect(a.plan?.fase).toBe("propuesto");
  });
  it("un plan reemplazado por otro no aparece", () => {
    const m = mensajesDelHilo([tarea("cancelled", { ...PLAN, fase: "reemplazado" })]);
    expect(m).toHaveLength(0);
  });
  it("encargo terminado: trae el resultado y el entregable sin ruta", () => {
    const m = mensajesDelHilo([tarea("completed", { ...PLAN, fase: "terminado", resultado: { clientes: 104, al_dia: 60, con_pendientes: 30, sin_verificar: 12, con_error: 2 } },
      { result: { analysis: "## Revisión terminada", plan: { ...PLAN, fase: "terminado", resultado: { clientes: 104, al_dia: 60, con_pendientes: 30, sin_verificar: 12, con_error: 2 } }, entregables: [{ nombre: "revision.xlsx", formato: "xlsx", ruta: `${T}/01-revision.xlsx`, bytes: 9000, titulo: "t", creado: "c" }] } })]);
    const a = m.find((x) => x.rol === "agente")!;
    expect(a.plan?.resultado?.con_pendientes).toBe(30); expect(a.entregables[0].nombre).toBe("revision.xlsx"); expect(JSON.stringify(m)).not.toContain(`${T}/`);
  });
});

const envolver = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{ui}</QueryClientProvider>);
const AHORA = new Date("2026-11-10T12:00:00Z");
const hilo = (plan: Record<string, unknown>, estado = "waiting_approval") => ({
  hilo: { id: T, titulo: "Revisión", agent_id: "a1", agente: "Amatl" }, revisiones: [], en_curso: false,
  mensajes: mensajesDelHilo([tarea(estado, plan)]),
});

const DETALLE = { tarea: { estado: "completed" }, eventos: [], actividad: [] };
// Responde como la función: el hilo, el detalle y, para cualquier otra acción, lo que se indique.
const servir = (h: unknown, otras: (body: Record<string, unknown>) => unknown = () => ({ data: { ok: true }, error: null })) =>
  invoke.mockImplementation(async (...args: unknown[]) => {
    const body = ((args[1] as { body?: Record<string, unknown> } | undefined)?.body ?? {}) as Record<string, unknown>;
    return body.action === "hilo" ? { data: h, error: null } : body.action === "detalle" ? { data: DETALLE, error: null } : otras(body);
  });

describe("tarjeta del plan", () => {
  beforeEach(() => invoke.mockReset());
  it("propuesto: muestra alcance y criterios; Aprobar manda aprobar_plan con la tarea; escribirle sigue habilitado", async () => {
    servir(hilo(PLAN));
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    expect(await screen.findByTestId("plan-encargo")).toBeTruthy();
    expect(screen.getByTestId("plan-alcance").textContent).toMatch(/104 clientes \(6 sin carpeta identificada\) · 2 criterios.*30 días/);
    expect(screen.getByText(/Libro de actas/)).toBeTruthy(); expect(screen.getByText("Dropbox es la fuente")).toBeTruthy();
    expect((screen.getByTestId("hilo-texto") as HTMLTextAreaElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("plan-aprobar"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("agente-seguimiento", { body: { action: "aprobar_plan", task_id: T } }));
  });
  it("Cancelar manda cancelar_encargo", async () => {
    servir(hilo(PLAN));
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    fireEvent.click(await screen.findByTestId("plan-cancelar"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("agente-seguimiento", { body: { action: "cancelar_encargo", task_id: T } }));
  });
  it("ejecutando: muestra «N de M clientes» y no ofrece aprobar", async () => {
    servir(hilo({ ...PLAN, fase: "ejecutando", progreso: { hechas: 26, total: 104, con_error: 1, fallas_seguidas: 0 } }, "in_progress"));
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    expect((await screen.findByTestId("plan-progreso")).textContent).toContain("26 de 104 clientes · 1 con error");
    expect(screen.queryByTestId("plan-aprobar")).toBeNull(); expect(screen.getByTestId("plan-cancelar")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25");
  });
  it("pausado: dice el motivo y ofrece Reanudar", async () => {
    servir(hilo({ ...PLAN, fase: "pausado", motivo: "Se pausó tras 5 fallas seguidas." }));
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    expect((await screen.findByTestId("plan-motivo")).textContent).toContain("5 fallas");
    expect(screen.getByTestId("plan-aprobar").textContent).toContain("Reanudar");
  });
  it("terminado: resumen del resultado y sin botones", async () => {
    servir(hilo({ ...PLAN, fase: "terminado", resultado: { clientes: 104, al_dia: 60, con_pendientes: 30, sin_verificar: 12, con_error: 2 } }, "completed"));
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    expect((await screen.findByTestId("plan-resultado")).textContent).toContain("60 al día · 30 con pendientes · 12 sin poder verificar · 2 con error");
    expect(screen.queryByTestId("plan-aprobar")).toBeNull(); expect(screen.queryByTestId("plan-cancelar")).toBeNull();
  });
  it("si la aprobación falla, lo dice", async () => {
    servir(hilo(PLAN), () => ({ data: null, error: { context: { json: async () => ({ error: "Ese plan cambió mientras lo revisabas." }) } } }));
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    fireEvent.click(await screen.findByTestId("plan-aprobar"));
    expect((await screen.findByRole("alert")).textContent).toContain("cambió mientras lo revisabas");
  });
});
