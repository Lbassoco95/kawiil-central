import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * El portal es un build separado del back-office: no incluye su código ni sus
 * rutas. Solo puede importar su propio código, componentes genéricos de UI,
 * utilidades, el cliente público de Supabase y los módulos puros del portal.
 */
const ALLOWED = [
  /^\.\.?\//,
  /^@\/components\/ui\//,
  /^@\/lib\/utils$/,
  /^@\/lib\/juun\/receiptStatus$/,
  /^@\/integrations\/supabase\/client$/,
  /^react(-dom)?(\/.*)?$/,
  /^react-router-dom$/,
  /^react-markdown$/,
  /^lucide-react$/,
  /^heic2any$/,
  /^@supabase\/supabase-js$/,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("frontera del build del portal", () => {
  const root = resolve(process.cwd(), "src/portal");
  const all = files(root);
  it("hay código de portal que revisar", () => expect(all.length).toBeGreaterThan(10));
  it("no importa páginas, layouts, contextos ni hooks de central", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const f of all) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
        const spec = m[1] ?? m[2];
        checked++;
        if (spec.startsWith("../") && !spec.includes("supabase/functions/_shared/portal") && !/^\.\.\/(lib|components|pages)\//.test(spec) && !spec.startsWith("./")) {
          // relativo que sale de src/portal: solo hacia los módulos compartidos del portal
          const target = resolve(f, "..", spec);
          if (!target.startsWith(root) && !target.includes("supabase/functions/_shared/portal")) bad.push(`${f}: ${spec}`);
          continue;
        }
        if (!ALLOWED.some((re) => re.test(spec))) bad.push(`${f}: ${spec}`);
      }
    }
    expect(checked).toBeGreaterThan(80);
    expect(bad).toEqual([]);
  });
  it("el back-office no importa el portal", () => {
    const central = files(resolve(process.cwd(), "src")).filter((f) => !f.includes(`${"src"}/portal/`) && !f.includes("/test/"));
    const bad = central.filter((f) => /from ["']@\/portal\//.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
