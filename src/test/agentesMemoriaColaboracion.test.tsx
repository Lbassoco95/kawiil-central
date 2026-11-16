import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoriaAgentes } from "@/components/agentes/MemoriaAgentes";
import { PlanoDepartamentos } from "@/components/agentes/PlanoDepartamentos";
import { llamadasEntreAgentes, origenDeTarea } from "@/lib/agentes/colaboracion";
import { figurasOficina } from "@/lib/agentes/oficina";
import type { AgenteRegistro, TareaAgente } from "@/lib/agentes/registro";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

const AHORA = new Date("2026-11-16T18:00:00Z");
const hace = (d: number) => new Date(AHORA.getTime() - d * 86_400_000).toISOString();
const ag = (id: string, name: string, o: Partial<AgenteRegistro> = {}): AgenteRegistro => ({ id, name, display_name: null, description: `Descripción de ${name}`, role: null, status: "idle", kind: "consultable", last_heartbeat: AHORA.toISOString(), last_task_at: null, tasks_completed: 0, tasks_failed: 0, ...o });
const ta = (id: string, agent_id: string | null, o: Partial<TareaAgente> = {}): TareaAgente => ({ id, agent_id, task_type: "manual", status: "completed", created_at: hace(1), started_at: null, completed_at: hace(1), source_task_id: null, ...o });

describe("colaboración entre agentes (lógica)", () => {
  const T = [
    ta("p1", "a1"), ta("h1", "a2", { source_task_id: "p1" }), ta("h2", "a2", { source_task_id: "p1", status: "failed", created_at: hace(2) }),
    ta("p2", "a2"), ta("h3", "a1", { source_task_id: "p2" }),
    ta("h4", "a1", { source_task_id: "p1" }),                 // mismo agente: no cuenta
    ta("h5", "a3", { source_task_id: "no-existe" }),          // padre desconocido: no cuenta
    ta("h6", "a2", { source_task_id: "p1", created_at: hace(45) }),   // fuera de 30 días
  ];
  it("cuenta pares padre → hijo de los últimos 30 días, ignora el mismo agente y padres desconocidos", () => {
    const l = llamadasEntreAgentes(T, AHORA);
    expect(l.map((x) => [x.de, x.a, x.veces, x.conError])).toEqual([["a1", "a2", 2, 1], ["a2", "a1", 1, 0]]);
  });
  it("sin enlaces no hay llamadas", () => { expect(llamadasEntreAgentes([ta("x", "a1"), ta("y", "a2")], AHORA)).toEqual([]); });
  it("origenDeTarea: agente padre, desconocido o ninguno", () => {
    expect(origenDeTarea(T[1], T)).toBe("a1"); expect(origenDeTarea(T[6], T)).toBe("desconocido");
    expect(origenDeTarea(T[0], T)).toBeNull(); expect(origenDeTarea(T[5], T)).toBeNull();
  });
});

describe("<PlanoDepartamentos /> colaboración", () => {
  const A = [ag("a1", "amatl"), ag("a2", "atl"), ag("a3", "nelli")];
  const T = [ta("p1", "a1"), ta("h1", "a2", { source_task_id: "p1" }), ta("h2", "a2", { source_task_id: "p1", status: "failed" })];
  const montar = (tareas: TareaAgente[]) => render(<PlanoDepartamentos figuras={figurasOficina(A, tareas, AHORA)} agentes={A} tareas={tareas} ahora={AHORA} />);
  it("dibuja la línea entre islas y lista quién llamó a quién; la tarea dice quién la pidió", () => {
    montar(T);
    expect(screen.getByTestId("llamada-a1-a2").textContent).toMatch(/2×/);
    expect(screen.getByTestId("plano-llamadas").textContent).toBe("amatl → atl · 2 veces en 30 días (1 con error)");
    expect(screen.getByTestId("plano-tarea-h1").textContent).toMatch(/pedida por amatl/);
    expect(screen.getByTestId("plano-tarea-p1").textContent).not.toMatch(/pedida por/);
  });
  it("sin llamadas muestra el aviso y ninguna línea", () => {
    montar([ta("p1", "a1")]);
    expect(screen.getByTestId("plano-sin-colaboracion").textContent).toMatch(/Aún no hay llamadas entre agentes/);
    expect(screen.queryByTestId("plano-llamadas")).toBeNull();
  });
});

const AGENTES = [ag("11111111-1111-4111-8111-111111111111", "amatl"), ag("22222222-2222-4222-8222-222222222222", "atl"), ag("33333333-3333-4333-8333-333333333333", "viejo", { status: "archived" })];
const M = (id: string, agent_id: string, o: Record<string, unknown> = {}) => ({ id, agent_id, tipo: "fact", categoria: "regulatorio", importancia: 7, activa: true, usos: 3, ultimo_uso: hace(1), vence: null, creada: hace(10), ...o });
const M1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", M2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function montarMemoria() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoriaAgentes agentes={AGENTES} ahora={AHORA} /></QueryClientProvider>);
}

describe("<MemoriaAgentes />", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (_fn: string, { body }: { body: Record<string, unknown> }) => {
      if (body.action === "listar") return { data: { memorias: [M(M1, AGENTES[0].id), M(M2, AGENTES[0].id, { tipo: "decision", categoria: null, importancia: 4, activa: false, usos: 1, vence: hace(3) })] }, error: null };
      return { data: { memoria: M(String(body.id), AGENTES[0].id, { activa: body.activa }) }, error: null };
    });
  });
  it("lista el resumen y, al elegir un agente, sus memorias sin ningún texto; no ofrece agentes archivados", async () => {
    montarMemoria();
    await waitFor(() => expect(screen.getByTestId("memoria-resumen").textContent).toMatch(/Memorias: 2.*Activas: 1.*Apagadas: 1.*Vencidas: 1/));
    expect(screen.queryByTestId("mem-sel-33333333-3333-4333-8333-333333333333")).toBeNull();
    expect(screen.getByTestId("mem-sel-11111111-1111-4111-8111-111111111111-detalle").textContent).toBe("1 activas · 1 apagadas");
    expect(screen.getByTestId("mem-sel-22222222-2222-4222-8222-222222222222-detalle").textContent).toBe("Sin memorias");
    fireEvent.click(screen.getByTestId("mem-sel-11111111-1111-4111-8111-111111111111"));
    const fila = screen.getByTestId(`memoria-${M1}`);
    expect(fila.textContent).toMatch(/Dato · regulatorio/); expect(fila.textContent).toMatch(/Importancia 7\/10 · usada 3 veces/);
    expect(screen.getByTestId(`memoria-${M2}`).textContent).toMatch(/Decisión · sin categoría.*venció hace 3 días.*apagada/);
    expect(invoke.mock.calls.every(([fn]) => fn === "agente-memoria")).toBe(true);
  });
  it("apagar y encender envían solo id y activa, y la fila se actualiza", async () => {
    montarMemoria();
    await waitFor(() => screen.getByTestId("mem-sel-11111111-1111-4111-8111-111111111111"));
    fireEvent.click(screen.getByTestId("mem-sel-11111111-1111-4111-8111-111111111111"));
    fireEvent.click(screen.getByTestId(`memoria-cambiar-${M1}`));
    await waitFor(() => expect(screen.getByTestId(`memoria-${M1}`).getAttribute("data-activa")).toBe("false"));
    expect(invoke).toHaveBeenCalledWith("agente-memoria", { body: { action: "cambiar", id: M1, activa: false } });
    fireEvent.click(screen.getByTestId(`memoria-cambiar-${M2}`));
    await waitFor(() => expect(screen.getByTestId(`memoria-${M2}`).getAttribute("data-activa")).toBe("true"));
    expect(invoke).toHaveBeenCalledWith("agente-memoria", { body: { action: "cambiar", id: M2, activa: true } });
  });
  it("una memoria que aún no vence dice en cuánto tiempo", async () => {
    invoke.mockImplementation(async () => ({ data: { memorias: [M(M1, AGENTES[0].id, { vence: hace(-5) })] }, error: null }));
    montarMemoria();
    await waitFor(() => screen.getByTestId("mem-sel-11111111-1111-4111-8111-111111111111"));
    fireEvent.click(screen.getByTestId("mem-sel-11111111-1111-4111-8111-111111111111"));
    expect(screen.getByTestId(`memoria-${M1}`).textContent).toMatch(/vence en 5 días/);
  });
  it("un agente sin memorias lo dice; si falla la lectura muestra el aviso", async () => {
    montarMemoria();
    await waitFor(() => screen.getByTestId("mem-sel-22222222-2222-4222-8222-222222222222"));
    fireEvent.click(screen.getByTestId("mem-sel-22222222-2222-4222-8222-222222222222"));
    expect(screen.getByTestId("memoria-vacia")).toBeTruthy();
  });
  it("si la lectura falla, avisa sin romper la pantalla", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("x") });
    montarMemoria();
    await waitFor(() => expect(screen.getByTestId("memoria-error").textContent).toMatch(/No se pudo leer la memoria/));
  });
  it("si falla el cambio, lo avisa y la memoria no cambia", async () => {
    montarMemoria();
    await waitFor(() => screen.getByTestId("mem-sel-11111111-1111-4111-8111-111111111111"));
    fireEvent.click(screen.getByTestId("mem-sel-11111111-1111-4111-8111-111111111111"));
    invoke.mockResolvedValue({ data: null, error: new Error("x") });
    fireEvent.click(screen.getByTestId(`memoria-cambiar-${M1}`));
    await waitFor(() => expect(screen.getByTestId("memoria-fallo")).toBeTruthy());
    expect(within(screen.getByTestId("memoria-lista")).getByTestId(`memoria-${M1}`).getAttribute("data-activa")).toBe("true");
  });
});
