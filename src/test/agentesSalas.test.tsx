import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SalaIsometrica } from "@/components/agentes/SalaIsometrica";
import { DEPARTAMENTOS } from "@/lib/agentes/departamentos";
import { ASPECTOS, ISLA_DISENO } from "@/lib/agentes/personajesDatos";
import { PASO, SALAS, distribuirSala } from "@/lib/agentes/salas";
import type { FiguraOficina } from "@/lib/agentes/oficina";

const fig = (clave: string, estado: FiguraOficina["estado"] = "sentado"): FiguraOficina => ({ id: "id-" + clave, clave, nombre: clave, estado, ultimoLatido: null, ultimaTareaAt: null, tareasBien: 0, tareasMal: 0, descripcion: "", rol: "" });
const separados = (ps: Array<{ u: number; v: number }>) => ps.every((a, i) => ps.every((b, j) => i === j || Math.abs(a.u - b.u) >= PASO - 0.45 || Math.abs(a.v - b.v) >= PASO - 0.45));

describe("distribución de las salas", () => {
  it("las salas del diseño cubren a los 29 agentes, cada uno una sola vez y con claves reales", () => {
    const todas = Object.values(SALAS).flatMap((s) => Object.keys(s.posiciones));
    expect(new Set(todas).size).toBe(todas.length);
    expect(todas.length).toBe(29);
    for (const k of todas) expect(Object.keys(ASPECTOS)).toContain(k);
    for (const s of Object.values(SALAS)) for (const [u, v] of Object.values(s.posiciones)) { expect(u).toBeGreaterThan(0); expect(u).toBeLessThan(s.n); expect(v).toBeLessThan(s.n); }
    expect(Object.keys(ISLA_DISENO).length).toBeGreaterThan(0);
  });
  it("los agentes conocidos van donde dice el diseño y los zonas aparecen", () => {
    const r = distribuirSala("juridico", ["amatl", "tlahtoani"], (c) => c);
    expect(r.puestos.find((p) => p.clave === "amatl")).toMatchObject({ u: 4.9, v: 1.8 });
    expect(r.zonas.map((z) => z.nombre).sort()).toEqual(["Archivo", "Dirección"]);
    expect(r.n).toBe(7);
  });
  it("un agente nuevo recibe un lugar libre sin encimarse y la sala crece si hace falta", () => {
    const nuevos = ["x1", "x2", "x3", "x4", "x5", "x6"];
    const r = distribuirSala("juridico", ["amatl", "tlahtoani", "tepantli", "tequitl", ...nuevos], (c) => c);
    expect(r.puestos).toHaveLength(10);
    expect(r.n).toBeGreaterThan(7);
    expect(separados(r.puestos)).toBe(true);
    expect(r.zonas.some((z) => z.nombre === "Equipo nuevo")).toBe(true);
  });
  it("un departamento sin diseño igual acomoda a todos", () => {
    const r = distribuirSala("inventado", ["a", "b", "c", "d"], (c) => c);
    expect(r.puestos).toHaveLength(4);
    expect(separados(r.puestos)).toBe(true);
  });
});

describe("SalaIsometrica", () => {
  it("dibuja a cada agente con su estado, se elige con clic y con teclado", () => {
    const onElegir = vi.fn();
    render(<SalaIsometrica depto={DEPARTAMENTOS.fiscal} figuras={[fig("atl", "trabajando"), fig("balam"), fig("equipo_nuevo")]} onElegir={onElegir} />);
    expect(screen.getByTestId("sala-fiscal").getAttribute("data-activa")).toBe("true");
    expect(screen.getByLabelText("atl: Trabajando")).toBeTruthy();
    fireEvent.click(screen.getByTestId("sala-agente-id-balam"));
    fireEvent.keyDown(screen.getByTestId("sala-agente-id-equipo_nuevo"), { key: "Enter" });
    expect(onElegir.mock.calls.map((c) => c[0])).toEqual(["id-balam", "id-equipo_nuevo"]);
  });
  it("sin nadie trabajando la sala no se marca activa", () => {
    render(<SalaIsometrica depto={DEPARTAMENTOS.otros} figuras={[fig("kawiil_verificador_metricool")]} />);
    expect(screen.getByTestId("sala-otros").getAttribute("data-activa")).toBe("false");
  });
});
