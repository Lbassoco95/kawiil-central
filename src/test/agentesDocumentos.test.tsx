import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { idDeEnlaceGoogle, validarFuentesDocs, MAX_FUENTES_DOCS } from "../../supabase/functions/_shared/fuentesDocs";
import { DocumentosAgente, fuentesDe } from "@/components/agentes/DocumentosAgente";
import type { AgenteRegistro } from "@/lib/agentes/registro";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

const G = { proveedor: "google", etiqueta: "Drive Vizum", carpeta_id: "1AbCdEfGhIjKlMnOp" };
const M = { proveedor: "microsoft", etiqueta: "SharePoint Acme", carpeta_id: "01ABCDEFGHIJKLMN", drive_id: "b!driveSharePoint01", tenant_id: "acme.onmicrosoft.com" };

describe("validarFuentesDocs", () => {
  it("acepta Google (enlace o id) y Microsoft", () => {
    const r = validarFuentesDocs([{ ...G, carpeta_id: "https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp?usp=sharing" }, M]);
    expect(r.ok && r.fuentes).toEqual([G, M]);
  });
  it("id de enlace", () => {
    expect(idDeEnlaceGoogle("https://drive.google.com/open?id=1AbCdEfGhIjK")).toBe("1AbCdEfGhIjK");
    expect(idDeEnlaceGoogle("  1AbCdEfGhIjK ")).toBe("1AbCdEfGhIjK");
    expect(idDeEnlaceGoogle(5)).toBe("");
  });
  it.each([
    [[{ ...G, etiqueta: "x" }], /nombre/], [[G, { ...G, carpeta_id: "OtraCarpetaDistinta1" }], /repetido/],
    [[{ ...G, carpeta_id: "abc' or '1'='1" }], /no es válido/], [[{ ...G, carpeta_id: "../../etc/passwd" }], /no es válido/],
    [[{ ...G, carpeta_id: "https://evil.example.com/robo" }], /no es válido/],
    [[G, { ...G, etiqueta: "Otro nombre" }], /ya está en otra fuente/],
    [[{ ...M, tenant_id: "../x" }], /tenant/], [[{ ...M, drive_id: "a b" }], /drive_id/], [[{ ...M, carpeta_id: "" }], /drive_id/],
    [[{ ...G, proveedor: "onedrive" }], /proveedor/], ["x", /lista/],
    [Array.from({ length: MAX_FUENTES_DOCS + 1 }, (_, i) => ({ ...G, etiqueta: `F${i}`, carpeta_id: `Carpeta${i}abcdefgh` })), /Máximo/],
  ])("rechaza %#", (raw, msg) => {
    const r = validarFuentesDocs(raw);
    expect(r.ok).toBe(false);
    expect("errores" in r && r.errores.join(" ")).toMatch(msg);
  });
  it("Dropbox: «raiz» por defecto o un id de Dropbox; nada más", () => {
    const D = { proveedor: "dropbox", etiqueta: "Dropbox clientes", carpeta_id: "raiz" };
    expect(validarFuentesDocs([D, { ...D, etiqueta: "Acme", carpeta_id: "id:AbC123_-xyz" }]).ok).toBe(true);
    const sinCarpeta = validarFuentesDocs([{ proveedor: "dropbox", etiqueta: "Dropbox clientes" }]);
    expect(sinCarpeta.ok && sinCarpeta.fuentes[0].carpeta_id).toBe("raiz");
    for (const malo of ["/Kawiil Mx", "../x", "id:", "https://dropbox.com/x", "id:a b"]) {
      const r = validarFuentesDocs([{ ...D, carpeta_id: malo }]);
      expect(r.ok).toBe(false);
    }
    expect(validarFuentesDocs([D, { ...D, etiqueta: "Otra" }]).ok).toBe(false);            // la misma carpeta dos veces
  });
  it("no deja pasar campos extra (solo identificadores)", () => {
    const r = validarFuentesDocs([{ ...G, contraseña: "x", token: "y", url: "https://x" }]);
    expect(r.ok && Object.keys(r.fuentes[0]).sort()).toEqual(["carpeta_id", "etiqueta", "proveedor"]);
  });
});

const ag = (cfg: Record<string, unknown>, o: Record<string, unknown> = {}) => ({ id: "a", name: "oficial", display_name: "Oficial", description: null, role: null, status: "idle", kind: "consultable", last_heartbeat: null, last_task_at: null, tasks_completed: 0, tasks_failed: 0, config: cfg, ...o }) as unknown as AgenteRegistro;
const envolver = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("DocumentosAgente", () => {
  beforeEach(() => invoke.mockReset());
  it("lee las fuentes guardadas e ignora lo mal formado", () => {
    expect(fuentesDe(ag({ fuentes_docs: [G, M, "x", null, { proveedor: "otro", etiqueta: "z" }] })).length).toBe(2);
    expect(fuentesDe(ag({})).length).toBe(0);
  });
  it("ofrece a cualquier agente consultable activo (también los anteriores al constructor), no a archivados ni de sistema", () => {
    envolver(<DocumentosAgente agentes={[ag({}), ag({}, { id: "b", status: "archived" }), ag({}, { id: "c", kind: "system" })]} />);
    expect(screen.queryByTestId("documentos-vacio")).toBeNull();
    expect(screen.getAllByRole("option").length).toBe(2);                 // «Elige un agente…» + el consultable activo
  });
  it("sin agentes disponibles lo dice", () => {
    envolver(<DocumentosAgente agentes={[ag({}, { status: "archived" })]} />);
    expect(screen.getByTestId("documentos-vacio")).toBeTruthy();
  });
  const LISTA = { entries: [
    { id: "id:CarpetaVizum_1", name: "VIZUM", type: "folder" }, { id: "id:CarpetaAcme_22", name: "ACME Servicios", type: "folder" },
    { id: "id:ArchivoSuelto_3", name: "notas.pdf", type: "file" }, { id: "raro", name: "Mala", type: "folder" }], has_more: false };
  const servir = () => invoke.mockImplementation(async (n: string, opts?: { body?: Record<string, unknown> }) =>
    n === "dropbox-browse" ? { data: LISTA, error: null } : { data: { fuentes: opts?.body?.fuentes ?? [] }, error: null });
  const guardado = () => invoke.mock.calls.find((c) => c[1]?.body?.action === "fuentes_documentos")?.[1].body;

  it("Dropbox: elige la carpeta del cliente de la lista (solo carpetas) y manda su id, no «raiz»", async () => {
    servir();
    envolver(<DocumentosAgente agentes={[ag({})]} />);
    fireEvent.change(screen.getByTestId("documentos-agente"), { target: { value: "a" } });
    fireEvent.click(screen.getByTestId("prov-dropbox"));
    expect(screen.queryByTestId("documentos-carpeta")).toBeNull();
    expect(screen.getByTestId("documentos-dropbox-aviso").textContent).toContain("solo lectura");
    const sel = await screen.findByTestId("documentos-dbx-carpeta") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(["Elige una carpeta…", "ACME Servicios", "VIZUM", "Todas las carpetas de clientes (solo para agentes que revisan a todos)"]);   // sin archivos ni ids raros
    fireEvent.change(sel, { target: { value: "id:CarpetaVizum_1" } });
    expect((screen.getByTestId("documentos-etiqueta") as HTMLInputElement).value).toBe("Dropbox · VIZUM");      // nombre sugerido
    fireEvent.click(screen.getByTestId("documentos-agregar"));
    await waitFor(() => expect(guardado()).toBeTruthy());
    expect(guardado()).toMatchObject({ action: "fuentes_documentos", agent_id: "a", fuentes: [{ proveedor: "dropbox", etiqueta: "Dropbox · VIZUM", carpeta_id: "id:CarpetaVizum_1" }] });
  });
  it("Dropbox: sin elegir carpeta no se guarda nada (nunca queda «todas» por descuido)", async () => {
    servir();
    envolver(<DocumentosAgente agentes={[ag({})]} />);
    fireEvent.change(screen.getByTestId("documentos-agente"), { target: { value: "a" } });
    fireEvent.click(screen.getByTestId("prov-dropbox"));
    await screen.findByTestId("documentos-dbx-carpeta");
    fireEvent.change(screen.getByTestId("documentos-etiqueta"), { target: { value: "Dropbox clientes" } });
    fireEvent.click(screen.getByTestId("documentos-agregar"));
    expect((await screen.findByTestId("documentos-errores")).textContent).toContain("Elige la carpeta del cliente");
    expect(guardado()).toBeUndefined();
  });
  it("Dropbox: «Todas las carpetas» es una elección explícita, avisa y manda «raiz»", async () => {
    servir();
    envolver(<DocumentosAgente agentes={[ag({})]} />);
    fireEvent.change(screen.getByTestId("documentos-agente"), { target: { value: "a" } });
    fireEvent.click(screen.getByTestId("prov-dropbox"));
    fireEvent.change(await screen.findByTestId("documentos-dbx-carpeta"), { target: { value: "__todas__" } });
    expect(screen.getByTestId("documentos-dbx-todas").textContent).toContain("TODOS los clientes");
    fireEvent.change(screen.getByTestId("documentos-etiqueta"), { target: { value: "Dropbox clientes" } });
    fireEvent.click(screen.getByTestId("documentos-agregar"));
    await waitFor(() => expect(guardado()).toBeTruthy());
    expect(guardado().fuentes).toEqual([{ proveedor: "dropbox", etiqueta: "Dropbox clientes", carpeta_id: "raiz" }]);
  });
  it("una fuente ya guardada muestra el nombre de la carpeta, no su id", async () => {
    servir();
    envolver(<DocumentosAgente agentes={[ag({ fuentes_docs: [{ proveedor: "dropbox", etiqueta: "Dropbox · VIZUM", carpeta_id: "id:CarpetaVizum_1" }] })]} />);
    fireEvent.change(screen.getByTestId("documentos-agente"), { target: { value: "a" } });
    fireEvent.click(screen.getByTestId("prov-dropbox"));
    await waitFor(() => expect(screen.getByTestId("fuente-Dropbox · VIZUM").textContent).toContain("carpeta VIZUM"));
  });
  it("agrega una carpeta de Drive desde su enlace y manda la lista completa", async () => {
    invoke.mockResolvedValue({ data: { fuentes: [] }, error: null });
    envolver(<DocumentosAgente agentes={[ag({ origen: "constructor_agentes", fuentes_docs: [M] })]} />);
    fireEvent.change(screen.getByTestId("documentos-agente"), { target: { value: "a" } });
    fireEvent.change(screen.getByTestId("documentos-etiqueta"), { target: { value: "Drive Vizum" } });
    fireEvent.change(screen.getByTestId("documentos-carpeta"), { target: { value: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing" } });
    fireEvent.click(screen.getByTestId("documentos-agregar"));
    await screen.findByTestId("documentos-ok");
    expect(invoke.mock.calls[0][0]).toBe("agente-constructor");
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: "fuentes_documentos", agent_id: "a", fuentes: [M, G] });
  });
  it("Microsoft pide drive y tenant; sin ellos no llama al servidor y muestra por qué", () => {
    envolver(<DocumentosAgente agentes={[ag({ origen: "constructor_agentes" })]} />);
    fireEvent.change(screen.getByTestId("documentos-agente"), { target: { value: "a" } });
    fireEvent.click(screen.getByTestId("prov-microsoft"));
    fireEvent.change(screen.getByTestId("documentos-etiqueta"), { target: { value: "SharePoint Acme" } });
    fireEvent.change(screen.getByTestId("documentos-carpeta"), { target: { value: "01ABCDEFGHIJKLMN" } });
    fireEvent.click(screen.getByTestId("documentos-agregar"));
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByTestId("documentos-errores").textContent).toMatch(/drive_id/);
  });
  it("quitar una fuente manda la lista sin ella", async () => {
    invoke.mockResolvedValue({ data: { fuentes: [] }, error: null });
    envolver(<DocumentosAgente agentes={[ag({ origen: "constructor_agentes", fuentes_docs: [G, M] })]} />);
    fireEvent.change(screen.getByTestId("documentos-agente"), { target: { value: "a" } });
    fireEvent.click(screen.getByTestId("quitar-Drive Vizum"));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][1].body.fuentes).toEqual([M]);
    expect(await screen.findByTestId("documentos-ok")).toBeTruthy();
  });
  it("muestra el error del servidor", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("boom") });
    envolver(<DocumentosAgente agentes={[ag({ origen: "constructor_agentes" })]} />);
    fireEvent.change(screen.getByTestId("documentos-agente"), { target: { value: "a" } });
    fireEvent.change(screen.getByTestId("documentos-etiqueta"), { target: { value: "Drive Vizum" } });
    fireEvent.change(screen.getByTestId("documentos-carpeta"), { target: { value: "1AbCdEfGhIjKlMnOp" } });
    fireEvent.click(screen.getByTestId("documentos-agregar"));
    await screen.findByTestId("documentos-error");
  });
});

// ── Drive de una cuenta de Google vinculada ──
describe("validarFuentesDocs: cuenta_google", () => {
  const CUENTA = "0b47849a-312c-4ad0-81ce-d173d61f9348";
  it("acepta cuenta + carpeta (enlace o id) y normaliza", () => {
    const r = validarFuentesDocs([{ proveedor: "cuenta_google", etiqueta: "Drive Vizum", cuenta: CUENTA.toUpperCase(), carpeta_id: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing" }]);
    expect(r).toEqual({ ok: true, fuentes: [{ proveedor: "cuenta_google", etiqueta: "Drive Vizum", carpeta_id: "1AbCdEfGhIjKlMnOp", cuenta: CUENTA }] });
  });
  it.each([
    [{ cuenta: "x", carpeta_id: "1AbCdEfGhIjKl" }, /elige la cuenta/], [{ carpeta_id: "1AbCdEfGhIjKl" }, /elige la cuenta/],
    [{ cuenta: CUENTA, carpeta_id: "" }, /no es válido/], [{ cuenta: CUENTA, carpeta_id: "../x" }, /no es válido/],
  ])("rechaza %j", (o, patron) => {
    const r = validarFuentesDocs([{ proveedor: "cuenta_google", etiqueta: "Drive Vizum", ...o }]);
    if (!("errores" in r)) throw new Error("debía rechazarse");
    expect(r.errores.join(" ")).toMatch(patron);
  });
  it("no repite la misma carpeta de la misma cuenta", () => {
    const f = { proveedor: "cuenta_google", cuenta: CUENTA, carpeta_id: "1AbCdEfGhIjKl" };
    const r = validarFuentesDocs([{ ...f, etiqueta: "Uno" }, { ...f, etiqueta: "Dos" }]);
    expect("errores" in r && r.errores.join(" ")).toContain("ya está en otra fuente");
  });
});

describe("DocumentosAgente: Google Drive de una cuenta vinculada", () => {
  beforeEach(() => invoke.mockReset());
  const A = "0b47849a-312c-4ad0-81ce-d173d61f9348", B = "5f1c1c1c-1111-4111-8111-111111111111", C = "9a9a9a9a-2222-4222-8222-222222222222";
  const CUENTAS = [
    { cuenta: A, correo: "polo@kawiil.mx", nombre: "Polo", drive: true, propia: true },
    { cuenta: B, correo: "legal@kawiil.mx", nombre: "Legal", drive: false, propia: true },
    { cuenta: C, correo: "ana@kawiil.mx", nombre: "Ana", drive: false, propia: false },
  ];
  const servir = () => invoke.mockImplementation(async (n: string, opts?: { body?: Record<string, unknown> }) => {
    const b = opts?.body ?? {};
    if (n === "google-auth") return { data: { url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }, error: null };
    if (b.action === "cuentas_drive") return { data: { cuentas: CUENTAS }, error: null };
    return { data: { fuentes: b.fuentes ?? [] }, error: null };
  });
  const abrir = async (cfg = {}) => {
    servir();
    envolver(<DocumentosAgente agentes={[ag(cfg)]} />);
    fireEvent.change(screen.getByTestId("documentos-agente"), { target: { value: "a" } });
    fireEvent.click(screen.getByTestId("prov-cuenta_google"));
    await screen.findByTestId(`cuenta-drive-${A}`);
  };
  const guardado = () => invoke.mock.calls.find((c) => c[1]?.body?.action === "fuentes_documentos")?.[1].body;

  it("muestra cada cuenta con su estado; el botón de permiso solo en las propias sin Drive", async () => {
    await abrir();
    expect(screen.getByTestId(`cuenta-drive-${A}`).textContent).toContain("Drive permitido");
    expect(screen.queryByTestId(`permitir-drive-${A}`)).toBeNull();
    expect(screen.getByTestId(`permitir-drive-${B}`)).toBeTruthy();
    expect(screen.queryByTestId(`permitir-drive-${C}`)).toBeNull();                      // de otra persona
    expect(screen.getByTestId(`cuenta-drive-${C}`).textContent).toContain("otra persona");
  });
  it("«Permitir Drive» pide a Google SOLO el permiso extra, con la cuenta como pista", async () => {
    const abierta = vi.spyOn(window, "open").mockReturnValue(null);
    await abrir();
    fireEvent.click(screen.getByTestId(`permitir-drive-${B}`));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("google-auth", { body: { extra: "drive", email: "legal@kawiil.mx" } }));
    await waitFor(() => expect(abierta).toHaveBeenCalled());
    window.dispatchEvent(new MessageEvent("message", { data: { type: "google-auth-success" } }));
    await waitFor(() => expect(invoke.mock.calls.filter((c) => c[1]?.body?.action === "cuentas_drive").length).toBeGreaterThan(1));      // se vuelve a leer el estado
    abierta.mockRestore();
  });
  it("solo se puede elegir una cuenta que ya permitió Drive, y la carpeta es obligatoria", async () => {
    await abrir();
    const sel = screen.getByTestId("documentos-cuenta-select") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(["Elige una cuenta…", "polo@kawiil.mx"]);
    fireEvent.change(screen.getByTestId("documentos-etiqueta"), { target: { value: "Drive Vizum" } });
    fireEvent.click(screen.getByTestId("documentos-agregar"));
    expect((await screen.findByTestId("documentos-errores")).textContent).toContain("elige la cuenta");
    fireEvent.change(sel, { target: { value: A } });
    fireEvent.click(screen.getByTestId("documentos-agregar"));
    expect((await screen.findByTestId("documentos-errores")).textContent).toContain("carpeta de Drive");
    expect(guardado()).toBeUndefined();
  });
  it("guarda la fuente con la cuenta y la carpeta (desde el enlace)", async () => {
    await abrir();
    fireEvent.change(screen.getByTestId("documentos-etiqueta"), { target: { value: "Drive Vizum" } });
    fireEvent.change(screen.getByTestId("documentos-cuenta-select"), { target: { value: A } });
    fireEvent.change(screen.getByTestId("documentos-carpeta"), { target: { value: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing" } });
    fireEvent.click(screen.getByTestId("documentos-agregar"));
    await waitFor(() => expect(guardado()).toBeTruthy());
    expect(guardado().fuentes).toEqual([{ proveedor: "cuenta_google", etiqueta: "Drive Vizum", carpeta_id: "1AbCdEfGhIjKlMnOp", cuenta: A }]);
  });
  it("una fuente guardada dice de qué cuenta es", async () => {
    servir();
    envolver(<DocumentosAgente agentes={[ag({ fuentes_docs: [{ proveedor: "cuenta_google", etiqueta: "Drive Vizum", cuenta: A, carpeta_id: "1AbCdEfGhIjKlMnOp" }] })]} />);
    fireEvent.change(screen.getByTestId("documentos-agente"), { target: { value: "a" } });
    await waitFor(() => expect(screen.getByTestId("fuente-Drive Vizum").textContent).toContain("Google Drive de polo@kawiil.mx"));
  });
});
