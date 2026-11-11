import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { pasosDeConexion } from "@/lib/agentes/conexion";
import { ConstructorAgentes } from "@/components/agentes/ConstructorAgentes";
import type { AgenteRegistro } from "@/lib/agentes/registro";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }), upsert: async () => ({ error: null }), delete: () => ({ eq: async () => ({ error: null }) }) }) },
}));

const PROPUESTA = { nombre_visible: "Vizumi", rol: "Oficial de cumplimiento", cliente: "Vizum", descripcion: "Vigila documentos de Vizum.", mision: "Revisar el padrón y reportar.", capacidades: ["Revisar documentos"], entregables: ["Informe"],
  informes: "", fuentes: [], cadencia: "diaria", dominios_permitidos: [], paginas: [], credenciales: [], limites: ["No presenta nada ante autoridades"] };
const CREADO = { id: "a-viz", name: "vizumi", display_name: "Vizumi", role: "r", status: "idle" };
const registro = (config: Record<string, unknown>) => ({ id: "a-viz", name: "vizumi", display_name: "Vizumi", description: "d", role: "r", status: "idle", kind: "consultable", last_heartbeat: null, last_task_at: null, config }) as unknown as AgenteRegistro;

describe("pasos para conectar un agente nuevo", () => {
  it("un agente recién creado: nada conectado; programar solo si su cadencia no es «bajo demanda»", () => {
    const p = pasosDeConexion(registro({ cadencia: "diaria" }));
    expect(p.map((x) => `${x.id}:${x.hecho}`)).toEqual(["documentos:false", "cuentas:false", "programar:false", "instruir:false"]);
    expect(p.find((x) => x.id === "programar")!.titulo).toContain("diaria");
    expect(pasosDeConexion(registro({ cadencia: "bajo_demanda" })).map((x) => x.id)).toEqual(["documentos", "cuentas", "instruir"]);
    expect(pasosDeConexion(undefined).map((x) => x.id)).toContain("documentos");
  });
  it("lee lo ya conectado de la configuración real", () => {
    const p = pasosDeConexion(registro({ cadencia: "semanal", fuentes_docs: [{ proveedor: "dropbox" }], cuentas: { activa: true }, programacion: { activa: true } }));
    expect(p.filter((x) => x.hecho).map((x) => x.id)).toEqual(["documentos", "cuentas", "programar"]);
    expect(p[0].detalle).toContain("1 fuente conectada");
  });
});

describe("después de crear el agente", () => {
  beforeEach(() => invoke.mockReset());
  const crearAgente = async (agentes: AgenteRegistro[], onIr = vi.fn()) => {
    invoke.mockImplementation(async (...args: unknown[]) => {
      const body = ((args[1] as { body?: Record<string, unknown> } | undefined)?.body ?? {}) as Record<string, unknown>;
      return body.action === "crear" ? { data: { agente: CREADO }, error: null } : body.action === "cuentas_agente" ? { data: { activa: body.activa }, error: null } : { data: { texto: "Propuesta lista", propuesta: PROPUESTA, avisos: [] }, error: null };
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><ConstructorAgentes agentes={agentes} onIr={onIr} /></QueryClientProvider>);
    fireEvent.change(screen.getByPlaceholderText(/Describe el agente/), { target: { value: "Un oficial para Vizum" } });
    fireEvent.click(screen.getByTestId("constructor-enviar"));
    fireEvent.click(await screen.findByTestId("constructor-crear"));
    await screen.findByTestId("conectar-agente");
    return onIr;
  };

  it("muestra la lista de conexión con el estado real y cada atajo lleva a su pestaña con el agente elegido", async () => {
    const onIr = await crearAgente([registro({ cadencia: "diaria" })]);
    expect(screen.getByTestId("conectar-agente").textContent).toContain("Conecta a Vizumi");
    fireEvent.click(screen.getByTestId("ir-documentos")); expect(onIr).toHaveBeenLastCalledWith("documentos", "a-viz");
    fireEvent.click(screen.getByTestId("ir-programar")); expect(onIr).toHaveBeenLastCalledWith("programar", "a-viz");
    fireEvent.click(screen.getByTestId("ir-instruir")); expect(onIr).toHaveBeenLastCalledWith("instrucciones", "a-viz");
  });

  it("correo y calendario se activa ahí mismo", async () => {
    await crearAgente([registro({ cadencia: "diaria" })]);
    fireEvent.click(screen.getByTestId("paso-cuentas-boton"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("agente-constructor", { body: { action: "cuentas_agente", agent_id: "a-viz", activa: true } }));
  });

  it("si el registro aún no trae al agente, la lista aparece igual (sin romperse)", async () => {
    await crearAgente([]);
    expect(screen.getByTestId("paso-documentos")).toBeTruthy();
  });
});
