import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `supabase_migrations.schema_migrations` tiene la VERSIÓN (el prefijo de 14
 * dígitos del nombre) como llave primaria. Dos archivos con el mismo prefijo
 * rompen el despliegue de dos maneras, ambas malas:
 *
 *  · Si ninguno está aplicado, el segundo nunca puede registrarse y
 *    `db push --include-all` muere ahí, bloqueando TODO el pipeline.
 *    Ya pasó en el PR #309 (20260729170000 duplicado).
 *  · Si uno ya está aplicado en remoto, el CLI da la versión por aplicada y
 *    el otro archivo NUNCA se ejecuta, en silencio. Este es el peor: el
 *    despliegue sale verde y las tablas no existen.
 *
 * Como los timestamps se eligen a mano y las ramas viven en paralelo, la
 * colisión es cuestión de tiempo. Esta prueba la encuentra antes del merge.
 */
describe("versiones de migración", () => {
  const dir = resolve(process.cwd(), "supabase/migrations");
  const archivos = readdirSync(dir).filter((f) => f.endsWith(".sql"));

  it("hay migraciones que revisar", () => {
    expect(archivos.length).toBeGreaterThan(0);
  });

  it("todas siguen la convención YYYYMMDDHHMMSS_slug.sql", () => {
    const malFormados = archivos.filter((f) => !/^\d{14}_.+\.sql$/.test(f));
    expect(malFormados).toEqual([]);
  });

  it("ninguna versión está repetida", () => {
    const porVersion = new Map<string, string[]>();
    for (const f of archivos) {
      const version = f.slice(0, 14);
      porVersion.set(version, [...(porVersion.get(version) ?? []), f]);
    }
    const repetidas = [...porVersion.entries()]
      .filter(([, fs]) => fs.length > 1)
      .map(([version, fs]) => `${version}: ${fs.join(" + ")}`);

    expect(repetidas).toEqual([]);
  });
});
