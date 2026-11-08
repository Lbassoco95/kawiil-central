import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  validarPropuesta, slugAgente, construirSystemPrompt, filaDesdePropuesta, limpiarMensajes, ORG_AGENTES, FUENTES_KAWIIL,
} from "../../supabase/functions/_shared/agenteConstructor";
import { ConstructorAgentes } from "@/components/agentes/ConstructorAgentes";
import { InstruirAgente } from "@/components/agentes/InstruirAgente";
import { filtrarAmbito } from "@/lib/agentes/oficina";
import type { AgenteRegistro } from "@/lib/agentes/registro";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

const BUENA = {
  nombre_visible: "Oficial de Cumplimiento", rol: "Oficial de cumplimiento PLD/FT", cliente: "Vizum",
  descripcion: "Vigila el cumplimiento regulatorio de Vizum y reporta hallazgos.",
  mision: "Revisar los documentos de Vizum y avisar de vencimientos y faltantes de cumplimiento.",
  capacidades: ["Revisar expedientes", "Detectar vencimientos"], entregables: ["Informe semanal"],
  limites: ["No envía nada a la autoridad sin una persona"], fuentes: ["documentos", "legal", "inexistente"], cadencia: "semanal",
};

describe("validarPropuesta", () => {
  it("normaliza y descarta fuentes que no existen", () => {
    const r = validarPropuesta(BUENA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.propuesta.fuentes).toEqual(["documentos", "legal"]);
  });
  it("rechaza lo incompleto con mensajes claros", () => {
    const r = validarPropuesta({ ...BUENA, limites: [], mision: "corta" });
    expect(r.ok).toBe(false);
    expect("errores" in r && r.errores.join(" ")).toMatch(/límite/);
  });
  it("rechaza lo que no es objeto y usa bajo_demanda si la cadencia es inválida", () => {
    expect(validarPropuesta("x").ok).toBe(false);
    const r = validarPropuesta({ ...BUENA, cadencia: "cada_minuto" });
    if (r.ok) expect(r.propuesta.cadencia).toBe("bajo_demanda");
  });
});

describe("armado del agente", () => {
  it("slug sin acentos ni símbolos", () => expect(slugAgente("Oficial de Cumplimiento", "Vizum")).toBe("oficial_de_cumplimiento_vizum"));
  it("la fila tiene la forma de los agentes existentes y es consultable en reposo", () => {
    const v = validarPropuesta(BUENA); if (!v.ok) throw new Error();
    const f = filaDesdePropuesta(v.propuesta, "user-1", new Date("2026-11-08T12:00:00Z"));
    expect(f).toMatchObject({ organization_id: ORG_AGENTES, kind: "consultable", status: "idle", name: "oficial_de_cumplimiento_vizum" });
    expect(f.config).toMatchObject({ origen: "constructor_agentes", creado_por: "user-1", cliente: "Vizum", cadencia: "semanal" });
    expect(typeof f.config.system_prompt).toBe("string");
  });
  it("el prompt incluye las reglas fijas y las fuentes en palabras", () => {
    const v = validarPropuesta(BUENA); if (!v.ok) throw new Error();
    const p = construirSystemPrompt(v.propuesta);
    expect(p).toContain("REGLAS FIJAS");
    expect(p).toContain(FUENTES_KAWIIL.documentos);
    expect(p).toContain("Vizum");
  });
  it("sufijo para nombres repetidos", () => {
    const v = validarPropuesta(BUENA); if (!v.ok) throw new Error();
    expect(filaDesdePropuesta(v.propuesta, "u", new Date(), "_2").name).toBe("oficial_de_cumplimiento_vizum_2");
  });
});

describe("limpiarMensajes", () => {
  it("solo user/assistant con texto, empieza con el usuario y recorta", () => {
    const r = limpiarMensajes([{ role: "assistant", content: "hola" }, { role: "system", content: "x" }, { role: "user", content: " " }, { role: "user", content: "a" }, 3]);
    expect(r).toEqual([{ role: "user", content: "a" }]);
    expect(limpiarMensajes(Array.from({ length: 60 }, () => ({ role: "user", content: "a" }))).length).toBe(40);
    expect(limpiarMensajes(null)).toEqual([]);
  });
});

const envolver = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("ConstructorAgentes", () => {
  beforeEach(() => invoke.mockReset());
  it("conversa, muestra la propuesta y solo crea al confirmar", async () => {
    const v = validarPropuesta(BUENA); if (!v.ok) throw new Error();
    invoke.mockResolvedValueOnce({ data: { texto: "Te dejo la propuesta.", propuesta: v.propuesta, avisos: [] }, error: null });
    invoke.mockResolvedValueOnce({ data: { agente: { id: "n1", name: "oficial_de_cumplimiento_vizum", display_name: "Oficial de Cumplimiento", role: "x", status: "idle" } }, error: null });
    envolver(<ConstructorAgentes />);
    fireEvent.change(screen.getByLabelText(/Mensaje para el Constructor/), { target: { value: "Quiero un oficial de cumplimiento para Vizum" } });
    fireEvent.click(screen.getByTestId("constructor-enviar"));
    await screen.findByTestId("constructor-propuesta");
    expect(invoke).toHaveBeenCalledTimes(1); // todavía no se creó nada
    expect(invoke.mock.calls[0][1].body.action).toBe("chat");
    fireEvent.click(screen.getByTestId("constructor-crear"));
    await screen.findByTestId("constructor-creado");
    expect(invoke.mock.calls[1][1].body.action).toBe("crear");
    expect(screen.queryByTestId("constructor-propuesta")).toBeNull();
  });
  it("muestra el error del chat sin romperse", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    envolver(<ConstructorAgentes />);
    fireEvent.change(screen.getByLabelText(/Mensaje para el Constructor/), { target: { value: "hola" } });
    fireEvent.click(screen.getByTestId("constructor-enviar"));
    await screen.findByTestId("constructor-error");
  });
});

describe("InstruirAgente", () => {
  const ag = (o: Partial<AgenteRegistro> & { id: string; name: string }): AgenteRegistro => ({ display_name: null, description: null, role: null, status: "idle", kind: "consultable", last_heartbeat: null, last_task_at: null, tasks_completed: 0, tasks_failed: 0, ...o });
  beforeEach(() => invoke.mockReset());
  it("no ofrece archivados ni de sistema y despacha la tarea", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    envolver(<InstruirAgente agentes={[ag({ id: "a", name: "nelli", display_name: "Nelli" }), ag({ id: "b", name: "viejo", status: "archived" }), ag({ id: "c", name: "marketing_x", kind: "system" })]} />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Elige un agente…", "Nelli"]);
    expect((screen.getByTestId("instruir-enviar") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("instruir-agente"), { target: { value: "a" } });
    fireEvent.change(screen.getByTestId("instruir-titulo"), { target: { value: "Revisar" } });
    fireEvent.change(screen.getByTestId("instruir-texto"), { target: { value: "Revisa los documentos nuevos" } });
    fireEvent.click(screen.getByTestId("instruir-enviar"));
    await waitFor(() => expect(screen.getByTestId("instruir-ok")).toBeTruthy());
    expect(invoke.mock.calls[0][0]).toBe("dispatch-to-agent");
    expect(invoke.mock.calls[0][1].body).toMatchObject({ agent_id: "a", title: "Revisar" });
  });
});

describe("oficina: Mi equipo", () => {
  it("filtra los agentes creados desde el constructor", () => {
    const a = { id: "1", name: "x", config: { origen: "constructor_agentes" } } as unknown as AgenteRegistro;
    const b = { id: "2", name: "y", config: {} } as unknown as AgenteRegistro;
    expect(filtrarAmbito([a, b], "equipo")).toEqual([a]);
  });
});

import { normalizarDominio, esReferencia1Password, pareceSecreto } from "../../supabase/functions/_shared/agenteConstructor";

describe("internet y 1Password", () => {
  it("normaliza dominios y rechaza internos o IP", () => {
    expect(normalizarDominio("https://www.CNBV.gob.mx/ruta?x=1")).toBe("www.cnbv.gob.mx");
    for (const m of ["localhost", "127.0.0.1", "servidor.internal", "10.0.0.5", "sin-punto", 5]) expect(normalizarDominio(m)).toBeNull();
  });
  it("solo acepta referencias op:// y nunca el valor", () => {
    expect(esReferencia1Password("op://Agentes-Kawiil/Vizum-portal/password")).toBe(true);
    for (const m of ["Hunter2!", "op://solo", "op:// a/b/c", "https://op://a/b"]) expect(esReferencia1Password(m)).toBe(false);
    const r = validarPropuesta({ ...BUENA, credenciales: [{ etiqueta: "Portal", referencia: "MiClave123" }] });
    expect(r.ok).toBe(false);
  });
  it("las páginas deben ser https, sin usuario, y su dominio queda permitido", () => {
    expect(validarPropuesta({ ...BUENA, paginas: [{ titulo: "x", url: "http://a.com" }] }).ok).toBe(false);
    expect(validarPropuesta({ ...BUENA, paginas: [{ titulo: "x", url: "https://u:p@a.com" }] }).ok).toBe(false);
    const r = validarPropuesta({ ...BUENA, paginas: [{ titulo: "CNBV", url: "https://www.cnbv.gob.mx/x" }], credenciales: [{ etiqueta: "Portal", referencia: "op://Agentes/Vizum/password", dominio: "portal.vizum.mx" }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.propuesta.dominios_permitidos).toEqual(["www.cnbv.gob.mx", "portal.vizum.mx"]);
  });
  it("la fila guarda solo referencias y el prompt prohíbe otros dominios", () => {
    const v = validarPropuesta({ ...BUENA, dominios_permitidos: ["cnbv.gob.mx"], credenciales: [{ etiqueta: "Portal", referencia: "op://Agentes/Vizum/password", dominio: "cnbv.gob.mx" }] });
    if (!v.ok) throw new Error();
    const f = filaDesdePropuesta(v.propuesta, "u", new Date());
    expect(JSON.stringify(f.config)).toContain("op://Agentes/Vizum/password");
    expect(f.config.system_prompt).toMatch(/cualquier otro está prohibido/);
    expect(f.config.system_prompt).not.toMatch(/Hunter2/);
  });
  it("detecta secretos pegados", () => {
    expect(pareceSecreto("mi contraseña es Hunter2!")).toBe(true);
    expect(pareceSecreto("password: abc12345")).toBe(true);
    expect(pareceSecreto("sk-ant-api03-abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(pareceSecreto("la bóveda se llama Agentes-Kawiil y el elemento Vizum-portal")).toBe(false);
  });
});

describe("el chat no deja pasar secretos", () => {
  beforeEach(() => invoke.mockReset());
  it("no llama al servidor si el mensaje parece una contraseña", () => {
    envolver(<ConstructorAgentes />);
    fireEvent.change(screen.getByLabelText(/Mensaje para el Constructor/), { target: { value: "la contraseña es Hunter2!" } });
    fireEvent.click(screen.getByTestId("constructor-enviar"));
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByTestId("constructor-error").textContent).toMatch(/1Password/);
  });
});

describe("accesos 1Password: dominio obligatorio y autorización por tarea", () => {
  it("rechaza un acceso sin dominio", () => {
    const r = validarPropuesta({ ...BUENA, credenciales: [{ etiqueta: "Portal", referencia: "op://Agentes/Vizum" }] });
    expect(r.ok).toBe(false);
    expect("errores" in r && r.errores.join(" ")).toMatch(/dominio/);
  });
  it("acepta la referencia al elemento sin campo", () => {
    const r = validarPropuesta({ ...BUENA, credenciales: [{ etiqueta: "Portal", referencia: "op://Agentes-Kawiil/Vizum-portal", dominio: "portal.vizum.mx" }] });
    expect(r.ok).toBe(true);
  });
});

describe("InstruirAgente: autorizar accesos", () => {
  const conAcceso = { id: "a", name: "oficial", display_name: "Oficial", description: null, role: null, status: "idle", kind: "consultable", last_heartbeat: null, last_task_at: null, tasks_completed: 0, tasks_failed: 0,
    config: { credenciales_1password: [{ etiqueta: "Portal Vizum", referencia: "op://Agentes-Kawiil/Vizum-portal", dominio: "portal.vizum.mx" }] } } as unknown as AgenteRegistro;
  beforeEach(() => invoke.mockReset());
  it("no muestra la referencia, no envía accesos sin marcar y envía los marcados", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    envolver(<InstruirAgente agentes={[conAcceso]} />);
    fireEvent.change(screen.getByTestId("instruir-agente"), { target: { value: "a" } });
    expect(screen.getByTestId("instruir-accesos").textContent).not.toContain("op://");
    fireEvent.change(screen.getByTestId("instruir-titulo"), { target: { value: "Revisar" } });
    fireEvent.change(screen.getByTestId("instruir-texto"), { target: { value: "Revisa el panel" } });
    fireEvent.click(screen.getByTestId("instruir-enviar"));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][1].body.input_context).toBeUndefined();
    fireEvent.change(screen.getByTestId("instruir-titulo"), { target: { value: "Revisar 2" } });
    fireEvent.change(screen.getByTestId("instruir-texto"), { target: { value: "Otra vez" } });
    fireEvent.click(screen.getByTestId("instruir-acceso-Portal Vizum"));
    fireEvent.click(screen.getByTestId("instruir-enviar"));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[1][1].body.input_context).toEqual({ accesos_aprobados: ["Portal Vizum"] });
  });
});
