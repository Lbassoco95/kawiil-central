import { describe, expect, it } from "vitest";
import { buildCierreMessage, parseCierreOptions } from "../../supabase/functions/_shared/kawiilitoCierre";

describe("buildCierreMessage", () => {
  const msg = (dueNow: number, overdue: number, agreements: number, firstName = "Leo") =>
    buildCierreMessage({ firstName, dueNow, overdue, agreements });

  it("no molesta si no hay nada que cerrar", () => {
    expect(msg(0, 0, 0)).toBeNull();
  });
  it("tareas del día sin vencidas", () => {
    expect(msg(3, 0, 0)!.title).toBe("Kawiilito · Cierre del día");
    expect(msg(3, 0, 0)!.body).toBe("Leo, te quedan 3 tareas por cerrar hoy: ciérralas o muévelas a mañana.");
    expect(msg(1, 0, 0)!.body).toBe("Leo, te queda 1 tarea por cerrar hoy: ciérrala o muévela a mañana.");
  });
  it("mezcla de tareas de hoy y vencidas", () => {
    expect(msg(3, 2, 0)!.body).toBe("Leo, tienes 3 tareas por cerrar, 2 de ellas vencidas: ciérralas o muévelas a mañana.");
    expect(msg(3, 1, 0)!.body).toContain("1 de ellas vencida:");
  });
  it("todas vencidas no se contradice con «del día»", () => {
    expect(msg(2, 2, 0)!.body).toBe("Leo, tienes 2 tareas vencidas por cerrar: ciérralas o muévelas a mañana.");
    expect(msg(1, 1, 0)!.body).toBe("Leo, tienes 1 tarea vencida por cerrar: ciérrala o muévela a mañana.");
  });
  it("con muchas pendientes omite el desglose de vencidas", () => {
    expect(msg(12, 9, 0)!.body).toBe("Leo, tienes 12 tareas por cerrar: ciérralas o muévelas a mañana.");
  });
  it("compromisos de juntas: solos invitan a convertirlos; junto a tareas, no", () => {
    expect(msg(0, 0, 4)!.body).toBe("Leo, 4 compromisos de juntas siguen sin tarea. Conviértelos en tarea cuando puedas.");
    expect(msg(0, 0, 1)!.body).toBe("Leo, 1 compromiso de juntas sigue sin tarea. Conviértelo en tarea cuando puedas.");
    expect(msg(1, 0, 2)!.body).toBe(
      "Leo, te queda 1 tarea por cerrar hoy: ciérrala o muévela a mañana. 2 compromisos de juntas siguen sin tarea.",
    );
  });
  it("sin nombre arranca en mayúscula", () => {
    expect(msg(1, 0, 0, "")!.body).toBe("Te queda 1 tarea por cerrar hoy: ciérrala o muévela a mañana.");
  });
});

describe("parseCierreOptions", () => {
  const ID = "123e4567-e89b-12d3-a456-426614174000";
  it("por defecto envía a todos", () => {
    expect(parseCierreOptions({})).toEqual({ dryRun: false, onlyUserId: null });
    expect(parseCierreOptions(null)).toEqual({ dryRun: false, onlyUserId: null });
  });
  it("lee dry_run y only_user_id válidos", () => {
    expect(parseCierreOptions({ dry_run: true, only_user_id: ID })).toEqual({ dryRun: true, onlyUserId: ID });
  });
  it("ignora valores que no entiende", () => {
    expect(parseCierreOptions({ dry_run: "true", only_user_id: "todos" })).toEqual({ dryRun: false, onlyUserId: null });
  });
});
