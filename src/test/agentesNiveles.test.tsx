import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VistaCatalogo, SelectorNivel } from "@/components/agentes/NivelesOficina";
import {
  AGENTES_INTERNACIONALES, AGENTES_LOUIS, AREAS_INTERNACIONALES, UTILERIAS, catalogoDeNivel, comoAgenteRegistro, comoFigura, esDelCatalogo, leerNivel, zonaDeFlujo,
} from "@/lib/agentes/louis";
import { DEPARTAMENTOS, agruparPorDepartamento, MAX_ISLAS } from "@/lib/agentes/departamentos";
import { distribuirSala, PASO } from "@/lib/agentes/salas";
import { leerVista, escribirVista, VISTA_PLANO } from "@/lib/agentes/vistas";

describe("catálogo de Louis", () => {
  it("tiene los 22 kawiil-* y 4 revisores en el nivel Louis, y 68 flujos en el nivel Internacional", () => {
    expect(AGENTES_LOUIS.filter((a) => a.origen === "kawiil-louis")).toHaveLength(22);
    expect(AGENTES_LOUIS.filter((a) => a.origen === "revisor")).toHaveLength(4);
    expect(AGENTES_INTERNACIONALES).toHaveLength(68);
    expect(catalogoDeNivel("kawiil")).toEqual([]);
  });
  it("claves e ids únicos, todos con su departamento y sin las utilerías", () => {
    const todos = [...AGENTES_LOUIS, ...AGENTES_INTERNACIONALES];
    expect(new Set(todos.map((a) => a.id)).size).toBe(todos.length);
    expect(new Set(todos.map((a) => a.clave)).size).toBe(todos.length);
    for (const a of todos) { expect(DEPARTAMENTOS[a.depto]).toBeTruthy(); expect(esDelCatalogo(a.id)).toBe(true); expect(a.rol.length).toBeGreaterThan(10); }
    for (const u of UTILERIAS) expect(AGENTES_INTERNACIONALES.some((a) => a.clave.endsWith(`-${u}`))).toBe(false);
    expect(UTILERIAS).toHaveLength(3);
  });
  it("las 8 áreas internacionales tienen 17, 10, 9, 9, 7, 6, 6 y 4 flujos", () => {
    const n = AREAS_INTERNACIONALES.map((a) => AGENTES_INTERNACIONALES.filter((x) => x.depto === a.depto).length);
    expect(AREAS_INTERNACIONALES.map((a) => a.nombre)).toEqual(["Laboral", "Corporativo", "Comercial", "Propiedad intelectual", "Gobernanza de IA", "Privacidad", "Regulatorio", "Producto"]);
    expect(n).toEqual([17, 10, 9, 9, 7, 6, 6, 4]);
  });
  it("los agentes que comparten nombre con el registro lo dicen en su nombre", () => {
    const nombres = AGENTES_LOUIS.map((a) => a.nombre);
    for (const n of ["Amatl (Louis)", "Nelli (Louis)", "Tepantli (Louis)"]) expect(nombres).toContain(n);
  });
  it("la zona de trabajo se deduce del flujo", () => {
    expect(zonaDeFlujo("investigation-open")).toBe("Investigaciones");
    expect(zonaDeFlujo("renewal-tracker")).toBe("Vigilancia");
    expect(zonaDeFlujo("reg-feed-watcher")).toBe("Vigilancia");
    expect(zonaDeFlujo("gaps")).toBe("Vigilancia");
    expect(zonaDeFlujo("use-case-triage")).toBe("Triaje");
    expect(zonaDeFlujo("nda-review")).toBe("Revisión");
    expect(zonaDeFlujo("board-minutes")).toBe("Redacción");
    expect(zonaDeFlujo("reg-gap-analysis")).toBe("Análisis");
    expect(new Set(AGENTES_INTERNACIONALES.map((a) => a.zona))).toEqual(new Set(["Investigaciones", "Vigilancia", "Triaje", "Revisión", "Redacción", "Análisis"]));
  });
  it("se adaptan a los componentes del registro: sin señal y sin tareas", () => {
    const c = AGENTES_LOUIS[0];
    expect(comoAgenteRegistro(c)).toMatchObject({ id: c.id, name: c.clave, kind: "louis", last_heartbeat: null, config: { departamento: c.depto } });
    expect(comoFigura(c)).toMatchObject({ id: c.id, clave: c.clave, estado: "apagado" });
  });
  it("leerNivel acepta solo los niveles conocidos", () => {
    expect([leerNivel(null), leerNivel("louis"), leerNivel("internacional"), leerNivel("x")]).toEqual(["kawiil", "louis", "internacional", "kawiil"]);
  });
});

describe("islas y salas del catálogo", () => {
  const grupos = (n: "louis" | "internacional") => { const c = catalogoDeNivel(n); return agruparPorDepartamento(c.map(comoFigura), c.map(comoAgenteRegistro)); };
  it("Louis son 6 islas y Internacional 8, ninguna juntada en «Otros»", () => {
    expect(MAX_ISLAS).toBe(8);
    expect(grupos("louis")).toHaveLength(6);
    expect(grupos("internacional")).toHaveLength(8);
    expect(grupos("internacional").every((g) => g.depto.clave !== "otros")).toBe(true);
    expect(grupos("internacional").reduce((n, g) => n + g.figuras.length, 0)).toBe(68);
  });
  it("cada zona de la sala queda en lugares contiguos y nadie se encima", () => {
    const lab = AGENTES_INTERNACIONALES.filter((a) => a.depto === "i_laboral");
    const zonaDe = new Map(lab.map((a) => [a.clave, a.zona]));
    const s = distribuirSala("i_laboral", lab, (a) => a.clave, (a) => zonaDe.get(a.clave)!);
    expect(s.puestos).toHaveLength(17);
    expect(s.zonas.map((z) => z.nombre).sort()).toEqual([...new Set(lab.map((a) => a.zona))].sort());
    for (const p of s.puestos) for (const q of s.puestos) if (p !== q) expect(Math.abs(p.u - q.u) >= PASO - 0.45 || Math.abs(p.v - q.v) >= PASO - 0.45).toBe(true);
    for (const z of s.zonas) expect(z.claves.length).toBe(lab.filter((a) => a.zona === z.nombre).length);
  });
});

describe("URL del catálogo", () => {
  it("un agente del catálogo se puede abrir por su enlace", () => {
    expect(leerVista("agente:louis:kawiil-calli")).toEqual({ tipo: "agente", id: "louis:kawiil-calli" });
    expect(leerVista("agente:louis:../x")).toEqual(VISTA_PLANO);
    expect(escribirVista({ tipo: "agente", id: "louis:kawiil-calli" })).toBe("agente:louis:kawiil-calli");
    expect(leerVista("isla:i_laboral")).toEqual({ tipo: "isla", clave: "i_laboral" });
  });
});

describe("VistaCatalogo", () => {
  it("el plano avisa que es un catálogo sin señal y cada isla se abre", () => {
    const onVista = vi.fn();
    render(<VistaCatalogo nivel="internacional" vista={VISTA_PLANO} onVista={onVista} />);
    expect(screen.getByTestId("catalogo-aviso").textContent).toContain("68 agentes en 8 islas");
    expect(screen.queryByTestId("plano-tareas")).toBeNull();
    fireEvent.click(screen.getByTestId("isla-abrir-i_laboral"));
    expect(onVista).toHaveBeenCalledWith({ tipo: "isla", clave: "i_laboral" });
  });
  it("la isla abierta muestra su sala con zonas de trabajo y la etiqueta «En catálogo»", () => {
    const onVista = vi.fn();
    render(<VistaCatalogo nivel="internacional" vista={{ tipo: "isla", clave: "i_laboral" }} onVista={onVista} />);
    expect(screen.getByTestId("isla-titulo").textContent).toBe("Laboral");
    expect(screen.getByTestId("sala-i_laboral")).toBeTruthy();
    expect(screen.getByLabelText("Revisión de terminaciones: En catálogo")).toBeTruthy();
    expect(screen.getByTestId("sala-zonas").textContent).toContain("Investigaciones");
    fireEvent.click(screen.getByTestId("sala-agente-louis:legal-employment-nda".replace("nda", "hiring-review")));
    expect(onVista).toHaveBeenCalledWith({ tipo: "agente", id: "louis:legal-employment-hiring-review" });
  });
  it("la ficha dice que no está en el registro ni recibe tareas, y deja volver", () => {
    const onVista = vi.fn();
    render(<VistaCatalogo nivel="louis" vista={{ tipo: "agente", id: "louis:kawiil-amatl" }} onVista={onVista} />);
    expect(screen.getByTestId("ficha-nombre").textContent).toBe("Amatl (Louis)");
    expect(screen.getByTestId("ficha-rol").textContent).toContain("Gestión documental");
    expect(screen.getByTestId("ficha-pendiente").textContent).toContain("no escribe tareas ni latidos");
    expect(screen.queryByTestId("panel-agente")).toBeNull();
    fireEvent.click(screen.getByTestId("volver-isla"));
    expect(onVista).toHaveBeenCalledWith({ tipo: "isla", clave: "l_documentos" });
  });
  it("un agente o una isla que no existen avisan en vez de quedar en blanco", () => {
    const { unmount } = render(<VistaCatalogo nivel="louis" vista={{ tipo: "agente", id: "louis:no-existe" }} onVista={vi.fn()} />);
    expect(screen.getByTestId("catalogo-no-existe")).toBeTruthy(); unmount();
    render(<VistaCatalogo nivel="louis" vista={{ tipo: "isla", clave: "i_laboral" }} onVista={vi.fn()} />);
    expect(screen.getByTestId("catalogo-no-existe")).toBeTruthy();
  });
  it("el selector de nivel marca el actual y avisa el cambio", () => {
    const onNivel = vi.fn();
    render(<SelectorNivel nivel="louis" onNivel={onNivel} />);
    expect(screen.getByTestId("nivel-louis").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("nivel-internacional"));
    expect(onNivel).toHaveBeenCalledWith("internacional");
  });
});
