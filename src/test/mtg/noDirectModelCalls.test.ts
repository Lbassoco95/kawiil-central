import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BAD = [
  /api\.anthropic\.com/i,
  /api\.openai\.com/i,
  /generativelanguage\.googleapis\.com/i,
];
const ROOTS = ["src/lib/mtg", "supabase/functions/mtg-outlook", "supabase/functions/mtg-graph-admin", "supabase/functions/mtg-graph-webhook", "supabase/functions/job-queue-dispatch", "worker/mtg"];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|md)$/.test(name)) out.push(p);
  }
  return out;
}

describe("mtg: cero llamadas directas a modelos", () => {
  it("no hay URLs de Anthropic/OpenAI/Google en código mtg/worker", () => {
    const files = ROOTS.flatMap((r) => walk(join(ROOT, r)));
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const re of BAD) {
        if (re.test(text)) hits.push(`${relative(ROOT, f)}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
