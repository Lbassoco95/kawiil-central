import { describe, expect, it } from "vitest";
import { describirHorario, horaAmigable, normalizarHora, validarHorario } from "./horarioSilencio";

describe("normalizarHora", () => {
  it("quita los segundos que devuelve la base de datos", () => {
    expect(normalizarHora("22:00:00")).toBe("22:00");
    expect(normalizarHora("7:05")).toBe("07:05");
  });
  it("rechaza lo que no es una hora", () => {
    expect(normalizarHora("24:00")).toBeNull();
    expect(normalizarHora("10pm")).toBeNull();
    expect(normalizarHora(null)).toBeNull();
    expect(normalizarHora("")).toBeNull();
  });
});

describe("horaAmigable / describirHorario", () => {
  it("escribe las horas como se dicen en voz alta", () => {
    expect(horaAmigable("22:00")).toBe("10:00 pm");
    expect(horaAmigable("07:30")).toBe("7:30 am");
    expect(horaAmigable("00:00")).toBe("12:00 am");
    expect(horaAmigable("12:00")).toBe("12:00 pm");
  });
  it("describe el horario completo", () => {
    expect(describirHorario("22:00:00", "07:00:00")).toBe("De 10:00 pm a 7:00 am");
  });
});

describe("validarHorario", () => {
  it("acepta un horario que cruza la medianoche", () => {
    expect(validarHorario("22:00", "07:00")).toEqual({ ok: true, inicio: "22:00", fin: "07:00", motivo: "" });
  });
  it("normaliza los segundos de la base de datos", () => {
    expect(validarHorario("22:00:00", "07:00:00")).toMatchObject({ ok: true, inicio: "22:00", fin: "07:00" });
  });
  it("rechaza inicio igual a fin y horas inválidas, explicando por qué", () => {
    expect(validarHorario("22:00", "22:00")).toMatchObject({ ok: false, motivo: expect.stringContaining("misma") });
    expect(validarHorario("", "07:00")).toMatchObject({ ok: false, motivo: expect.stringContaining("válida") });
  });
});
