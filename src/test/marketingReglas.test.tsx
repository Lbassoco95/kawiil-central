import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { descripcionVigente, umbralesSemaforo, cambiosParametros } from "@/components/marketing/reglasValores";
import { Reglas } from "@/components/marketing/Reglas";
import { Semaforo } from "@/components/marketing/Semaforo";
import type { Regla, ReglaHistorial } from "@/hooks/useMarketing";

const r = (codigo: string, nombre: string, descripcion: string, parametros: Record<string, unknown>): Regla => ({
  id: "id-" + codigo, codigo, nombre, descripcion, parametros, activa: true, version: 1, updated_at: "2026-11-01",
});
// Valores y textos tal como están hoy en producción.
const REGLAS: Regla[] = [
  r("publicacion", "Publicación", "A los N minutos de la hora programada la pieza debe aparecer publicada en las tres redes; si no, caso.", { minutos_tolerancia: 30 }),
  r("huecos", "Huecos", "Si una red pasa más de N días sin publicar lo planeado, caso.", { dias_maximos: 3 }),
  r("dato_sospechoso", "Dato sospechoso (cero)", "Pieza con cero de alcance o impresiones y más de N horas desde su publicación: caso.", { valor: 0, horas_minimas: 48 }),
  r("estado_gris", "Estado gris", "Sin consulta exitosa a Metricool en N minutos, la red pasa a gris y se abre caso de falla de monitoreo.", { minutos_fuera_ventana: 90, minutos_dentro_ventana: 30 }),
  r("ventana_publicacion", "Frecuencia del Vigilante", "Cada N minutos dentro de la ventana de publicación y cada hora fuera de ella.", { minutos_fuera: 60, minutos_dentro: 15, antes_primera_min: 30, despues_ultima_min: 90 }),
  r("semaforo_instagram", "Semáforo Instagram", "Promedio simple.", { medida: "alcance", verde_desde: 35, amarillo_desde: 15 }),
  r("semaforo_facebook", "Semáforo Facebook", "Promedio simple.", { medida: "alcance", verde_desde: 18, amarillo_desde: 10 }),
  r("semaforo_linkedin", "Semáforo LinkedIn", "Promedio simple.", { medida: "impresiones", verde_desde: 17, amarillo_desde: 5 }),
];
const desc = (c: string) => { const x = REGLAS.find((y) => y.codigo === c)!; return descripcionVigente(c, x.descripcion, x.parametros); };

describe("reglas con valores vigentes (sin «N»)", () => {
  it("sustituye N por el valor de cada parámetro", () => {
    expect(desc("publicacion")).toContain("A los 30 minutos");
    expect(desc("huecos")).toContain("más de 3 días");
    expect(desc("dato_sospechoso")).toContain("más de 48 horas");
    expect(desc("estado_gris")).toContain("en 30 minutos dentro de la ventana");
    expect(desc("estado_gris")).toContain("(90 fuera de ella)");
    expect(desc("ventana_publicacion")).toContain("Cada 15 minutos dentro");
    expect(desc("ventana_publicacion")).toContain("cada hora fuera");
    for (const c of ["publicacion", "huecos", "dato_sospechoso", "estado_gris", "ventana_publicacion"]) expect(desc(c)).not.toMatch(/\bN\b/);
  });
  it("si falta el parámetro no inventa: deja la descripción original", () => {
    expect(descripcionVigente("huecos", "Si una red pasa más de N días", {})).toBe("Si una red pasa más de N días");
  });
  it("umbrales de los tres semáforos desde las reglas", () => {
    expect(umbralesSemaforo(REGLAS).map((u) => [u.red, u.verde, u.amarillo])).toEqual([["Instagram", 35, 15], ["Facebook", 18, 10], ["LinkedIn", 17, 5]]);
  });
  it("cambios entre versiones", () => {
    expect(cambiosParametros({ verde_desde: 35 }, { verde_desde: 40 })).toEqual([{ etiqueta: "Verde desde", antes: "35", despues: "40" }]);
  });
});

const historial: ReglaHistorial[] = [
  { id: "h1", regla_id: "id-publicacion", version: 1, parametros_anteriores: null, parametros_nuevos: { minutos_tolerancia: 30 }, activa: true, motivo: "Versión inicial", cambiado_at: "2026-10-31T21:00:00Z" },
  { id: "h2", regla_id: "id-publicacion", version: 2, parametros_anteriores: { minutos_tolerancia: 30 }, parametros_nuevos: { minutos_tolerancia: 45 }, activa: true, motivo: "Prueba", cambiado_at: "2026-11-02T21:00:00Z" },
];

describe("pestañas con umbrales e historial", () => {
  it("Reglas muestra los tres umbrales, los valores y el historial con cambios", () => {
    render(<Reglas reglas={REGLAS} historial={historial} puedeDecidir={false} />);
    for (const id of ["umbral-semaforo_instagram", "umbral-semaforo_facebook", "umbral-semaforo_linkedin"]) expect(screen.getByTestId(id)).toBeTruthy();
    expect(screen.getByTestId("umbral-semaforo_linkedin").textContent).toContain("desde 17");
    expect(screen.getByTestId("umbral-semaforo_facebook").textContent).toContain("por debajo de 10");
    fireEvent.click(screen.getByText("Publicación"));
    expect(screen.getByTestId("parametros-publicacion").textContent).toContain("Tolerancia (minutos)30");
    expect(screen.getAllByTestId("historial-publicacion")).toHaveLength(2);
    expect(screen.getByText("Tolerancia (minutos): 30 → 45")).toBeTruthy();
    expect(screen.getByText("Versión inicial.")).toBeTruthy();
  });
  it("Semáforo muestra los umbrales de las tres redes, no solo Instagram", () => {
    render(<Semaforo calibracion={[{ semana_inicio: "2026-10-26" } as never]} reglas={REGLAS} />);
    expect(screen.getByTestId("umbrales-semaforo")).toBeTruthy();
    expect(screen.getByTestId("umbral-semaforo_facebook").textContent).toContain("desde 18");
    expect(screen.getByTestId("umbral-semaforo_instagram").textContent).toContain("desde 35");
  });
});
