import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Oficina } from "@/components/agentes/Oficina";
import { datosDemo, estadoOficina, figurasOficina } from "@/lib/agentes/oficina";
import type { AgenteRegistro, TareaAgente } from "@/lib/agentes/registro";

const AHORA = new Date("2026-11-05T16:00:00Z");
const iso = (ms: number) => new Date(AHORA.getTime() - ms).toISOString();
const MIN = 60_000, H = 3_600_000, D = 24 * H;
const ag = (o: Partial<AgenteRegistro> & { id: string }): AgenteRegistro => ({
  name: o.id, display_name: null, description: null, role: null, status: "idle", kind: "consultable", last_heartbeat: iso(5 * MIN), last_task_at: null, tasks_completed: 0, tasks_failed: 0, ...o,
});
const t = (id: string, agent_id: string, status: string, completed: number | null = null): TareaAgente =>
  ({ id, agent_id, task_type: "manual", status, created_at: iso(30 * MIN), started_at: iso(29 * MIN), completed_at: completed === null ? null : iso(completed) });

describe("estadoOficina", () => {
  it("sentado: señal reciente y sin tareas", () => expect(estadoOficina(ag({ id: "a" }), [], AHORA)).toBe("sentado"));
  it("trabajando: tarea en curso con señal", () => expect(estadoOficina(ag({ id: "a", status: "working" }), [t("1", "a", "in_progress")], AHORA)).toBe("trabajando"));
  it("tarea «en curso» de hace meses sin señal NO es trabajando", () =>
    expect(estadoOficina(ag({ id: "a", last_heartbeat: iso(150 * D) }), [t("1", "a", "in_progress")], AHORA)).toBe("apagado"));
  it("celebrando: terminó hace 4 min", () => expect(estadoOficina(ag({ id: "a" }), [t("1", "a", "completed", 4 * MIN)], AHORA)).toBe("celebrando"));
  it("terminó hace 2 h: ya no celebra", () => expect(estadoOficina(ag({ id: "a" }), [t("1", "a", "completed", 2 * H)], AHORA)).toBe("sentado"));
  it("con_error: última tarea falló hace 2 h", () => expect(estadoOficina(ag({ id: "a" }), [t("1", "a", "error", 2 * H)], AHORA)).toBe("con_error"));
  it("error de hace meses no marca error", () => expect(estadoOficina(ag({ id: "a", last_heartbeat: iso(150 * D) }), [{ ...t("1", "a", "error", 150 * D), created_at: iso(150 * D) }], AHORA)).toBe("apagado"));
  it("atascado: working sin latido > 1 h", () => expect(estadoOficina(ag({ id: "a", status: "working", last_heartbeat: iso(5 * H) }), [], AHORA)).toBe("atascado"));
  it("descansando: latido de hace 3 días", () => expect(estadoOficina(ag({ id: "a", last_heartbeat: iso(3 * D) }), [], AHORA)).toBe("descansando"));
  it("apagado: sin latido", () => expect(estadoOficina(ag({ id: "a", last_heartbeat: null }), [], AHORA)).toBe("apagado"));
  it("figuras omiten archivados", () => expect(figurasOficina([ag({ id: "a" }), ag({ id: "b", status: "archived" })], [], AHORA).map((f) => f.id)).toEqual(["a"]));
});

describe("demostración", () => {
  it("cubre los siete estados", () => {
    const { agentes, tareas } = datosDemo(AHORA);
    expect(new Set(figurasOficina(agentes, tareas, AHORA).map((f) => f.estado)).size).toBe(7);
  });
});

describe("<Oficina />", () => {
  const { agentes, tareas } = datosDemo(AHORA);
  const figuras = figurasOficina(agentes, tareas, AHORA);
  it("avisa que son datos de ejemplo y no en modo real", () => {
    const { unmount } = render(<Oficina figuras={figuras} ahora={AHORA} demo />);
    expect(screen.getByTestId("oficina-demo")).toBeTruthy();
    unmount();
    render(<Oficina figuras={figuras} ahora={AHORA} demo={false} />);
    expect(screen.queryByTestId("oficina-demo")).toBeNull();
  });
  it("elegir un agente muestra su estado con texto", () => {
    render(<Oficina figuras={figuras} ahora={AHORA} demo />);
    const f = figuras.find((x) => x.estado === "atascado")!;
    fireEvent.click(screen.getByTestId(`oficina-${f.id}`));
    expect(screen.getByTestId("oficina-detalle").textContent).toContain("Atascado");
  });
  it("sin agentes muestra un mensaje", () => {
    render(<Oficina figuras={[]} ahora={AHORA} demo={false} />);
    expect(screen.getByText(/No hay agentes/)).toBeTruthy();
  });
});

describe("ámbito de la oficina y agentes legales reales (5 nov 2026)", () => {
  const A5 = new Date("2026-11-05T18:00:00Z");
  const real = (id: string, name: string, display: string, status: string, hb: string | null, ok: number, mal: number): AgenteRegistro =>
    ({ id, name, display_name: display, description: null, role: null, status, kind: "consultable", last_heartbeat: hb, last_task_at: null, tasks_completed: ok, tasks_failed: mal });
  const LEGALES = [
    real("l1", "legal_archivist", "Archivero", "idle", "2026-06-07T14:02:54Z", 1, 15),
    real("l2", "legal_contradiction_detector", "Antinomia", "idle", null, 0, 0),
    real("l3", "legal_cross_referencer", "Vínculo", "idle", null, 0, 0),
    real("l4", "legal_dof_watchdog", "Vigía DOF", "working", "2026-05-29T19:25:38Z", 0, 2),
    real("l5", "legal_litigation_strategist", "Estratega", "idle", null, 0, 0),
    real("l6", "legal_socratic_jurist", "Sócrates", "idle", null, 0, 0),
  ];
  const OTRO = real("x1", "nelli", "Nelli", "idle", "2026-04-30T15:07:21Z", 9, 2);
  it("filtra legales vs todos", async () => {
    const { filtrarAmbito } = await import("@/lib/agentes/oficina");
    expect(filtrarAmbito([...LEGALES, OTRO], "legales")).toHaveLength(6);
    expect(filtrarAmbito([...LEGALES, OTRO], "todos")).toHaveLength(7);
  });
  it("con los datos reales: Vigía DOF atascado y los otros cinco sin señal", () => {
    const f = Object.fromEntries(figurasOficina(LEGALES, [], A5).map((x) => [x.nombre, x.estado]));
    expect(f["Vigía DOF"]).toBe("atascado");
    expect(["Archivero", "Antinomia", "Vínculo", "Estratega", "Sócrates"].map((n) => f[n])).toEqual(Array(5).fill("apagado"));
  });
});
