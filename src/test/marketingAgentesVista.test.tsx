import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { Agentes } from "@/components/marketing/Agentes";
import type { Caso, FilaBitacora, TrabajoCron } from "@/hooks/useMarketing";

const fila = (id: string, agente: string, accion: string, resultado: string, registrado_at: string, caso_id: string | null = null): FilaBitacora => ({ id, agente, accion, resultado, caso_id, detalle: { simulada: false }, registrado_at });
const caso = (id: string, numero: number, red: Caso["red"], tipo = "colchon", estado = "abierto"): Caso =>
  ({ id, numero, tipo, red, titulo: "t", descripcion: null, evidencia: [], estado, responsable: "vigilante", detectado_at: "2026-11-01T00:00:00Z", pieza_id: null });
const FILAS = [
  fila("a1", "informe_diario", "informe", "informe del 2026-11-03: 4 faltantes, 0 con error, 0 con estado desconocido", "2026-11-03T13:00:04Z"),
  fila("a2", "vigilante", "caso_colchon", "caso #7 actualizado en instagram: 5 → 4 días", "2026-11-03T13:00:04Z", "c7"),
  fila("a5", "vigilante", "colchon", "instagram 4 rojo; facebook 4 rojo; linkedin 4 rojo; 0 casos nuevos, 3 actualizados, 0 cerrados", "2026-11-03T13:00:04Z"),
  fila("a6", "sistema", "carga_historial_calendario_maestro", "carga histórica del calendario", "2026-10-20T10:00:00Z"),
];
const CASOS = [caso("c7", 7, "instagram"), caso("c8", 8, "facebook"), caso("c9", 9, "linkedin"), caso("c1", 1, null, "dato_sospechoso")];
const JOBS: TrabajoCron[] = [
  { trabajo: "marketing-colchon-diario-0700-cdmx", horario: "0 13 * * *", activo: true, ultima_ejecucion: "2026-11-03T13:00:00Z", ultima_estado: "succeeded" },
  { trabajo: "marketing-colchon-vigia-0730-cdmx", horario: "30 13 * * *", activo: true, ultima_ejecucion: "2026-11-03T13:30:00Z", ultima_estado: "succeeded" },
];
const AHORA = new Date("2026-11-03T16:00:00Z"); // 10:00 en Ciudad de México
const vista = (o: Partial<Parameters<typeof Agentes>[0]> = {}) =>
  render(<Agentes filas={FILAS} casos={CASOS} propuestas={[]} decisiones={[]} trabajos={{ disponible: true, trabajos: JOBS }} estadoBitacora="ok" ahora={AHORA} {...o} />);

describe("vista Agentes", () => {
  it("hoy: tres tarjetas (Vigilante, Informe diario, Vigía) y NINGUNA del Revisor", () => {
    vista();
    for (const id of ["vigilante", "informe_diario", "vigia"]) expect(screen.getByTestId(`agente-${id}`)).toBeTruthy();
    expect(screen.queryByTestId("agente-revisor")).toBeNull();
  });
  it("cada tarjeta muestra última corrida, resultado, próxima ejecución y si falló", () => {
    vista();
    const v = screen.getByTestId("agente-vigilante").textContent ?? "";
    expect(v).toContain("Correcta"); expect(v).toContain("hoy 07:00"); expect(v).toContain("instagram 4 rojo"); expect(v).toContain("mañana 07:00");
    const vi = screen.getByTestId("agente-vigia").textContent ?? "";
    expect(vi).toContain("Sin novedad"); expect(vi).toContain("hoy 07:30"); expect(vi).toContain("mañana 07:30");
  });
  it("trabajo que no corrió: la tarjeta lo dice", () => {
    vista({ filas: FILAS.filter((f) => f.registrado_at < "2026-11-03T12:00:00Z") });
    expect(screen.getByTestId("agente-vigilante").textContent).toContain("No corrió");
  });
  it("lectura fallida: aparece «Con falla» en la tarjeta y «Falla» en la línea de tiempo", () => {
    vista({ filas: [fila("f", "vigilante", "colchon", "falla de lectura: token rechazado o plan sin acceso", "2026-11-03T13:00:04Z"), ...FILAS] });
    expect(screen.getByTestId("agente-vigilante").textContent).toContain("Con falla");
    expect(within(screen.getByTestId("evento-f")).getByText("Falla")).toBeTruthy();
  });
  it("recuperación: con la corrida buena posterior vuelve a «Correcta»", () => {
    vista({ filas: [fila("ok", "vigilante", "colchon", "instagram 4 rojo; 0 casos nuevos, 3 actualizados, 0 cerrados", "2026-11-03T13:00:04Z"), fila("f", "vigilante", "colchon", "falla de lectura: HTTP 502", "2026-11-02T13:00:04Z")] });
    expect(screen.getByTestId("agente-vigilante").textContent).toContain("Correcta");
  });
  it("trabajo pausado se muestra como pausado y sin próxima ejecución", () => {
    vista({ trabajos: { disponible: true, trabajos: JOBS.map((j) => ({ ...j, activo: false })) } });
    const t = screen.getByTestId("agente-vigilante").textContent ?? "";
    expect(t).toContain("Pausado"); expect(t).toContain("pausado");
  });
  it("sin la función de lectura: avisa que los horarios son del catálogo y el Vigía no aparece; el resto sí", () => {
    vista({ trabajos: { disponible: false, trabajos: [] } });
    expect(screen.getByTestId("agentes-aviso-catalogo")).toBeTruthy();
    expect(screen.queryByTestId("agente-vigia")).toBeNull(); expect(screen.getByTestId("agente-vigilante")).toBeTruthy();
  });
  it("flujo hoy: casos, sin Revisor, 0 propuestas y 0 decisiones", () => {
    vista();
    const f = screen.getByTestId("agentes-flujo").textContent ?? "";
    expect(f).toContain("4 abiertos"); expect(f).toContain("Decisión de Dirección"); expect(f).not.toContain("Investiga y propone"); expect(f).toContain("El Revisor todavía no existe");
  });
  it("cuando existe el Revisor y hay propuestas, el paso aparece con conteos", () => {
    vista({ filas: [...FILAS, fila("r", "revisor", "investigacion", "propuesta creada", "2026-11-03T14:00:00Z")], propuestas: [{ estado: "pendiente" }, { estado: "aprobada" }], decisiones: [{ decision: "aprobada" }] });
    const f = screen.getByTestId("agentes-flujo").textContent ?? "";
    expect(f).toContain("Investiga y propone"); expect(f).toContain("1 pendientes"); expect(f).toContain("1 aprobadas"); expect(screen.getByTestId("agente-revisor")).toBeTruthy();
  });
  it("línea de tiempo: muestra el caso al que se refiere cada evento y filtra al pulsarlo", () => {
    vista();
    const ev = screen.getByTestId("evento-a2");
    const chip = within(ev).getByRole("button");
    expect(chip.textContent).toContain("#7"); expect(chip.textContent).toContain("Instagram");
    fireEvent.click(chip);
    expect(screen.getByRole("button", { name: /Caso #7/ })).toBeTruthy();
    expect(screen.queryByTestId("evento-a1")).toBeNull(); expect(screen.getByTestId("evento-a2")).toBeTruthy();
  });
  it("filtro por agente y «solo fallas»", () => {
    vista();
    fireEvent.change(screen.getByLabelText("Filtrar por agente"), { target: { value: "informe_diario" } });
    expect(screen.queryByTestId("evento-a2")).toBeNull(); expect(screen.getByTestId("evento-a1")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Solo fallas"));
    expect(screen.getByText(/No hay actividad con esos filtros/)).toBeTruthy();
  });
  it("la actividad antigua aparece al pedir 30 días", () => {
    vista();
    expect(screen.queryByTestId("evento-a6")).toBeNull();
    fireEvent.click(screen.getByText("Ver 30 días"));
    expect(screen.getByTestId("evento-a6")).toBeTruthy();
  });
  it("si no se pudo leer la bitácora, lo dice (no finge que no hay agentes)", () => {
    vista({ estadoBitacora: "error", filas: [] });
    expect(screen.getByText(/No pudimos leer la bitácora de agentes/)).toBeTruthy(); expect(screen.queryByTestId("vista-agentes")).toBeNull();
  });
  it("es de solo lectura: ningún botón ejecuta, decide ni escribe", () => {
    vista();
    const botones = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    for (const b of botones) expect(b).not.toMatch(/ejecutar|decidir|aprobar|rechazar|reintentar|correr/i);
  });
});
