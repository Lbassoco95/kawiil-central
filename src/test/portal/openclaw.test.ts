import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { suggestCategory, parseSuggestion } from "../../../supabase/functions/_shared/portal/openclaw.ts";

const opts = [{ id: "c1", name: "Combustible" }, { id: "c2", name: "Restaurantes" }];
const cfdi = { nombreEmisor: "Gasolinera", rfcEmisor: "GAS010101AAA", descripcion: "Magna", claveProdServ: "15101514", total: 800 };

describe("salida al modelo por openclaw-gateway", () => {
  it("apagado sin OPENCLAW_GATEWAY_URL", async () => {
    const f = vi.fn();
    expect(await suggestCategory({ url: null, fetchImpl: f as unknown as typeof fetch }, cfdi, opts)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("solo acepta ids de la lista", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"category_id":"c1"}' } }] })));
    const s = await suggestCategory({ url: "http://gw.local", token: "t", fetchImpl: f as unknown as typeof fetch }, cfdi, opts);
    expect(s).toEqual({ categoryId: "c1", model: "openclaw:openclaw" });
    expect((f.mock.calls[0] as unknown[])[0]).toBe("http://gw.local/v1/chat/completions");
    expect(parseSuggestion('{"category_id":"inventada"}', opts)).toBeNull();
  });
  it("ningún archivo del portal llama directo a Anthropic, OpenAI o Google", () => {
    const roots = ["supabase/functions/_shared/portal", "src/portal", "src/components/portal-admin", "src/pages/portal-admin",
      "supabase/functions/portal-api", "supabase/functions/portal-notify", "supabase/functions/portal-dropbox-sync"];
    const files: string[] = [];
    const walk = (d: string) => {
      try {
        for (const n of readdirSync(d)) {
          const p = join(d, n);
          if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(n)) files.push(p);
        }
      } catch { /* carpeta aún no existe */ }
    };
    roots.forEach((r) => walk(resolve(process.cwd(), r)));
    expect(files.length).toBeGreaterThan(5);
    const bad = files.filter((f) => /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis|@anthropic-ai\/sdk|from ["']openai["']/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
