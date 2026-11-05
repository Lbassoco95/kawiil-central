import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentesRegistro } from "@/components/marketing/AgentesRegistro";
import { agentesDelModulo, categoriaError, saludLegal, ultimoErrorPorAgente, type AgenteRegistro, type TareaAgente } from "@/lib/agentes/registro";
import * as viejo from "@/components/marketing/agentesRegistro";
import * as nuevo from "@/lib/agentes/registro";

const AHORA = new Date("2026-11-05T16:00:00Z");
const ag = (o: Partial<AgenteRegistro> & { id: string; name: string }): AgenteRegistro => ({
  display_name: null, description: null, role: null, status: "idle", kind: "consultable", last_heartbeat: null, last_task_at: null, tasks_completed: 0, tasks_failed: 0, ...o,
});
const AGENTES = [
  ag({ id: "a1", name: "nelli", last_heartbeat: "2026-04-30T15:07:21Z" }),
  ag({ id: "m1", name: "marketing_vigilante", kind: "system", last_heartbeat: "2026-11-05T12:00:00Z" }),
];
const TAREAS: TareaAgente[] = [
  { id: "t1", agent_id: "a1", task_type: "manual", status: "error", created_at: "2026-11-04T10:00:00Z", started_at: null, completed_at: null },
  { id: "t2", agent_id: "m1", task_type: "manual", status: "completed", created_at: "2026-11-04T10:00:00Z", started_at: null, completed_at: null },
];

describe("módulo Agentes", () => {
  it("excluye a los agentes de Marketing", () => {
    expect(agentesDelModulo(AGENTES).map((a) => a.name)).toEqual(["nelli"]);
  });
  it("la ruta vieja de Marketing sigue exportando lo mismo", () => {
    expect(viejo.senalAgente).toBe(nuevo.senalAgente);
    expect(viejo.tareasRecientes).toBe(nuevo.tareasRecientes);
  });
  it("sinMarketing no muestra agentes ni tareas de Marketing", () => {
    render(<AgentesRegistro sinMarketing agentes={AGENTES} tareas={TAREAS} estadoAgentes="ok" estadoTareas="ok" ahora={AHORA} />);
    expect(screen.getByTestId("registro-nelli")).toBeTruthy();
    expect(screen.queryByTestId("registro-marketing_vigilante")).toBeNull();
    expect(screen.getByTestId("tarea-t1")).toBeTruthy();
    expect(screen.queryByTestId("tarea-t2")).toBeNull();
  });

  const LEGALES = [
    ag({ id: "l1", name: "legal_dof_watchdog", display_name: "Vigía DOF", status: "working", last_heartbeat: "2026-05-29T19:25:38Z" }),
    ag({ id: "l2", name: "legal_archivist", display_name: "Archivero", last_heartbeat: "2026-06-07T14:02:54Z" }),
    ag({ id: "l3", name: "legal_socratic_jurist", display_name: "Sócrates" }),
  ];
  it("saludLegal avisa cuando los agentes legales no tienen vida", () => {
    const s = saludLegal([...AGENTES, ...LEGALES], AHORA);
    expect(s.estado).toBe("alerta");
    expect(s.sinVida).toBe(3);
    expect(s.sinVidaNombres.find((x) => x.nombre === "Vigía DOF")?.senal).toBe("atascado");
  });
  it("saludLegal está ok con latido reciente y no cuenta archivados", () => {
    const vivo = ag({ id: "l9", name: "legal_x", last_heartbeat: "2026-11-05T15:30:00Z" });
    const arch = ag({ id: "l8", name: "legal_y", status: "archived" });
    expect(saludLegal([vivo, arch], AHORA).estado).toBe("ok");
    expect(saludLegal(AGENTES, AHORA).estado).toBe("sin_agentes");
  });
  it("clasifica los errores sin mostrar el texto crudo", () => {
    expect(categoriaError("timed out")).toBe("tiempo_agotado");
    expect(categoriaError("[Errno 35] Resource temporarily unavailable")).toBe("recurso_no_disponible");
    expect(categoriaError("algo raro con el expediente 123")).toBe("otro");
    const u = ultimoErrorPorAgente([
      { agent_id: "l2", created_at: "2026-06-07T14:00:00Z", error_message: "timed out" },
      { agent_id: "l2", created_at: "2026-06-01T14:00:00Z", error_message: "timed out" },
    ]).get("l2");
    expect(u).toMatchObject({ categoria: "tiempo_agotado", repeticiones: 2 });
  });
  it("muestra la alerta legal y el último error en el módulo", () => {
    render(<AgentesRegistro sinMarketing agentes={LEGALES} tareas={[]} estadoAgentes="ok" estadoTareas="ok" ahora={AHORA}
      errores={[{ agent_id: "l2", created_at: "2026-06-07T14:00:00Z", error_message: "timed out" }]} />);
    expect(screen.getByTestId("alerta-legal").textContent).toContain("3 de 3 agentes legales sin vida");
    expect(screen.getByTestId("ultimo-error-legal_archivist").textContent).toContain("Tiempo agotado");
  });
});

describe("respuestas lentas", () => {
  const ahora = new Date("2026-11-05T18:00:00Z");
  const t = (id: string, agent_id: string, status: string, durSeg: number, fin = "2026-06-01T12:00:00Z"): TareaAgente => ({
    id, agent_id, task_type: "manual", status, created_at: fin,
    started_at: new Date(new Date(fin).getTime() - durSeg * 1000).toISOString(), completed_at: fin,
  });
  const A = [ag({ id: "arch", name: "legal_archivist", display_name: "Archivero" }), ag({ id: "rap", name: "coyolli" }), ag({ id: "arc", name: "x", status: "archived" })];
  it("marca lento al Archivero (timeouts de ~10 min) y no al rápido", async () => {
    const { agentesLentos } = await import("@/lib/agentes/registro");
    const tareas = [t("1", "arch", "error", 603), t("2", "arch", "error", 606), t("3", "arch", "completed", 577), t("4", "rap", "completed", 13), t("5", "rap", "completed", 31)];
    const l = agentesLentos(A, tareas);
    expect(l.map((x) => x.nombre)).toEqual(["Archivero"]);
    expect(l[0].nivel).toBe("muy_lento");
  });
  it("lento (5–10 min) vs muy lento, y ignora con una sola tarea, archivados y tareas sin fechas", async () => {
    const { agentesLentos } = await import("@/lib/agentes/registro");
    expect(agentesLentos(A, [t("1", "arch", "completed", 400), t("2", "arch", "completed", 420)])[0].nivel).toBe("lento");
    expect(agentesLentos(A, [t("1", "arch", "error", 700)])).toEqual([]);
    expect(agentesLentos(A, [t("1", "arc", "completed", 900), t("2", "arc", "completed", 900)])).toEqual([]);
    expect(agentesLentos(A, [{ ...t("1", "arch", "error", 700), started_at: null }, { ...t("2", "arch", "error", 700), completed_at: null }])).toEqual([]);
  });
  it("usa solo las últimas 5 tareas: si ya se arregló, deja de avisar", async () => {
    const { agentesLentos } = await import("@/lib/agentes/registro");
    const viejas = [1, 2, 3].map((i) => t(`v${i}`, "arch", "error", 600, `2026-06-0${i}T12:00:00Z`));
    const nuevas = [1, 2, 3, 4, 5].map((i) => t(`n${i}`, "arch", "completed", 8, `2026-11-0${i}T12:00:00Z`));
    expect(agentesLentos(A, [...viejas, ...nuevas])).toEqual([]);
  });
  it("el aviso aparece en la pantalla sin mostrar textos de tareas", () => {
    render(<AgentesRegistro sinMarketing agentes={A} tareas={[t("1", "arch", "error", 603), t("2", "arch", "error", 606)]} estadoAgentes="ok" estadoTareas="ok" ahora={ahora} />);
    const a = screen.getByTestId("alerta-lentitud");
    expect(a.textContent).toContain("Archivero");
    expect(a.textContent).toContain("10 min");
  });
  it("sin lentitud no hay aviso", () => {
    render(<AgentesRegistro sinMarketing agentes={A} tareas={[t("1", "rap", "completed", 10), t("2", "rap", "completed", 20)]} estadoAgentes="ok" estadoTareas="ok" ahora={ahora} />);
    expect(screen.queryByTestId("alerta-lentitud")).toBeNull();
  });
});
