import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import type { FuentePropuesta, FuenteWebFila, HallazgoWeb } from "@/hooks/useMarketing";

type Q<T> = { data: T[] | undefined; isLoading: boolean; isError: boolean };
const estado = vi.hoisted(() => ({ fuentes: { data: [], isLoading: false, isError: false } as unknown, hallazgos: { data: [], isLoading: false, isError: false } as unknown, propuestas: { data: [], isLoading: false, isError: false } as unknown }));
vi.mock("@/hooks/useMarketing", () => ({ useFuentesWeb: () => estado.fuentes, useHallazgosWeb: () => estado.hallazgos, useFuentesPropuestas: () => estado.propuestas }));

import { OficinaAgentes } from "@/components/marketing/OficinaAgentes";
import { personajes } from "@/components/marketing/oficinaAgentesLogica";
import type { AgenteRegistro } from "@/components/marketing/agentesRegistroLogica";

afterEach(cleanup);

const ag = (name: string, o: Partial<AgenteRegistro> = {}): AgenteRegistro => ({
  id: name, name, display_name: name, description: `Descripción de ${name}`, role: name, status: "idle", kind: "system", last_heartbeat: null, last_task_at: null,
  tasks_completed: 0, tasks_failed: 0, config: { objetivo: `Objetivo de ${name}`, cadencia: "bajo_demanda" }, ...o,
});
const AGENTES = [ag("marketing_vigilante"), ag("marketing_analista"), ag("marketing_investigador", { display_name: "Investigador web" })];
const AHORA = new Date("2026-11-16T15:00:00Z");
const fuente = (o: Partial<FuenteWebFila> = {}): FuenteWebFila => ({ id: "f1", tipo: "competencia", formato: "pagina", nombre: "Competidor A", ultima_lectura_at: "2026-11-16T14:00:00Z", ultimo_estado: "sin cambios", ...o });
const hallazgo = (o: Partial<HallazgoWeb> = {}): HallazgoWeb => ({ id: "h1", tipo: "cambio_pagina", titulo: "Inicio", resumen: "Ahora ofrece una promoción.", enlace: "https://a.example.com/", publicado_at: null, encontrado_at: "2026-11-16T14:00:00Z", mk_fuente_web: { nombre: "Competidor A", tipo: "competencia" }, ...o });
const prop = (o: Partial<FuentePropuesta> = {}): FuentePropuesta => ({ id: "p1", tipo: "competencia", formato: "pagina", nombre: "Competidor B", url: "https://b.example.com/", motivo: "Software PLD para empresas.", verificada_at: "2026-11-16T14:00:00Z", ...o });
const q = <T,>(o: Partial<Q<T>>): Q<T> => ({ data: [], isLoading: false, isError: false, ...o });
const abrir = () => { render(<OficinaAgentes agentes={AGENTES} tareasMarketing={[]} estadoAgentes="ok" estadoTareas="ok" ahora={AHORA} />); fireEvent.click(screen.getByTestId("oficina-agente-Investigador")); };

describe("Investigador web en la oficina", () => {
  it("aparece al final de la lista de la oficina, después del Analista", () => {
    const l = personajes(AGENTES, [], AHORA);
    expect(l.map((p) => p.aspecto.corto)).toEqual(["Vigilante", "Analista", "Investigador"]);
  });

  it("sin fuentes lo dice claro; no muestra el aviso de «siguiente fase» y los demás agentes lo conservan", () => {
    estado.fuentes = q<FuenteWebFila>({}); estado.hallazgos = q<HallazgoWeb>({}); estado.propuestas = q<FuentePropuesta>({});
    abrir();
    expect(screen.getByTestId("investigador-panel")).toBeTruthy(); expect(screen.getByTestId("investigador-sin-propuestas").textContent).toContain("hasta que una persona lo apruebe"); expect(screen.getByTestId("investigador-sin-fuentes").textContent).toContain("Dirección las define");
    expect(screen.getByTestId("investigador-sin-hallazgos")).toBeTruthy(); expect(screen.queryByTestId("oficina-proximamente")).toBeNull();
    fireEvent.click(screen.getByTestId("oficina-agente-Vigilante")); expect(screen.queryByTestId("investigador-panel")).toBeNull(); expect(screen.getByTestId("oficina-proximamente")).toBeTruthy();
  });

  it("lista lo que vigila y lo que encontró, con su fuente y el enlace a abrir", () => {
    estado.fuentes = q({ data: [fuente(), fuente({ id: "f2", tipo: "noticias", nombre: "DOF", ultima_lectura_at: null, ultimo_estado: null })] });
    estado.hallazgos = q({ data: [hallazgo()] });
    abrir();
    const fuentes = within(screen.getByTestId("investigador-fuentes"));
    expect(fuentes.getByText("Competidor A")).toBeTruthy(); expect(fuentes.getByText(/Noticias · sin leer todavía/)).toBeTruthy();
    const h = within(screen.getByTestId("investigador-hallazgos"));
    expect(h.getByText("Ahora ofrece una promoción.")).toBeTruthy(); expect(h.getByText(/cambio en la página/)).toBeTruthy();
    const a = h.getByText("Abrir fuente") as HTMLAnchorElement;
    expect(a.href).toBe("https://a.example.com/"); expect(a.target).toBe("_blank"); expect(a.rel).toBe("noopener noreferrer nofollow");
  });

  it("el texto de páginas externas se muestra como texto (nunca como HTML) y solo se abren enlaces https", () => {
    estado.fuentes = q<FuenteWebFila>({});
    estado.hallazgos = q({ data: [
      hallazgo({ id: "x1", titulo: "<img src=x onerror=alert(1)>", resumen: "<script>alert(1)</script> <b>negrita</b>" }),
      hallazgo({ id: "x2", titulo: "Con javascript", enlace: "javascript:alert(1)" }),
      hallazgo({ id: "x3", titulo: "Con http", enlace: "http://a.example.com/" }),
      hallazgo({ id: "x4", tipo: "nota_nueva", titulo: "Nota SAT", enlace: "https://sat.example.gob.mx/n", publicado_at: "2026-11-15T10:00:00Z" }),
    ] });
    abrir();
    const lista = screen.getByTestId("investigador-hallazgos");
    expect(lista.querySelector("img")).toBeNull(); expect(lista.querySelector("script")).toBeNull(); expect(lista.querySelector("b")).toBeNull();
    expect(within(lista).getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(within(lista).getByText(/<script>alert\(1\)<\/script> <b>negrita<\/b>/)).toBeTruthy();
    const enlaces = [...lista.querySelectorAll("a")].map((a) => (a as HTMLAnchorElement).href);
    expect(enlaces).toEqual(["https://a.example.com/", "https://sat.example.gob.mx/n"]); // x1 y x4; ni javascript: ni http: tienen enlace
    expect(enlaces.every((u) => u.startsWith("https://"))).toBe(true);
    expect(within(lista).getByText(/nota nueva/)).toBeTruthy();
  });

  it("si no se pueden leer las fuentes o los hallazgos, lo dice sin romper la pantalla", () => {
    estado.fuentes = q<FuenteWebFila>({ data: undefined, isError: true }); estado.hallazgos = q<HallazgoWeb>({ data: undefined, isError: true });
    abrir();
    expect(screen.getByTestId("investigador-fuentes-error")).toBeTruthy(); expect(screen.getByTestId("investigador-hallazgos-error")).toBeTruthy();
  });

  it("muestra las propuestas del agente con su motivo, como texto, y solo abre enlaces https; el error de lectura no rompe la pantalla", () => {
    estado.fuentes = q<FuenteWebFila>({}); estado.hallazgos = q<HallazgoWeb>({});
    estado.propuestas = q({ data: [prop(), prop({ id: "p2", nombre: "<img src=x onerror=alert(1)>", motivo: "<script>alert(1)</script> motivo", url: "javascript:alert(1)", formato: "feed", tipo: "noticias", verificada_at: null })] });
    abrir();
    const lista = screen.getByTestId("investigador-propuestas");
    expect(lista.querySelector("img")).toBeNull(); expect(lista.querySelector("script")).toBeNull();
    expect(within(lista).getByText("<img src=x onerror=alert(1)>")).toBeTruthy(); expect(within(lista).getByText(/<script>alert\(1\)<\/script> motivo/)).toBeTruthy();
    expect(within(lista).getByText(/Competencia · página · verificada/)).toBeTruthy(); expect(within(lista).getByText(/Noticias · feed de noticias$/)).toBeTruthy();
    expect([...lista.querySelectorAll("a")].map((a) => (a as HTMLAnchorElement).href)).toEqual(["https://b.example.com/"]);
    cleanup();
    estado.propuestas = q<FuentePropuesta>({ data: undefined, isError: true }); abrir();
    expect(screen.getByTestId("investigador-propuestas-error")).toBeTruthy();
  });
});
