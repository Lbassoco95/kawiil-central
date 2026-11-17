import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

const AG = "123e4567-e89b-12d3-a456-426614174000";
vi.mock("@/components/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useAgentesRegistro", () => ({
  useAgentesRegistro: () => ({ data: [{ id: AG, name: "amatl", display_name: "amatl", description: null, role: null, status: "idle", kind: "consultable", last_heartbeat: new Date().toISOString(), last_task_at: null, tasks_completed: 0, tasks_failed: 0 }], isLoading: false, isError: false, dataUpdatedAt: 0 }),
  useTareasAgentes: () => ({ data: [{ id: "t1", agent_id: AG, task_type: "x", status: "completed", created_at: new Date().toISOString(), started_at: null, completed_at: null }], isLoading: false, isError: false, dataUpdatedAt: 0 }),
  useErroresAgentes: () => ({ data: [] }),
}));
vi.mock("@/hooks/useAgentesEnVivo", () => ({ useAgentesEnVivo: () => "conectado" }));
vi.mock("@/components/agentes/IndicadorEnVivo", () => ({ IndicadorEnVivo: () => null }));
vi.mock("@/components/marketing/AgentesRegistro", () => ({ AgentesRegistro: () => <div data-testid="stub-tablas" /> }));
vi.mock("@/components/agentes/BarraTareas", () => ({ BarraTareas: ({ onVerSeguimiento }: { onVerSeguimiento?: (id?: string) => void }) => <button data-testid="stub-barra" onClick={() => onVerSeguimiento?.("t1")} /> }));
vi.mock("@/components/agentes/ConstructorAgentes", () => ({ ConstructorAgentes: ({ onIr }: { onIr?: (p: string, id: string) => void }) => <button data-testid="stub-constructor" onClick={() => onIr?.("programar", AG)} /> }));
vi.mock("@/components/agentes/ListaLpb", () => ({ ListaLpb: () => <div data-testid="stub-lpb" /> }));
vi.mock("@/components/agentes/VistaOficina", () => ({ VistaOficina: ({ vista, pestana }: { vista: { tipo: string }; pestana: string }) => <div data-testid="stub-oficina">{vista.tipo}:{pestana}</div> }));

import Agentes from "@/pages/Agentes";

const Ubicacion = () => <span data-testid="url">{useLocation().search}</span>;
const montar = (url: string) => render(<MemoryRouter initialEntries={[url]}><Agentes /><Ubicacion /></MemoryRouter>);

describe("página Agentes con dos pestañas", () => {
  it("solo hay Oficina y Administrar, y abre en Oficina", () => {
    montar("/agentes");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Oficina", "Administrar"]);
    expect(screen.getByTestId("stub-oficina").textContent).toBe("plano:conversaciones");
  });
  it("Administrar trae Crear agente y Tablas", () => {
    montar("/agentes?pestana=administrar");
    expect(screen.getByTestId("administrar-crear")).toBeTruthy();
    expect(screen.getByTestId("stub-tablas")).toBeTruthy();
    expect(screen.getByTestId("stub-lpb")).toBeTruthy();   // «Lista LPB» (de otro cambio) vive en Administrar
    expect(screen.queryByTestId("stub-oficina")).toBeNull();
  });
  it("cambiar de pestaña queda en la URL", () => {
    montar("/agentes");
    fireEvent.mouseDown(screen.getByTestId("seccion-administrar"), { button: 0 });
    expect(screen.getByTestId("url").textContent).toContain("pestana=administrar");
    fireEvent.mouseDown(screen.getByTestId("seccion-oficina"), { button: 0 });
    expect(screen.getByTestId("url").textContent).not.toContain("pestana");
  });
  it("los enlaces viejos redirigen: crear/tablas → Administrar; memoria con un agente → su pestaña Aprendizaje", () => {
    const a = montar("/agentes?pestana=crear");
    expect(screen.getByTestId("administrar-crear")).toBeTruthy();
    expect(screen.getByTestId("url").textContent).toBe("?pestana=administrar");
    a.unmount();
    montar(`/agentes?pestana=memoria&vista=agente:${AG}`);
    expect(screen.getByTestId("stub-oficina").textContent).toBe("agente:aprendizaje");
    expect(screen.getByTestId("url").textContent).not.toContain("pestana");
  });
  it("un enlace viejo sin agente (departamentos, rutinas…) abre la Oficina", () => {
    montar("/agentes?pestana=departamentos");
    expect(screen.getByTestId("stub-oficina").textContent).toBe("plano:conversaciones");
    expect(screen.getByTestId("url").textContent).toBe("");
  });
  it("«Abrir la conversación» de la barra lleva al escritorio del agente de esa tarea", () => {
    montar("/agentes");
    fireEvent.click(screen.getByTestId("stub-barra"));
    expect(screen.getByTestId("stub-oficina").textContent).toBe("agente:conversaciones");
    expect(screen.getByTestId("url").textContent).toContain(`vista=agente%3A${AG}`);
  });
  it("después de crear un agente, «Programar» lleva a su pestaña Rutinas", () => {
    montar("/agentes?pestana=administrar");
    fireEvent.click(screen.getByTestId("stub-constructor"));
    expect(screen.getByTestId("stub-oficina").textContent).toBe("agente:rutinas");
  });
});
