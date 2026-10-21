import { describe, expect, it } from "vitest";
import { buildCierreMessage } from "../../supabase/functions/_shared/kawiilitoCierre";

describe("buildCierreMessage", () => {
  it("no molesta si no hay nada que cerrar", () => {
    expect(buildCierreMessage({ firstName: "Leo", dueNow: 0, overdue: 0, agreements: 0 })).toBeNull();
  });
  it("avisa de las tareas del día, con vencidas", () => {
    const m = buildCierreMessage({ firstName: "Leo", dueNow: 3, overdue: 1, agreements: 0 })!;
    expect(m.title).toBe("Kawiilito · Cierre del día");
    expect(m.body).toBe("Leo, te quedan 3 tareas del día (1 vencida): ciérralas o muévelas a mañana.");
  });
  it("singular", () => {
    const m = buildCierreMessage({ firstName: "Leo", dueNow: 1, overdue: 0, agreements: 0 })!;
    expect(m.body).toBe("Leo, te queda 1 tarea del día: ciérrala o muévela a mañana.");
  });
  it("menciona compromisos de juntas, solos o junto a las tareas", () => {
    expect(buildCierreMessage({ firstName: "Leo", dueNow: 0, overdue: 0, agreements: 2 })!.body).toBe(
      "Leo, 2 compromisos de juntas siguen sin tarea.",
    );
    expect(buildCierreMessage({ firstName: "", dueNow: 1, overdue: 0, agreements: 1 })!.body).toContain(
      "1 compromiso de juntas sigue sin tarea.",
    );
  });
});
