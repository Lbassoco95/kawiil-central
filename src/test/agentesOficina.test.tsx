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
