import { describe, expect, it } from "vitest";
import { buildGuestOverview, type GuestAttendee } from "./activityGuestOverview";

const invitado = (partial: Partial<GuestAttendee> & Pick<GuestAttendee, "name" | "confirmed">): GuestAttendee => ({
  has_plus_one: false,
  ...partial,
});

describe("buildGuestOverview", () => {
  it("resume invitados, +1 con nombre y extras aprobados", () => {
    const overview = buildGuestOverview([
      invitado({ name: "Administración", confirmed: "pendiente" }),
      invitado({ name: "Polo", confirmed: "si" }),
      invitado({
        name: "Viri", confirmed: "si", has_plus_one: true,
        plus_one_name: "Rebeca Meneses", plus_one_confirmed: "si", plus_one_dietary: "No",
      }),
      invitado({
        name: "Jesús", confirmed: "si", has_plus_one: true,
        plus_one_name: "Mayra", plus_one_confirmed: "si",
        plus_one_dietary: "Pulpo, panza, zetas, surimi",
      }),
      invitado({ name: "Montse", confirmed: "pendiente" }),
      invitado({ name: "Erik", confirmed: "pendiente" }),
      invitado({ name: "Alan", confirmed: "pendiente" }),
      invitado({ name: "Fernando", confirmed: "pendiente" }),
      invitado({
        name: "Adriana", confirmed: "si", has_plus_one: true,
        plus_one_name: "Juan Noé García", plus_one_confirmed: "si",
        extra_guests_requested: 1, extra_guests_status: "aprobado",
        extra_guests_note: "Francisco Manuel, no es alérgico a nada",
      }),
    ]);

    expect(overview.invitadosTotal).toBe(9);
    expect(overview.confirman).toBe(4);
    expect(overview.pendientes).toBe(5);
    expect(overview.noAsisten).toBe(0);
    expect(overview.vienen).toBe(8);
    expect(overview.porConfirmar).toBe(5);
    expect(overview.plusOnes.map((p) => p.name)).toEqual([
      "Rebeca Meneses", "Mayra", "Juan Noé García",
    ]);
    expect(overview.plusOnes[1].dietary).toBe("Pulpo, panza, zetas, surimi");
    expect(overview.extras).toHaveLength(1);
    expect(overview.extras[0].note).toMatch(/Francisco Manuel/);
  });

  it("un +1 sin nombre se cuenta aparte y no entra a la lista", () => {
    const overview = buildGuestOverview([
      invitado({
        name: "Polo", confirmed: "si", has_plus_one: true, plus_one_confirmed: "pendiente",
      }),
    ]);
    expect(overview.plusOnes).toHaveLength(0);
    expect(overview.plusSinNombre).toBe(1);
    expect(overview.vienen).toBe(1);
    expect(overview.porConfirmar).toBe(1);
  });

  it("si el invitado no asiste, su +1 y sus extras no vienen", () => {
    const overview = buildGuestOverview([
      invitado({
        name: "Erik", confirmed: "no", has_plus_one: true,
        plus_one_name: "Ana", plus_one_confirmed: "si",
        extra_guests_requested: 2, extra_guests_status: "aprobado",
      }),
    ]);
    expect(overview.vienen).toBe(0);
    expect(overview.porConfirmar).toBe(0);
    expect(overview.noAsisten).toBe(1);
    expect(overview.plusOnes[0]).toMatchObject({ name: "Ana", hostDeclined: true });
  });

  it("un extra solicitado no suma personas y sí cuenta como por aprobar", () => {
    const overview = buildGuestOverview([
      invitado({
        name: "Viri", confirmed: "si",
        extra_guests_requested: 2, extra_guests_status: "solicitado",
      }),
    ]);
    expect(overview.vienen).toBe(1);
    expect(overview.porAprobar).toBe(1);
  });

  it("lista vacía", () => {
    const overview = buildGuestOverview([]);
    expect(overview.invitadosTotal).toBe(0);
    expect(overview.vienen).toBe(0);
    expect(overview.plusOnes).toEqual([]);
  });
});
