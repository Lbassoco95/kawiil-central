import { describe, it, expect } from "vitest";
import { ALTO, ANCHO, aRects, aspectoDe, oscurecer, spriteAgente } from "@/lib/agentes/sprites";
import type { EstadoOficina } from "@/lib/agentes/oficina";

const ESTADOS: EstadoOficina[] = ["trabajando", "celebrando", "con_error", "atascado", "sentado", "descansando", "apagado"];
const dentro = (rs: { x: number; y: number; w: number; h: number }[]) => rs.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= ANCHO && r.y + r.h <= ALTO);

describe("sprites de pixel art", () => {
  it("todos los estados dibujan algo dentro de la cuadrícula", () => {
    for (const e of ESTADOS) {
      const s = spriteAgente(e, "agente-x", "#9cc5a1");
      expect(s.frames.length).toBeGreaterThan(0);
      for (const f of s.frames) { expect(f.length).toBeGreaterThan(20); expect(dentro(f)).toBe(true); }
      expect(dentro(s.emote)).toBe(true);
    }
  });
  it("trabajando, celebrando y sentado tienen dos cuadros distintos; los demás uno", () => {
    for (const e of ["trabajando", "celebrando", "sentado"] as const) {
      const s = spriteAgente(e, "a", "#8fb4d9");
      expect(s.frames).toHaveLength(2);
      expect(JSON.stringify(s.frames[0])).not.toBe(JSON.stringify(s.frames[1]));
    }
    for (const e of ["con_error", "atascado", "descansando", "apagado"] as const) expect(spriteAgente(e, "a", "#8fb4d9").frames).toHaveLength(1);
  });
  it("los estados con aviso traen emoticono y los tranquilos no", () => {
    expect(spriteAgente("con_error", "a", "#cccccc").emote.length).toBeGreaterThan(0);
    expect(spriteAgente("atascado", "a", "#cccccc").emote.length).toBeGreaterThan(0);
    expect(spriteAgente("descansando", "a", "#cccccc").emote.length).toBeGreaterThan(0);
    expect(spriteAgente("celebrando", "a", "#cccccc").emote.length).toBeGreaterThan(0);
    expect(spriteAgente("trabajando", "a", "#cccccc").emote).toHaveLength(0);
  });
  it("es determinista y cada agente tiene su aspecto", () => {
    expect(spriteAgente("sentado", "nelli", "#b5c9a8")).toEqual(spriteAgente("sentado", "nelli", "#b5c9a8"));
    const aspectos = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((i) => JSON.stringify(aspectoDe(i, "#ffffff"))));
    expect(aspectos.size).toBeGreaterThan(4);
  });
  it("aRects junta píxeles contiguos del mismo color y respeta el último dibujado", () => {
    expect(aRects([{ x: 0, y: 0, c: "#111111" }, { x: 1, y: 0, c: "#111111" }, { x: 2, y: 0, c: "#222222" }])).toEqual([
      { x: 0, y: 0, w: 2, h: 1, c: "#111111" }, { x: 2, y: 0, w: 1, h: 1, c: "#222222" }]);
    expect(aRects([{ x: 0, y: 0, c: "#111111" }, { x: 0, y: 0, c: "#333333" }])).toEqual([{ x: 0, y: 0, w: 1, h: 1, c: "#333333" }]);
  });
  it("oscurecer se mantiene en rango", () => { expect(oscurecer("#ffffff", 0.5)).toBe("#808080"); expect(oscurecer("#ffffff", 2)).toBe("#ffffff"); });
});
