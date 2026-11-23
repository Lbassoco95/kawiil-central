import { describe, expect, it } from "vitest";
import { buildFoodCount, type FoodAttendee } from "./activityFoodCount";

const base: FoodAttendee = {
  name: "Viri", confirmed: "si", dietary_restriction: null, has_plus_one: false,
  plus_one_name: null, plus_one_confirmed: "pendiente", plus_one_dietary: null,
};

describe("buildFoodCount con invitados extra", () => {
  it("extras aprobados cuentan junto al invitado", () => {
    const c = buildFoodCount([{ ...base, has_plus_one: true, plus_one_confirmed: "si", extra_guests_requested: 2, extra_guests_status: "aprobado" }]);
    expect(c.confirmed).toHaveLength(4); // invitado + +1 + 2 extras
    expect(c.confirmedCompanions).toBe(3);
  });
  it("extras solicitados o rechazados no cuentan", () => {
    for (const status of ["solicitado", "rechazado", "none"]) {
      const c = buildFoodCount([{ ...base, extra_guests_requested: 2, extra_guests_status: status }]);
      expect(c.confirmed).toHaveLength(1);
    }
  });
  it("si el invitado no asiste, sus extras tampoco", () => {
    const c = buildFoodCount([{ ...base, confirmed: "no", extra_guests_requested: 2, extra_guests_status: "aprobado" }]);
    expect(c.confirmed).toHaveLength(0);
    expect(c.pending).toHaveLength(0);
  });
  it("sin los campos nuevos funciona igual que antes", () => {
    expect(buildFoodCount([base]).confirmed).toHaveLength(1);
  });
});
