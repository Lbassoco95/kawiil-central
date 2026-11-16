import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CalendarioRutinas } from "@/components/agentes/CalendarioRutinas";
import { enMexico, filasDeRutinas, horaTexto, proximaEjecucion, resumenRutinas } from "@/lib/agentes/rutinas";
import type { AgenteRegistro, TareaAgente } from "@/lib/agentes/registro";

// Domingo 15-nov-2026 18:00 UTC = 12:00 en Ciudad de México (UTC-6, sin horario de verano). El lunes 16 es el día 0.
const AHORA = new Date("2026-11-15T18:00:00Z");
const ag = (id: string, name: string, o: Partial<AgenteRegistro> = {}): AgenteRegistro => ({ id, name, display_name: null, description: null, role: null, status: "idle", kind: "consultable", last_heartbeat: null, last_task_at: null, tasks_completed: 0, tasks_failed: 0, ...o });
// Corrida a las hh:mm de México, hace `dias` días.
const corrida = (id: string, agent_id: string | null, dias: number, hh: number, mm: number, status = "completed", task_type = "scheduled"): TareaAgente => {
  const base = new Date(AHORA.getTime() - dias * 86_400_000);
  const f = enMexico(base);
  const t = new Date(base.getTime() + ((hh * 60 + mm) - (f.h * 60 + f.m)) * 60_000);
  return { id, agent_id, task_type, status, created_at: t.toISOString(), started_at: null, completed_at: null };
};

const MK = ag("mk1", "marketing_vigilante", { kind: "system" });
const LEGAL = ag("lg1", "legal_dof", { config: { programacion: { activa: true, hora: "08:30", dia_semana: 2, instruccion: "SECRETO revisa el DOF" } } });
const DIARIA = ag("dr1", "diaria", { config: { programacion: { activa: true, hora: "07:00" } } });
const PAUSADA = ag("ps1", "pausada", { config: { programacion: { activa: false, pausada_motivo: "Falló tres veces" } } });
const MANUAL = ag("mn1", "manual");
const ARCH = ag("ar1", "archivado", { status: "archived", config: { programacion: { activa: true, hora: "09:00" } } });

describe("rutinas (lógica)", () => {
  it("convierte instantes a hora de México con lunes = 0", () => {
    expect(enMexico(AHORA)).toMatchObject({ dia: 6, h: 12, m: 0, fecha: "2026-11-15" });
    expect(enMexico(new Date("2026-11-16T05:59:00Z"))).toMatchObject({ dia: 6, h: 23, m: 59 });
    expect(enMexico(new Date("2026-11-16T06:00:00Z"))).toMatchObject({ dia: 0, h: 0, m: 0 });
    expect(horaTexto(7 * 60 + 5)).toBe("07:05");
  });
  it("calcula la próxima ejecución diaria y semanal en hora de México", () => {
    expect(proximaEjecucion("07:00", null, AHORA).toISOString()).toBe("2026-11-16T13:00:00.000Z");   // lunes 07:00 MX
    expect(proximaEjecucion("13:00", null, AHORA).toISOString()).toBe("2026-11-15T19:00:00.000Z");   // hoy 13:00 MX
    expect(proximaEjecucion("08:30", 2, AHORA).toISOString()).toBe("2026-11-18T14:30:00.000Z");      // miércoles 08:30 MX
  });
  it("arma filas con programadas y observadas, sin archivados ni agentes sin rutina", () => {
    const tareas = [corrida("t1", "mk1", 1, 7, 0), corrida("t2", "mk1", 2, 7, 0, "failed"), corrida("t3", "mn1", 1, 7, 0, "completed", "manual"), corrida("t4", null, 1, 7, 0)];
    const filas = filasDeRutinas([MK, LEGAL, DIARIA, PAUSADA, MANUAL, ARCH], tareas, AHORA);
    expect(filas.map((f) => f.agenteId).sort()).toEqual(["dr1", "lg1", "mk1", "ps1"]);
    expect(filas.find((f) => f.agenteId === "mn1")).toBeUndefined();
    const mk = filas.find((f) => f.agenteId === "mk1")!;
    expect(mk).toMatchObject({ marketing: true, fuente: "observada", corridas30: 2, ultimaFalla: false });
    expect(mk.celdas[5]).toMatchObject({ hora: "07:00", corridas: 1, bien: 1, mal: 0 });   // hace 1 día = sábado
    expect(mk.celdas[4]).toMatchObject({ corridas: 1, mal: 1 });                           // hace 2 días = viernes
    expect(filas.find((f) => f.agenteId === "ps1")).toMatchObject({ programada: "pausada", pausadaMotivo: "Falló tres veces" });
  });
  it("una programación semanal ocupa solo su día y una diaria, los siete", () => {
    const [lg] = filasDeRutinas([LEGAL], [], AHORA);
    expect(lg.celdas.map((c) => c?.programada ?? false)).toEqual([false, false, true, false, false, false, false]);
    expect(lg.celdas[2]).toMatchObject({ hora: "08:30", corridas: 0 });
    const [dr] = filasDeRutinas([DIARIA], [], AHORA);
    expect(dr.celdas.every((c) => c?.hora === "07:00")).toBe(true);
    expect(dr.proxima).not.toBeNull();
  });
  it("usa la mediana de la hora y descarta corridas con más de 30 días", () => {
    const tareas = [corrida("a", "mk1", 1, 7, 0), corrida("b", "mk1", 8, 7, 5), corrida("c", "mk1", 15, 11, 9), corrida("d", "mk1", 40, 7, 0)];
    const mk = filasDeRutinas([MK], tareas, AHORA)[0];
    expect(mk.corridas30).toBe(3);
    expect(mk.celdas[5]).toMatchObject({ corridas: 3, hora: "07:05" });
  });
  it("ignora programaciones con hora inválida y resume los totales", () => {
    const mala = ag("mal", "mala", { config: { programacion: { activa: true, hora: "25:99" } } });
    expect(filasDeRutinas([mala], [], AHORA)).toEqual([]);
    const r = resumenRutinas(filasDeRutinas([MK, LEGAL, PAUSADA], [corrida("t1", "mk1", 1, 7, 0), corrida("t2", "mk1", 2, 7, 0, "failed")], AHORA));
    expect(r).toEqual({ programadas: 1, pausadas: 1, conCorridas: 1, corridas: 2, fallas: 1 });
  });
  it("las filas no llevan textos de tareas ni la instrucción programada", () => {
    expect(JSON.stringify(filasDeRutinas([LEGAL], [], AHORA))).not.toMatch(/SECRETO/);
  });
});

describe("<CalendarioRutinas />", () => {
  const montar = (agentes = [MK, LEGAL, PAUSADA], tareas: TareaAgente[] = [corrida("t1", "mk1", 1, 7, 0), corrida("t2", "mk1", 2, 7, 0, "failed")], o: { onElegir?: (id: string) => void; onProgramar?: () => void } = {}) =>
    render(<MemoryRouter><CalendarioRutinas agentes={agentes} tareas={tareas} ahora={AHORA} {...o} /></MemoryRouter>);

  it("dibuja la semana con una fila por agente, marca hoy y dice cada celda con texto", () => {
    montar();
    expect(screen.getByTestId("rutinas-tabla")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Dom · hoy/ }).getAttribute("aria-current")).toBe("date");
    const fila = within(screen.getByTestId("rutina-mk1"));
    expect(fila.getAllByTestId("rutina-celda")).toHaveLength(2);
    expect(fila.getByLabelText("07:00, 1 corrida en 30 días")).toBeTruthy();
    expect(fila.getByLabelText("07:00, 1 corrida en 30 días, 1 con error")).toBeTruthy();
    expect(within(screen.getByTestId("rutina-lg1")).getByLabelText("Programada a las 08:30, aún sin corridas")).toBeTruthy();
    expect(screen.getByTestId("rutina-ps1").textContent).toMatch(/Pausada: Falló tres veces/);
  });
  it("los agentes de Marketing llevan a /marketing y los demás abren su ficha", () => {
    const onElegir = vi.fn();
    montar(undefined, undefined, { onElegir });
    expect(screen.getByTestId("rutina-nombre-mk1").getAttribute("href")).toBe("/marketing");
    fireEvent.click(screen.getByTestId("rutina-nombre-lg1"));
    expect(onElegir).toHaveBeenCalledWith("lg1");
  });
  it("muestra el resumen con cifras", () => {
    montar();
    expect(screen.getByTestId("rutinas-programadas").textContent).toBe("Programadas activas: 1");
    expect(screen.getByTestId("rutinas-observadas").textContent).toBe("Agentes con corridas solas: 1");
  });
  it("sin rutinas muestra el aviso y lleva a Programar", () => {
    const onProgramar = vi.fn();
    montar([MANUAL], [], { onProgramar });
    expect(screen.getByTestId("rutinas-vacio").textContent).toMatch(/Ningún agente tiene rutinas/);
    fireEvent.click(screen.getByTestId("rutinas-ir-programar"));
    expect(onProgramar).toHaveBeenCalled();
  });
});
