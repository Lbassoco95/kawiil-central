import { describe, it, expect } from "vitest";
import { ASPECTOS, PERFILES } from "@/lib/agentes/personajesDatos";
import { dibujoAccesorios, nivelDe, textoAccesorios } from "@/lib/agentes/personajes";
import { ALTO, ANCHO, spriteAgente } from "@/lib/agentes/sprites";

describe("personajes", () => {
  it("el nivel se calcula con las tareas hechas: <10 aprendiz, 10–24 oficial, ≥25 experto", () => {
    expect([0, 9, 10, 24, 25, 300].map(nivelDe)).toEqual(["aprendiz", "aprendiz", "oficial", "oficial", "experto", "experto"]);
    expect(nivelDe(null)).toBe("aprendiz");
    expect(nivelDe(-3)).toBe("aprendiz");
  });
  it("hay aspecto y perfil para los 29 agentes, con las mismas claves", () => {
    expect(Object.keys(ASPECTOS)).toHaveLength(29);
    expect(Object.keys(PERFILES).sort()).toEqual(Object.keys(ASPECTOS).sort());
    for (const a of Object.values(ASPECTOS)) { expect(a.piel).toMatch(/^#[0-9a-f]{6}$/i); expect(a.pelo).toMatch(/^#[0-9a-f]{6}$/i); }
  });
  it("los accesorios aceptan color y los desconocidos no dibujan nada", () => {
    expect(dibujoAccesorios(["scarf:#8a6a4a"], "#000000")[0].fill).toBe("#8a6a4a");
    expect(dibujoAccesorios(["nada"], "#000000")).toEqual([]);
    expect(dibujoAccesorios(["beard"], "#123456").some((d) => d.fill === "#123456")).toBe(true);
    expect(textoAccesorios(["glasses", "badge:#fff"])).toBe("lentes redondos y gafete");
  });
  it("un agente conocido usa su aspecto fijo y un desconocido trae un accesorio determinista", () => {
    const clave = Object.keys(ASPECTOS)[0];
    const conocido = spriteAgente("sentado", "id-1", "#9cc5a1", clave);
    expect(spriteAgente("sentado", "otro-id", "#9cc5a1", clave).accesorios).toEqual(conocido.accesorios);
    expect(spriteAgente("sentado", "zzz", "#9cc5a1", "no_existe")).toEqual(spriteAgente("sentado", "zzz", "#9cc5a1", "no_existe"));
  });
  it("el escritorio tiene patas dentro de la cuadrícula (23 filas)", () => {
    expect(ALTO).toBe(23);
    const f = spriteAgente("trabajando", "x", "#8fb4d9").frames[0];
    expect(f.some((r) => r.c === "#9b7550" && r.y + r.h === ALTO)).toBe(true);
    expect(f.every((r) => r.x + r.w <= ANCHO)).toBe(true);
  });
});
