import { describe, expect, it } from "vitest";
import { kawiilitoState, type KawiilitoInput } from "./kawiilito";

const base: KawiilitoInput = {
  firstName: "Leo",
  phase: "manana",
  tasksCount: 4,
  dueNow: 0,
  overdueCount: 0,
  completedToday: 0,
  agreementsPending: 0,
  generating: false,
  firstVisitToday: false,
};

describe("kawiilitoState", () => {
  it("piensa mientras se genera el briefing", () => {
    expect(kawiilitoState({ ...base, generating: true, firstVisitToday: true }).pose).toBe("piensa");
  });
  it("saluda en la primera visita del día", () => {
    const s = kawiilitoState({ ...base, firstVisitToday: true });
    expect(s.pose).toBe("saluda");
    expect(s.line).toContain("Leo");
  });
  it("al cierre empuja a cerrar las tareas del día", () => {
    const s = kawiilitoState({ ...base, phase: "cierre", dueNow: 2 });
    expect(s.pose).toBe("tareas");
    expect(s.line).toContain("2 tareas");
  });
  it("celebra el día cerrado", () => {
    expect(kawiilitoState({ ...base, phase: "cierre", completedToday: 3 }).pose).toBe("celebra");
  });
  it("avisa de compromisos de juntas sin tarea y enlaza a juntas", () => {
    const s = kawiilitoState({ ...base, agreementsPending: 1 });
    expect(s.pose).toBe("piensa");
    expect(s.href).toBe("/juntas");
    expect(s.line).toContain("1 compromiso ");
  });
  it("los compromisos pendientes impiden celebrar al cierre", () => {
    expect(kawiilitoState({ ...base, phase: "cierre", completedToday: 3, agreementsPending: 2 }).pose).toBe("piensa");
  });
  it("menciona las vencidas y cae en un mensaje tranquilo por defecto", () => {
    expect(kawiilitoState({ ...base, overdueCount: 2 }).line).toContain("2 tareas vencidas");
    expect(kawiilitoState(base).line).toBe("Todo en orden. Sigo pendiente por ti.");
  });
});
