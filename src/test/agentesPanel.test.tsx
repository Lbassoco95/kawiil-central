import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import type { PestanaEscritorio } from "@/lib/agentes/vistas";

vi.mock("@/components/agentes/TrabajosAgente", () => ({ TrabajosAgente: ({ agentId }: { agentId: string }) => <div data-testid="stub-trabajos">{agentId}</div> }));
vi.mock("@/components/agentes/MemoriaAgentes", () => ({ MemoriaAgentes: ({ agenteInicial, fijo }: { agenteInicial?: string; fijo?: boolean }) => <div data-testid="stub-memoria" data-fijo={String(fijo)}>{agenteInicial}</div> }));
vi.mock("@/components/agentes/EnsenarAgente", () => ({ ensenable: (a: { kind: string | null; config?: { origen?: string } | null }) => a.config?.origen === "constructor_agentes", EnsenarAgente: () => <div data-testid="stub-ensenar" /> }));
vi.mock("@/components/agentes/ProgramarAgente", () => ({ programable: () => false, ProgramarAgente: () => <div data-testid="stub-programar" /> }));
vi.mock("@/components/agentes/DocumentosAgente", () => ({ documentable: (a: { kind: string | null }) => a.kind !== "system", DocumentosAgente: ({ fijo }: { fijo?: boolean }) => <div data-testid="stub-documentos" data-fijo={String(fijo)} /> }));
vi.mock("@/components/agentes/ComunicacionInterna", () => ({ ComunicacionInterna: () => <div data-testid="stub-comunicacion" /> }));
vi.mock("@/components/agentes/CalendarioRutinas", () => ({ CalendarioRutinas: ({ agentes }: { agentes: unknown[] }) => <div data-testid="stub-rutinas">{agentes.length}</div> }));

import { PanelAgente } from "@/components/agentes/PanelAgente";
import { actividadDe, agentesQueEsperan, colaboracionDe, esperasDe, progresoNivel } from "@/lib/agentes/actividad";
import { figurasOficina } from "@/lib/agentes/oficina";
import type { AgenteRegistro, TareaAgente } from "@/lib/agentes/registro";

const AHORA = new Date("2026-11-15T12:00:00Z");
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const ag = (id: string, name: string, o: Partial<AgenteRegistro> = {}): AgenteRegistro => ({ id, name, display_name: name, description: null, role: null, status: "idle", kind: "consultable", last_heartbeat: hace(1), last_task_at: null, tasks_completed: 0, tasks_failed: 0, ...o });
const ta = (id: string, agent_id: string, status: string, o: Partial<TareaAgente> = {}): TareaAgente => ({ id, agent_id, task_type: "consulta_legal", status, created_at: hace(30), started_at: hace(20), completed_at: null, ...o });
const AGENTES = [ag("a1", "amatl", { tasks_completed: 12 }), ag("a2", "atl"), ag("a3", "marketing_cmo", { kind: "system" }), ag("a4", "marketing_comunicacion_interna", { kind: "system" }), ag("a5", "nuevo_sin_perfil", { config: { origen: "constructor_agentes" } })];
const TAREAS = [ta("t1", "a1", "in_progress"), ta("t2", "a2", "completed", { source_task_id: "t1", completed_at: hace(5) }), ta("t3", "a1", "waiting_approval")];
const figs = figurasOficina(AGENTES, TAREAS, AHORA);

function Montar({ id, inicial = "conversaciones" as PestanaEscritorio }) {
  const [p, setP] = useState<PestanaEscritorio>(inicial);
  return <MemoryRouter><PanelAgente figura={figs.find((f) => f.id === id)!} agente={AGENTES.find((a) => a.id === id)!} agentes={AGENTES} tareas={TAREAS} ahora={AHORA} pestana={p} onPestana={setP} /></MemoryRouter>;
}

describe("lógica de actividad", () => {
  it("«Trabajando» lleva el tipo de la tarea en curso; los demás estados, su etiqueta", () => {
    expect(actividadDe("a1", "trabajando", TAREAS)).toBe("Trabajando · consulta legal");
    expect(actividadDe("a1", "trabajando", [])).toBe("Trabajando");
    expect(actividadDe("a2", "sentado", TAREAS)).toBe("Disponible");
  });
  it("cuenta lo que te espera y quién le pasó trabajo a quién", () => {
    expect(esperasDe("a1", TAREAS)).toBe(1);
    expect([...agentesQueEsperan(TAREAS)]).toEqual(["a1"]);
    expect(colaboracionDe("a2", TAREAS, AHORA).recibioDe).toEqual([{ id: "a1", veces: 1 }]);
    expect(colaboracionDe("a1", TAREAS, AHORA).pasoA).toEqual([{ id: "a2", veces: 1 }]);
  });
  it("el progreso al siguiente nivel sigue los umbrales 10 y 25", () => {
    expect(progresoNivel(3)).toEqual({ hechas: 3, siguiente: 10, faltan: 7 });
    expect(progresoNivel(10)).toEqual({ hechas: 10, siguiente: 25, faltan: 15 });
    expect(progresoNivel(25)).toEqual({ hechas: 25, siguiente: null, faltan: null });
    expect(progresoNivel(null).hechas).toBe(0);
  });
});

describe("PanelAgente", () => {
  it("muestra nombre, actividad, nivel, «te espera» y la colaboración", () => {
    render(<Montar id="a1" />);
    expect(screen.getByTestId("panel-nombre").textContent).toBe("amatl");
    expect(screen.getByTestId("panel-actividad").textContent).toBe("Trabajando · consulta legal");
    expect(screen.getByTestId("panel-espera").textContent).toContain("Te espera: 1 tarea");
    expect(screen.getByTestId("panel-paso").textContent).toContain("atl (1×)");
    expect(screen.queryByTestId("panel-recibio")).toBeNull();
    expect(screen.getByText(/Oficial/)).toBeTruthy();
  });
  it("tiene las cinco pestañas y cada una abre lo suyo, siempre fijado a este agente", () => {
    render(<Montar id="a1" />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Conversaciones", "Perfil", "Aprendizaje", "Rutinas", "Documentos"]);
    expect(screen.getByTestId("stub-trabajos").textContent).toBe("a1");
    fireEvent.mouseDown(screen.getByTestId("pestana-perfil"), { button: 0 });
    expect(screen.getByTestId("perfil-nivel").textContent).toContain("Oficial");
    expect(screen.getByTestId("perfil-personalidad")).toBeTruthy();
    expect(screen.getByTestId("perfil-propuesta").textContent).toContain("propuesta inicial");
    fireEvent.mouseDown(screen.getByTestId("pestana-aprendizaje"), { button: 0 });
    expect(screen.getByTestId("stub-memoria").getAttribute("data-fijo")).toBe("true");
    expect(screen.getByTestId("stub-memoria").textContent).toBe("a1");
    expect(screen.getByTestId("ensenar-no")).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId("pestana-rutinas"), { button: 0 });
    expect(screen.getByTestId("stub-rutinas").textContent).toBe("1");
    expect(screen.getByTestId("programar-no")).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId("pestana-documentos"), { button: 0 });
    expect(screen.getByTestId("stub-documentos").getAttribute("data-fijo")).toBe("true");
  });
  it("«Te espera» lleva a Conversaciones", () => {
    render(<Montar id="a1" inicial="perfil" />);
    expect(screen.queryByTestId("stub-trabajos")).toBeNull();
    fireEvent.click(screen.getByTestId("panel-espera"));
    expect(screen.getByTestId("stub-trabajos")).toBeTruthy();
  });
  it("un agente nuevo sin perfil lo dice y ofrece enseñarle si viene del Constructor", () => {
    render(<Montar id="a5" inicial="perfil" />);
    expect(screen.getByTestId("perfil-vacio")).toBeTruthy();
    expect(screen.getByTestId("perfil-nivel").textContent).toContain("Aprendiz");
    fireEvent.mouseDown(screen.getByTestId("pestana-aprendizaje"), { button: 0 });
    expect(screen.getByTestId("stub-ensenar")).toBeTruthy();
  });
  it("un agente de Marketing remite a su módulo, salvo Comunicación interna, que trae sus avisos", () => {
    const { unmount } = render(<Montar id="a3" />);
    expect(screen.getByTestId("conv-sistema")).toBeTruthy();
    expect(screen.queryByTestId("stub-trabajos")).toBeNull();
    fireEvent.mouseDown(screen.getByTestId("pestana-documentos"), { button: 0 });
    expect(screen.getByTestId("documentos-no")).toBeTruthy();
    unmount();
    render(<Montar id="a4" />);
    expect(screen.getByTestId("stub-comunicacion")).toBeTruthy();
  });
});
