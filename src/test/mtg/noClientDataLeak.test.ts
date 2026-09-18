/**
 * Falla si aparecen nombres de clientes reales en código nuevo de Múuch'
 * (fuera de tools/mtg/seed/ y docs/mtg/).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const FORBIDDEN = [/\bVizum\b/i, /\bSylon\b/i, /\bRivium\b/i];
/** Sólo escanea código del módulo mtg de esta corrida — no compliance histórico. */
const SCAN_ROOTS = [
  "src/lib/mtg",
  "src/hooks",
  "src/pages",
  "src/components/clients",
  "src/test/mtg",
  "supabase/functions/mtg-outlook",
  "supabase/functions/mtg-graph-admin",
  "supabase/functions/mtg-graph-webhook",
  "supabase/functions/job-queue-dispatch",
  "supabase/migrations",
  "worker/mtg",
  "tools/mtg",
];

const SKIP = ["tools/mtg/seed", "docs/mtg", "node_modules"];

function shouldSkip(rel: string): boolean {
  return SKIP.some((s) => rel === s || rel.startsWith(s + "/"));
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(ROOT, p).replace(/\\/g, "/");
    if (shouldSkip(rel)) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|sql|md)$/.test(name)) {
      if (rel.startsWith("supabase/migrations/") && !/mtg_|job_queue/.test(name)) continue;
      if (rel.startsWith("src/hooks/") && !/Mtg|mtg/.test(name)) continue;
      if (rel.startsWith("src/pages/") && !/Junta|Grupo|juntas|grupos/i.test(name)) continue;
      if (rel.startsWith("src/components/clients/") && !/Mtg|Meeting/.test(name)) continue;
      out.push(p);
    }
  }
  return out;
}

describe("mtg: no versionar datos de cliente reales", () => {
  it("no menciona Vizum/Sylon/Rivium en código mtg (salvo seed/docs)", () => {
    const files = SCAN_ROOTS.flatMap((r) => walk(join(ROOT, r)));
    const hits: string[] = [];
    for (const f of files) {
      if (f.endsWith("noClientDataLeak.test.ts")) continue;
      const text = readFileSync(f, "utf8");
      for (const re of FORBIDDEN) {
        if (re.test(text)) hits.push(`${relative(ROOT, f)} ~ ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
