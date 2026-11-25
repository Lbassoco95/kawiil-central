import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const real = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (...a: unknown[]) => real.from(...a), functions: { invoke: (...a: unknown[]) => real.invoke(...a) } } }));

type Modulo = typeof import("@/pruebas/modoPrueba");
let m: Modulo;
let cliente: { from: (t: string) => Record<string, (...a: unknown[]) => unknown>; functions: { invoke: (n: string, o?: { body?: unknown }) => Promise<{ data: unknown; error: unknown }> } };
beforeEach(async () => {
  real.invoke.mockReset(); real.from.mockReset();
  real.invoke.mockResolvedValue({ data: "REAL", error: null });
  real.from.mockReturnValue({ select: () => "REAL", insert: () => "ESCRIBIÓ", update: () => "ESCRIBIÓ", upsert: () => "ESCRIBIÓ", delete: () => "ESCRIBIÓ" });
  vi.resetModules();
  m = await import("@/pruebas/modoPrueba");
  const { supabase } = await import("@/integrations/supabase/client");
  cliente = supabase as never;
  m.instalar(cliente);
});

const A = { vizumi: "00000000-0000-4000-8000-000000000001", vigilante: "00000000-0000-4000-8000-000000000002" };
const inv = (n: string, body: unknown) => cliente.functions.invoke(n, { body });

describe("modo de prueba · nada sale a la red ni se guarda", () => {
  it("las funciones del módulo Agentes responden con datos de ejemplo y no llaman a la real", async () => {
    for (const f of ["agente-seguimiento", "agente-constructor", "dispatch-to-agent", "agente-memoria"]) await inv(f, { action: "listar" });
    expect(real.invoke).not.toHaveBeenCalled();
    const r = (await inv("agente-seguimiento", { action: "listar" })).data as { tareas: Array<{ agente: string }> };
    expect(r.tareas.length).toBeGreaterThan(3);
    expect(r.tareas.some((t) => t.agente === "Vigilante SITI")).toBe(true);
  });
  it("las lecturas de las tablas de agentes salen del ejemplo y no de la base", async () => {
    const ags = (await (cliente.from("agent_registry").select() as Promise<{ data: Array<{ name: string }> }>)).data;
    expect(ags.map((a) => a.name)).toContain("vigilante_siti");
    const ts = (await (cliente.from("agent_tasks").select("id").limit(300) as Promise<{ data: unknown[] }>)).data;
    expect(ts.length).toBeGreaterThan(3);
    expect(real.from).not.toHaveBeenCalled();
  });
  it("cualquier otra función sigue su camino normal", async () => {
    const r = await inv("otra-funcion", {});
    expect(r.data).toBe("REAL"); expect(real.invoke).toHaveBeenCalledTimes(1);
  });
  it("en las demás tablas se lee normal pero ninguna escritura sale", async () => {
    const t = cliente.from("clientes");
    expect(t.select()).toBe("REAL");
    for (const w of ["insert", "update", "upsert", "delete"]) {
      const r = await (t[w]({ x: 1 }) as Promise<{ error: { message: string } }>);
      expect(r.error.message).toContain("Modo de prueba");
    }
    // el constructor de la real no se ejecutó para ninguna escritura
    expect(real.from).toHaveBeenCalledTimes(1);
  });
  it("escribir en las tablas de agentes tampoco guarda nada", async () => {
    const r = await (cliente.from("agent_registry").update({ status: "x" }) as Promise<{ error: { message: string } }>);
    expect(r.error.message).toContain("Modo de prueba");
  });
});

describe("modo de prueba · la pantalla se puede probar de verdad", () => {
  it("enviar un mensaje agrega la solicitud al ejemplo (en memoria) y aparece en el hilo", async () => {
    const ok = await inv("dispatch-to-agent", { agent_id: A.vigilante, title: "Hola", instructions: "Hola de prueba" });
    const id = (ok.data as { task_id: string }).task_id;
    const hilo = (await inv("agente-seguimiento", { action: "hilo", task_id: id })).data as { mensajes: Array<{ texto: string }> };
    expect(hilo.mensajes.map((x) => x.texto)).toContain("Hola de prueba");
  });
  it("pausar al agente hace que se le rechacen tareas, y reanudarlo las acepta", async () => {
    await inv("agente-constructor", { action: "pausar", agent_id: A.vigilante, pausado: true });
    const no = await inv("dispatch-to-agent", { agent_id: A.vigilante, title: "t", instructions: "i" });
    expect(no.error).toBeTruthy();
    await inv("agente-constructor", { action: "pausar", agent_id: A.vigilante, pausado: false });
    expect((await inv("dispatch-to-agent", { agent_id: A.vigilante, title: "t", instructions: "i" })).error).toBeNull();
  });
  it("habilitar quita el Solo lectura del agente creado por otro agente (y solo a quien lo necesita)", async () => {
    const antes = (await (cliente.from("agent_registry").select() as Promise<{ data: Array<{ id: string; config: unknown }> }>)).data.find((a) => a.id === A.vigilante)!;
    expect(m.soloLectura(antes.config as never)).toBe(true);
    await inv("agente-constructor", { action: "habilitar", agent_id: A.vigilante });
    const desp = (await (cliente.from("agent_registry").select() as Promise<{ data: Array<{ id: string; config: unknown }> }>)).data.find((a) => a.id === A.vigilante)!;
    expect(m.soloLectura(desp.config as never)).toBe(false);
    expect((await inv("agente-constructor", { action: "habilitar", agent_id: A.vizumi })).error).toBeTruthy();   // Vizumi no está en Solo lectura
  });
  it("crear, programar y demás acciones de escritura del Constructor no guardan nada", async () => {
    expect((await inv("agente-constructor", { action: "crear", propuesta: {} })).error).toBeTruthy();
    expect((await inv("agente-memoria", { action: "cambiar", id: "x", activa: false })).error).toBeTruthy();
  });
});

describe("modo de prueba · solo en vistas previas y desarrollo", () => {
  const leer = (r: string) => readFileSync(join(__dirname, "..", r), "utf8");
  it("solo se importa de forma dinámica y detrás de `__PRUEBA_DISPONIBLE__` (así el build de producción lo elimina)", () => {
    expect(leer("main.tsx")).toMatch(/if \(__PRUEBA_DISPONIBLE__\) void import\("\.\/pruebas\/modoPrueba"\)/);
    const app = leer("App.tsx");
    expect(app).toMatch(/__PRUEBA_DISPONIBLE__ \? lazy\(\(\) => import\("\.\/pruebas\/PruebaAgentes"\)\) : null/);
    expect(app).not.toMatch(/^import .* from "\.\/pruebas/m);
  });
  it("ningún otro archivo de la app lo importa", () => {
    const salida = execSync(`grep -rln "pruebas/" ${join(__dirname, "..")} --include=*.ts --include=*.tsx || true`).toString().split("\n").filter(Boolean);
    const permitidos = ["main.tsx", "App.tsx", "agentesPrueba.test.ts", "pruebas/modoPrueba.ts", "pruebas/PruebaAgentes.tsx", "pruebas/datosEjemplo.ts"];
    expect(salida.filter((f: string) => !permitidos.some((p) => f.endsWith(p)))).toEqual([]);
  });
  it("el ejemplo no trae datos reales: los nombres e identificadores son inventados", async () => {
    const { crearEstado } = await import("@/pruebas/datosEjemplo");
    const e = crearEstado();
    expect(e.agentes.every((a) => /^00000000-0000-4000-8000-/.test(a.id))).toBe(true);
    expect(JSON.stringify(e)).not.toMatch(/@|https?:|op:\/\//);
  });
});
