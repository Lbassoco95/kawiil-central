import { describe, expect, it } from "vitest";
import { formatDistance, googleMapsUrl, osmEmbedUrl, toCoord } from "@/lib/rh";

describe("helpers de ubicación de jornada", () => {
  it("toCoord acepta number y string numérico; descarta vacíos", () => {
    expect(toCoord(19.4326)).toBe(19.4326);
    expect(toCoord("-99.133200")).toBe(-99.1332);
    expect(toCoord(null)).toBeNull();
    expect(toCoord(undefined)).toBeNull();
    expect(toCoord("")).toBeNull();
    expect(toCoord("abc")).toBeNull();
  });

  it("arma enlaces de mapa con la coordenada", () => {
    expect(googleMapsUrl(19.4326, -99.1332)).toBe(
      "https://www.google.com/maps/search/?api=1&query=19.4326,-99.1332",
    );
    const osm = osmEmbedUrl(19.4326, -99.1332);
    expect(osm).toContain("marker=19.4326,-99.1332");
    expect(osm).toContain("bbox=-99.137200,19.428600,-99.129200,19.436600");
  });

  it("formatDistance usa m o km", () => {
    expect(formatDistance(84.6)).toBe("85 m");
    expect(formatDistance(1234)).toBe("1.2 km");
    expect(formatDistance(25_400)).toBe("25 km");
  });
});
