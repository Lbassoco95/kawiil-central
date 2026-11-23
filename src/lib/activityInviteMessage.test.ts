import { describe, expect, it } from "vitest";
import { inviteeMessage, withLink, LINK_PLACEHOLDER } from "./activityInviteMessage";

const f = { name: "Fin de Año 2026", fecha: "viernes 18 de diciembre de 2026", hora: "15:00:00", lugar: "Chinaco 62" };

describe("inviteeMessage / withLink", () => {
  it("el mensaje trae el marcador del enlace y los datos del evento", () => {
    const m = inviteeMessage(f);
    expect(m).toContain(LINK_PLACEHOLDER);
    expect(m).toContain("Hora: 15:00 h");
    expect(m).toContain("Lugar: Chinaco 62");
  });
  it("sustituye el marcador por el enlace de cada persona", () => {
    const m = withLink(inviteeMessage(f), "https://x.mx/invitacion/abc");
    expect(m).toContain("https://x.mx/invitacion/abc");
    expect(m).not.toContain(LINK_PLACEHOLDER);
  });
  it("si se borró el marcador, agrega el enlace al final", () => {
    expect(withLink("Hola\n", "https://x.mx/i/1")).toBe("Hola\n\nhttps://x.mx/i/1");
  });
});
