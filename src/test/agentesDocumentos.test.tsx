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
  it("agrega Dropbox (clientes) sin pedir carpeta y manda carpeta_id «raiz»", async () => {
    invoke.mockResolvedValue({ data: { fuentes: [] }, error: null });
    envolver(<DocumentosAgente agentes={[ag({})]} />);
    fireEvent.change(screen.getByTestId("documentos-agente"), { target: { value: "a" } });
    fireEvent.click(screen.getByTestId("prov-dropbox"));
    expect(screen.queryByTestId("documentos-carpeta")).toBeNull();
    expect(screen.getByTestId("documentos-dropbox-aviso").textContent).toContain("solo lectura");
    fireEvent.change(screen.getByTestId("documentos-etiqueta"), { target: { value: "Dropbox clientes" } });
    fireEvent.click(screen.getByTestId("documentos-agregar"));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: "fuentes_documentos", agent_id: "a", fuentes: [{ proveedor: "dropbox", etiqueta: "Dropbox clientes", carpeta_id: "raiz" }] });
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
