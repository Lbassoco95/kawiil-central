import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EstadoMonitoreo } from "@/components/marketing/EstadoMonitoreo";
import { sinLecturaDeHoy, corridaConFalla } from "@/components/marketing/monitoreo";
import type { ColchonLectura, CorridaVigilante } from "@/hooks/useMarketing";

const lect = (fecha: string, simulada = false): ColchonLectura => ({ id: fecha, fecha, red: "instagram", ultima_programada: "2026-11-07", dias: 6, color: "rojo", tope: false, programadas: 5, simulada, corrida_at: fecha + "T13:00:00Z" });
const corrida = (resultado: string, simulada = false): CorridaVigilante => ({ id: "c1", agente: "vigilante", accion: "colchon", resultado, detalle: { simulada }, registrado_at: "2026-11-02T13:00:05Z" });
// 2 nov 2026 en Ciudad de México (UTC-6): 7:29 = 13:29Z, 7:30 = 13:30Z
const A_LAS = { "7:29": new Date("2026-11-02T13:29:00Z"), "7:30": new Date("2026-11-02T13:30:00Z"), "9:00": new Date("2026-11-02T15:00:00Z"), "tarde": new Date("2026-11-03T04:00:00Z") };

describe("aviso «Sin lectura de hoy»", () => {
  it("antes de las 7:30 no avisa aunque no haya lectura de hoy", () => {
    expect(sinLecturaDeHoy([lect("2026-11-01")], A_LAS["7:29"]).aviso).toBe(false);
  });
  it("desde las 7:30, sin lectura de hoy: avisa y dice cuál es la última", () => {
    const r = sinLecturaDeHoy([lect("2026-11-01"), lect("2026-10-31")], A_LAS["7:30"]);
    expect(r).toEqual({ aviso: true, ultima: "2026-11-01" });
  });
  it("con lectura real de hoy no avisa", () => {
    expect(sinLecturaDeHoy([lect("2026-11-02")], A_LAS["9:00"]).aviso).toBe(false);
  });
  it("una lectura de prueba (fecha fija) no cuenta como lectura del día", () => {
    expect(sinLecturaDeHoy([lect("2026-11-02", true)], A_LAS["9:00"])).toEqual({ aviso: true, ultima: null });
  });
  it("usa la fecha de Ciudad de México, no la de UTC (03 nov 04:00Z = 2 nov 22:00 CDMX)", () => {
    expect(sinLecturaDeHoy([lect("2026-11-02")], A_LAS["tarde"]).aviso).toBe(false);
  });
  it("reconoce corridas con falla por su resultado", () => {
    expect(corridaConFalla({ resultado: "falla de lectura: token rechazado" })).toBe(true);
    expect(corridaConFalla({ resultado: "instagram 6 rojo; 0 casos nuevos, 3 actualizados, 0 cerrados; 2 errores" })).toBe(true);
    expect(corridaConFalla({ resultado: "instagram 6 rojo; facebook 6 rojo; linkedin 6 rojo; 0 casos nuevos, 3 actualizados, 0 cerrados" })).toBe(false);
  });
});

describe("EstadoMonitoreo en pantalla", () => {
  it("trabajo que no corrió: muestra el aviso con la fecha de la última lectura y la última corrida", () => {
    render(<EstadoMonitoreo lecturas={[lect("2026-11-01")]} ultimaCorrida={null} estadoBitacora="ok" ahora={A_LAS["9:00"]} />);
    expect(screen.getByTestId("aviso-sin-lectura").textContent).toContain("Sin lectura de hoy: la última es del");
    expect(screen.getByTestId("ultima-corrida").textContent).toContain("todavía no hay corridas");
  });
  it("lectura fallida: la última corrida aparece 'Con falla' con su motivo, más el aviso", () => {
    render(<EstadoMonitoreo lecturas={[lect("2026-11-01")]} ultimaCorrida={corrida("falla de lectura: token rechazado o plan sin acceso")} estadoBitacora="ok" ahora={A_LAS["9:00"]} />);
    expect(screen.getByTestId("ultima-corrida").textContent).toContain("Con falla");
    expect(screen.getByTestId("ultima-corrida").textContent).toContain("token rechazado");
    expect(screen.getByRole("alert")).toBeTruthy();
  });
  it("error al guardar: la última corrida sale 'Con falla' aunque haya lectura de hoy", () => {
    render(<EstadoMonitoreo lecturas={[lect("2026-11-02")]} ultimaCorrida={corrida("instagram 6 rojo; 0 casos nuevos, 3 actualizados, 0 cerrados; 1 errores")} estadoBitacora="ok" ahora={A_LAS["9:00"]} />);
    expect(screen.getByTestId("ultima-corrida").textContent).toContain("Con falla");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("recuperación: con lectura de hoy y corrida correcta desaparece el aviso y se ve 'Correcta'", () => {
    render(<EstadoMonitoreo lecturas={[lect("2026-11-02")]} ultimaCorrida={corrida("instagram 6 rojo; facebook 6 rojo; linkedin 6 rojo; 0 casos nuevos, 3 actualizados, 0 cerrados")} estadoBitacora="ok" ahora={A_LAS["9:00"]} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("ultima-corrida").textContent).toContain("Correcta");
  });
  it("si la bitácora no se pudo leer, lo dice (no finge que todo está bien)", () => {
    render(<EstadoMonitoreo lecturas={[lect("2026-11-02")]} ultimaCorrida={null} estadoBitacora="error" ahora={A_LAS["9:00"]} />);
    expect(screen.getByTestId("ultima-corrida").textContent).toContain("no se pudo leer la bitácora");
  });
  it("una corrida de prueba se rotula como tal", () => {
    render(<EstadoMonitoreo lecturas={[lect("2026-11-02")]} ultimaCorrida={corrida("instagram 6 rojo", true)} estadoBitacora="ok" ahora={A_LAS["9:00"]} />);
    expect(screen.getByTestId("ultima-corrida").textContent).toContain("prueba con fecha fija");
  });
});
