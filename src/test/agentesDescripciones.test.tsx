import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { descripcionAgente, etiquetaOpcion, rolCorto, type AgenteRegistro } from "@/lib/agentes/registro";
import { FichaAgente, capacidadesAgente } from "@/components/agentes/FichaAgente";
import { InstruirAgente } from "@/components/agentes/InstruirAgente";
import { Oficina } from "@/components/agentes/Oficina";
import { figurasOficina } from "@/lib/agentes/oficina";

const ag = (o: Partial<AgenteRegistro> & { id: string; name: string }): AgenteRegistro => ({
  display_name: null, description: null, role: null, status: "idle", kind: "consultable", last_heartbeat: new Date().toISOString(),
  last_task_at: null, tasks_completed: 0, tasks_failed: 0, ...o,
});
const NELLI = ag({ id: "n", name: "nelli", display_name: "Nelli", role: "nelli", description: "Especialista en prevención de lavado de dinero (PLD/FT) y cumplimiento regulatorio. Avisos, expedientes y alertas." });
const SOCRATES = ag({ id: "s", name: "legal_socratic_jurist", display_name: "Sócrates", role: "legal_jurist", description: "" });

describe("descripción y rol de los agentes", () => {
  it("la descripción del registro manda; sin ella se usa el respaldo; el rol técnico no cuenta como descripción", () => {
    expect(descripcionAgente(NELLI)).toContain("prevención de lavado");
    expect(descripcionAgente(SOCRATES)).toContain("decisiones litigiosas");
    expect(descripcionAgente(ag({ id: "x", name: "legal_algo", role: "legal_analyst" }))).toBe("");
    expect(descripcionAgente(ag({ id: "x", name: "algo", role: "Revisa contratos" }))).toBe("Revisa contratos");
  });
  it("rol corto: quita «Especialista en», «mexicano» y recorta sin partir palabras", () => {
    expect(rolCorto(ag({ id: "t", name: "teocuitl", description: "Especialista en derecho fiscal mexicano. CFF, LISR." }))).toBe("Derecho fiscal");
    expect(rolCorto(NELLI)).toMatch(/^Prevención de lavado de/);
    expect(rolCorto(NELLI).length).toBeLessThanOrEqual(30);
    expect(rolCorto(SOCRATES)).toBe("Jurista para decisiones de litigio");
    expect(rolCorto(ag({ id: "z", name: "z" }))).toBe("");
  });
  it("etiqueta del selector: nombre · rol, o solo el nombre", () => {
    expect(etiquetaOpcion(SOCRATES)).toBe("Sócrates · Jurista para decisiones de litigio");
    expect(etiquetaOpcion(ag({ id: "z", name: "zeta" }))).toBe("zeta");
  });
});

describe("<FichaAgente />", () => {
  it("muestra qué hace y qué puede usar, sin referencias de 1Password", () => {
    const a = ag({ id: "v", name: "v", display_name: "Vizum", description: "Vigila documentos de Vizum.", config: {
      internet: { dominios_permitidos: ["a.mx", "b.mx"] }, credenciales_1password: [{ etiqueta: "SAT", dominio: "sat.gob.mx", ref: "op://secreto/item/pass" }],
      fuentes_docs: [{}], habilidades: [{ estado: "aprobada" }, { estado: "borrador" }], programacion: { activa: true } } });
    render(<FichaAgente agente={a} />);
    const t = screen.getByTestId("ficha-agente").textContent ?? "";
    expect(t).toContain("Vigila documentos de Vizum.");
    expect(t).toContain("Internet: 2 sitios permitidos");
    expect(t).toContain("1Password: 1 acceso");
    expect(t).toContain("1 habilidad aprobada");
    expect(t).toContain("Con tarea programada");
    expect(t).not.toContain("op://");
    expect(capacidadesAgente({ config: null })).toEqual([]);
  });
  it("sin descripción lo dice, y sin agente no pinta nada", () => {
    const { container, rerender } = render(<FichaAgente agente={ag({ id: "q", name: "q" })} />);
    expect(screen.getByTestId("ficha-descripcion").textContent).toContain("aún no tiene descripción");
    rerender(<FichaAgente agente={undefined} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("Instrucciones: selector con descripción", () => {
  it("al elegir un agente aparece su ficha", () => {
    render(<QueryClientProvider client={new QueryClient()}><InstruirAgente agentes={[NELLI, SOCRATES]} /></QueryClientProvider>);
    expect(screen.queryByTestId("ficha-agente")).toBeNull();
    fireEvent.change(screen.getByTestId("instruir-agente"), { target: { value: "s" } });
    expect(screen.getByTestId("ficha-descripcion").textContent).toContain("decisiones litigiosas");
  });
});

describe("Oficina: rol bajo el nombre y descripción al elegir", () => {
  it("cada escritorio dice qué hace y el detalle trae la descripción completa", () => {
    const figuras = figurasOficina([NELLI, SOCRATES], [], new Date());
    render(<Oficina figuras={figuras} ahora={new Date()} demo={false} />);
    expect(screen.getByTestId("oficina-rol-s").textContent).toBe("Jurista para decisiones de litigio");
    fireEvent.click(screen.getByTestId("oficina-n"));
    expect(screen.getByTestId("oficina-descripcion").textContent).toContain("prevención de lavado de dinero");
  });
});
