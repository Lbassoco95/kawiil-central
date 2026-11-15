import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useState } from "react";
import { SelectorAgentes } from "@/components/agentes/SelectorAgentes";
import { FigurasContext } from "@/components/agentes/BandaEquipo";
import { figurasOficina } from "@/lib/agentes/oficina";
import type { AgenteRegistro } from "@/lib/agentes/registro";

const ag = (id: string, name: string, o: Partial<AgenteRegistro> = {}): AgenteRegistro => ({ id, name, display_name: name, description: `Descripción de ${name}`, role: null, status: "idle", kind: "consultable", last_heartbeat: new Date().toISOString(), last_task_at: null, tasks_completed: 0, tasks_failed: 0, ...o });
const TRES = [ag("a1", "Tlahtolli"), ag("a2", "Atl"), ag("a3", "Coyolli")];
const MUCHOS = Array.from({ length: 12 }, (_, i) => ag("m" + i, "Agente" + i));

function Prueba({ agentes = TRES, inicial = "", detalle, alCambiar }: { agentes?: AgenteRegistro[]; inicial?: string; detalle?: (a: AgenteRegistro) => string | undefined; alCambiar?: (id: string) => void }) {
  const [v, setV] = useState(inicial);
  return <SelectorAgentes agentes={agentes} valor={v} testid="sel" detalle={detalle} onCambio={(id) => { setV(id); alCambiar?.(id); }} />;
}

describe("<SelectorAgentes />", () => {
  it("sin elegir muestra todos los agentes como opciones de un grupo accesible, con su estado y su dato", () => {
    render(<Prueba detalle={(a) => `dato de ${a.name}`} />);
    const grupo = screen.getByRole("radiogroup", { name: "Agente" });
    const opciones = within(grupo).getAllByRole("radio");
    expect(opciones).toHaveLength(3);
    expect(opciones.every((o) => o.getAttribute("aria-checked") === "false")).toBe(true);
    expect(screen.getByTestId("sel-a2-detalle").textContent).toBe("dato de Atl");
    expect(opciones[1].getAttribute("aria-label")).toMatch(/^Atl: .+\. dato de Atl$/);
  });
  it("sin dato propio muestra el rol corto que sale de la descripción", () => {
    render(<Prueba />);
    expect(screen.getByTestId("sel-a1-detalle").textContent).toBe("Descripción de Tlahtolli");
  });
  it("al elegir uno avisa, y se pliega a una sola fila con «Cambiar»", () => {
    const alCambiar = vi.fn();
    render(<Prueba alCambiar={alCambiar} />);
    fireEvent.click(screen.getByTestId("sel-a2"));
    expect(alCambiar).toHaveBeenCalledWith("a2");
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("sel-cambiar")).toBeTruthy();
    expect(screen.queryByTestId("sel-a1")).toBeNull();
  });
  it("«Cambiar» (o tocar al elegido) vuelve a mostrar la lista con el actual marcado, y se puede cambiar de agente", () => {
    const alCambiar = vi.fn();
    render(<Prueba inicial="a1" alCambiar={alCambiar} />);
    expect(screen.getAllByRole("radio")).toHaveLength(1);                 // con un agente ya elegido empieza plegado
    fireEvent.click(screen.getByTestId("sel-cambiar"));
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByTestId("sel-a1").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("sel-a3"));
    expect(alCambiar).toHaveBeenCalledWith("a3");
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio"));                          // tocar al elegido también abre la lista
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });
  it("«Dejar a …» pliega la lista sin cambiar de agente", () => {
    const alCambiar = vi.fn();
    render(<Prueba inicial="a1" alCambiar={alCambiar} />);
    fireEvent.click(screen.getByTestId("sel-cambiar"));
    fireEvent.click(screen.getByTestId("sel-plegar"));
    expect(alCambiar).not.toHaveBeenCalled();
    expect(screen.getAllByRole("radio")).toHaveLength(1);
  });
  it("hasta 8 agentes no hay buscador; con más aparece y filtra por nombre, rol o dato", () => {
    const { unmount } = render(<Prueba />);
    expect(screen.queryByTestId("sel-buscar")).toBeNull();
    unmount();
    render(<Prueba agentes={[...MUCHOS, ag("z", "Zorro", { description: "Contratos y convenios" })]} detalle={(a) => (a.id === "m3" ? "7 habilidades" : undefined)} />);
    const caja = screen.getByTestId("sel-buscar");
    fireEvent.change(caja, { target: { value: "zorro" } });
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    fireEvent.change(caja, { target: { value: "convenios" } });             // por rol
    expect(screen.getByTestId("sel-z")).toBeTruthy();
    fireEvent.change(caja, { target: { value: "habilidades" } });           // por el dato de la pestaña
    expect(screen.getByTestId("sel-m3")).toBeTruthy(); expect(screen.getAllByRole("radio")).toHaveLength(1);
    fireEvent.change(caja, { target: { value: "nadie" } });
    expect(screen.getByTestId("sel-sin-resultados").textContent).toContain("«nadie»");
  });
  it("usa el estado real de la página cuando existe (trabajando) y el del registro cuando no", () => {
    const f = figurasOficina([ag("a1", "Tlahtolli", { status: "working" })], [{ id: "t", agent_id: "a1", task_type: "manual", status: "in_progress", created_at: new Date().toISOString(), started_at: new Date().toISOString(), completed_at: null }], new Date());
    render(<FigurasContext.Provider value={f}><Prueba agentes={[ag("a1", "Tlahtolli")]} /></FigurasContext.Provider>);
    expect(screen.getByTestId("sel-a1").getAttribute("aria-label")).toContain("Trabajando");
  });
  it("sin agentes no rompe y sin resultados no deja elegir nada", () => {
    render(<Prueba agentes={[]} />);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByRole("radiogroup")).toBeTruthy();
  });
  it("un valor que ya no existe entre los agentes se muestra como sin elegir", () => {
    render(<Prueba inicial="borrado" />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getAllByRole("radio").every((o) => o.getAttribute("aria-checked") === "false")).toBe(true);
  });
});
