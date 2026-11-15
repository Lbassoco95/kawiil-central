import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BarraTareas } from "@/components/agentes/BarraTareas";
import { palabrasClave, sugerirAgentes, tituloDe } from "@/lib/agentes/enrutar";
import type { AgenteRegistro } from "@/lib/agentes/registro";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

const ag = (id: string, name: string, description: string | null, o: Partial<AgenteRegistro> = {}): AgenteRegistro => ({ id, name, display_name: name, description, role: null, status: "idle", kind: "consultable", last_heartbeat: null, last_task_at: null, tasks_completed: 0, tasks_failed: 0, ...o });
const AGENTES = [
  ag("a1", "atl", "Especialista en obligaciones fiscales y nómina ante el SAT"),
  ag("a2", "nelli", "Prevención de lavado de dinero y revisión de listas de personas bloqueadas"),
  ag("a3", "amatl", "Redacta contratos mercantiles y demandas"),
  ag("a4", "viejo", "Fiscal antiguo", { status: "archived" }),
  ag("a5", "sistema", "Fiscal interno", { kind: "system" }),
];

describe("sugerirAgentes", () => {
  it("quita acentos, palabras vacías y repetidas", () => {
    expect(palabrasClave("Necesito que revises la NÓMINA, nómina del SAT")).toEqual(["nomina", "sat"]);
  });
  it("sugiere por coincidencia con la descripción y explica el motivo", () => {
    const s = sugerirAgentes("Revisa si hay cambios del SAT sobre nómina", AGENTES);
    expect(s[0].agente.id).toBe("a1");
    expect(s[0].motivo).toMatch(/coincide en/);
  });
  it("coincide aunque cambie la terminación (contrato/contratos)", () => {
    expect(sugerirAgentes("Prepara un contrato", AGENTES)[0].agente.id).toBe("a3");
  });
  it("quien es mencionado por nombre va primero", () => {
    const s = sugerirAgentes("nelli, ayúdame con el SAT", AGENTES);
    expect(s[0].agente.id).toBe("a2");
    expect(s[0].motivo).toMatch(/lo mencionaste/);
  });
  it("no sugiere agentes archivados ni del sistema, ni inventa si nada coincide", () => {
    expect(sugerirAgentes("fiscal antiguo interno", AGENTES).every((x) => !["a4", "a5"].includes(x.agente.id))).toBe(true);
    expect(sugerirAgentes("zzz qqq", AGENTES)).toEqual([]);
    expect(sugerirAgentes("   ", AGENTES)).toEqual([]);
  });
  it("devuelve como máximo 3", () => {
    const muchos = Array.from({ length: 6 }, (_, i) => ag("m" + i, "ag" + i, "obligaciones fiscales"));
    expect(sugerirAgentes("obligaciones fiscales", muchos)).toHaveLength(3);
  });
  it("el título es la primera frase y no pasa de 80 caracteres", () => {
    expect(tituloDe("Revisa el SAT. Luego avísame.")).toBe("Revisa el SAT.");
    expect(tituloDe("palabra ".repeat(30)).length).toBeLessThanOrEqual(80);
    expect(tituloDe("palabra ".repeat(30)).endsWith("…")).toBe(true);
  });
});

function montar(onVer?: (id?: string) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><BarraTareas agentes={AGENTES} onVerSeguimiento={onVer} /></QueryClientProvider>);
}

describe("<BarraTareas />", () => {
  beforeEach(() => { invoke.mockReset(); invoke.mockResolvedValue({ data: { task_id: "tarea-1" }, error: null }); });

  it("sin texto no muestra sugerencias y no deja enviar", () => {
    montar();
    expect(screen.queryByTestId("barra-sugerencias")).toBeNull();
    expect((screen.getByTestId("barra-enviar") as HTMLButtonElement).disabled).toBe(true);
  });
  it("al escribir sugiere agentes; no envía hasta elegir uno", () => {
    montar();
    fireEvent.change(screen.getByTestId("barra-texto"), { target: { value: "Revisa cambios del SAT sobre nómina" } });
    expect(screen.getByTestId("barra-opcion-a1")).toBeTruthy();
    expect((screen.getByTestId("barra-enviar") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("barra-enviar"));
    expect(invoke).not.toHaveBeenCalled();
  });
  it("al elegir y enviar crea la tarea con título, instrucción y agente, sin accesos ni escritura", async () => {
    const ver = vi.fn();
    montar(ver);
    fireEvent.change(screen.getByTestId("barra-texto"), { target: { value: "Revisa cambios del SAT sobre nómina. Avísame." } });
    fireEvent.click(screen.getByTestId("barra-opcion-a1"));
    expect(screen.getByTestId("barra-opcion-a1").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("barra-enviar").textContent).toMatch(/Enviar a atl/);
    fireEvent.click(screen.getByTestId("barra-enviar"));
    await waitFor(() => expect(screen.getByTestId("barra-ok")).toBeTruthy());
    const [fn, { body }] = invoke.mock.calls[0];
    expect(fn).toBe("dispatch-to-agent");
    expect(body).toMatchObject({ agent_id: "a1", title: "Revisa cambios del SAT sobre nómina.", instructions: "Revisa cambios del SAT sobre nómina. Avísame.", task_type: "manual" });
    expect(body.input_context).toBeUndefined();
    expect((screen.getByTestId("barra-texto") as HTMLTextAreaElement).value).toBe("");
    fireEvent.click(screen.getByTestId("barra-ver-seguimiento"));
    expect(ver).toHaveBeenCalledWith("tarea-1");
  });
  it("Ctrl+Enter envía solo si ya hay agente elegido", async () => {
    montar();
    const t = screen.getByTestId("barra-texto");
    fireEvent.change(t, { target: { value: "contrato mercantil" } });
    fireEvent.keyDown(t, { key: "Enter", ctrlKey: true });
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("barra-opcion-a3"));
    fireEvent.keyDown(t, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  });
  it("sin coincidencias lo dice y permite elegir a mano de la lista", async () => {
    montar();
    fireEvent.change(screen.getByTestId("barra-texto"), { target: { value: "zzz qqq" } });
    expect(screen.getByTestId("barra-sin-sugerencia")).toBeTruthy();
    fireEvent.click(screen.getByTestId("barra-otro-abrir"));
    const lista = screen.getByTestId("barra-otro") as HTMLSelectElement;
    expect(Array.from(lista.options).some((o) => o.value === "a4" || o.value === "a5")).toBe(false);
    fireEvent.change(lista, { target: { value: "a2" } });
    fireEvent.click(screen.getByTestId("barra-enviar"));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][1].body.agent_id).toBe("a2");
  });
  it("si falla el envío lo avisa y conserva el texto", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("x") });
    montar();
    fireEvent.change(screen.getByTestId("barra-texto"), { target: { value: "contrato mercantil" } });
    fireEvent.click(screen.getByTestId("barra-opcion-a3"));
    fireEvent.click(screen.getByTestId("barra-enviar"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/No se pudo enviar/));
    expect((screen.getByTestId("barra-texto") as HTMLTextAreaElement).value).toBe("contrato mercantil");
  });
  it("si el texto cambia y el agente elegido ya no encaja, se deselecciona", () => {
    montar();
    const t = screen.getByTestId("barra-texto");
    fireEvent.change(t, { target: { value: "contrato mercantil" } });
    fireEvent.click(screen.getByTestId("barra-opcion-a3"));
    fireEvent.change(t, { target: { value: "nómina del SAT" } });
    expect((screen.getByTestId("barra-enviar") as HTMLButtonElement).textContent).toBe("Enviar");
  });
});
