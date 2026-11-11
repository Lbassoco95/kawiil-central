import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

// Una función de Supabase vacía se despliega «bien» y luego nunca responde (504). Esta prueba lo impide: cada función tiene que tener su
// index.ts con contenido y arrancar un servidor.
const RAIZ = join(process.cwd(), "supabase", "functions");
const funciones = readdirSync(RAIZ).filter((n) => !n.startsWith("_") && statSync(join(RAIZ, n)).isDirectory() && existsSync(join(RAIZ, n, "index.ts")));

describe("funciones de Supabase", () => {
  it("hay funciones que revisar", () => { expect(funciones.length).toBeGreaterThan(10); });
  it.each(funciones)("%s no está vacía y arranca un servidor", (nombre) => {
    const t = readFileSync(join(RAIZ, nombre, "index.ts"), "utf8");
    expect(t.trim().length, `${nombre}/index.ts está vacío`).toBeGreaterThan(50);
    expect(/\b(serve|Deno\.serve)\s*\(/.test(t), `${nombre}/index.ts no llama a serve()`).toBe(true);
  });
  it("agente-seguimiento tiene las acciones de encargos", () => {
    const t = readFileSync(join(RAIZ, "agente-seguimiento", "index.ts"), "utf8");
    for (const a of ["aprobar_plan", "cancelar_encargo", "programar_revision", "descargar"]) expect(t).toContain(a);
  });
});
