import { describe, expect, it } from "vitest";
import { dayPart, displayFirstName, mexicoHour } from "../../portal/lib/greeting";

describe("saludo header (México)", () => {
  it("parte el nombre demo Bassoco antes del separador", () => {
    expect(displayFirstName("Contacto demo · Bassoco SC")).toBe("Contacto demo");
  });

  it("cae al local del correo si no hay nombre", () => {
    expect(displayFirstName(null, "demo.cliente@kawiil-demo.invalid")).toBe("demo cliente");
  });

  it("asigna franja horaria con emoji", () => {
    // 2026-10-06 09:00 CDMX (UTC-6 en octubre sin DST en México)
    const manana = new Date("2026-10-06T15:00:00.000Z");
    expect(mexicoHour(manana)).toBe(9);
    expect(dayPart(manana)).toEqual({ greeting: "Buenos días", emoji: "☀️", hour: 9 });

    const tarde = new Date("2026-10-06T20:00:00.000Z");
    expect(dayPart(tarde).greeting).toBe("Buenas tardes");

    const noche = new Date("2026-10-07T04:00:00.000Z");
    expect(dayPart(noche).greeting).toBe("Buenas noches");
  });
});
