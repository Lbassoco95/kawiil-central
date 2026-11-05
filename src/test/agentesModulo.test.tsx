import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentesRegistro } from "@/components/marketing/AgentesRegistro";
import { agentesDelModulo, type AgenteRegistro, type TareaAgente } from "@/lib/agentes/registro";
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
});
