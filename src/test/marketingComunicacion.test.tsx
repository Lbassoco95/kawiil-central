import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { OficinaAgentes, type AnalistaProps } from "@/components/marketing/OficinaAgentes";
import { altoOficina, hayCmo, personajes, DESPLAZA_CMO } from "@/components/marketing/oficinaAgentesLogica";
import type { AgenteRegistro } from "@/components/marketing/agentesRegistroLogica";
import type { RespuestaAnalista } from "@/hooks/useMarketing";
import type { PropuestaComunicado } from "@/lib/comunicados";

beforeAll(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext; });
afterEach(cleanup);

const ag = (name: string, o: Partial<AgenteRegistro> = {}): AgenteRegistro => ({
  id: name, name, display_name: name, description: `Descripción de ${name}`, role: name, status: "idle", kind: "system", last_heartbeat: null, last_task_at: null,
  tasks_completed: 0, tasks_failed: 0, config: { objetivo: `Objetivo de ${name}`, cadencia: "bajo_demanda" }, ...o,
});
const AGENTES = [ag("marketing_cmo"), ag("marketing_comunicacion", { display_name: "Comunicación interna" }), ag("marketing_vigilante", { config: { objetivo: "x" } }), ag("marketing_analista")];
const AHORA = new Date("2026-11-16T15:00:00Z");

const PROPUESTA: PropuestaComunicado = { titulo: "Lunes 16 no se trabaja", mensaje: "El lunes 16 de noviembre es día de descanso.\nNos vemos el martes.", vigente_desde: "2026-11-13", vigente_hasta: "2026-11-16", avisar_al_entrar: true };
const conBloque = (p: unknown) => `Te dejo el borrador:\n\n\`\`\`comunicado\n${JSON.stringify(p)}\n\`\`\`\n\nAvísame si cambio algo.`;

type Callbacks = { guardarBorrador: ReturnType<typeof vi.fn>; publicarPropuesta: ReturnType<typeof vi.fn> };
function abrir(respuesta: string | RespuestaAnalista, o: { sinPermiso?: boolean; guardar?: unknown; publicar?: unknown } = {}) {
  const cb: Callbacks = { guardarBorrador: vi.fn(async () => (o.guardar ?? { ok: true, id: "b1" })), publicarPropuesta: vi.fn(async () => (o.publicar ?? { ok: true, id: "b1" })) };
  const preguntar = vi.fn(async (): Promise<RespuestaAnalista> => typeof respuesta === "string" ? { ok: true, respuesta, verificada: null, no_verificadas: [], fuentes: [{ herramienta: "comunicados_recientes", filas: 0, corte: null }] } : respuesta);
  const analista: AnalistaProps = {
    consultas: [], estadoConsultas: "ok", preguntar: vi.fn(),
    comunicacion: { consultas: [], estadoConsultas: "ok", preguntar, ...(o.sinPermiso ? {} : { comunicados: cb as unknown as NonNullable<AnalistaProps["comunicacion"]>["comunicados"] }) },
  };
  render(<OficinaAgentes agentes={AGENTES} tareasMarketing={[]} estadoAgentes="ok" estadoTareas="ok" ahora={AHORA} analista={analista} />);
  fireEvent.click(screen.getByTestId("oficina-agente-Comunicación"));
  return { cb, preguntar };
}
const pedir = async (texto = "El lunes 16 no se trabaja, avísale al equipo") => {
  fireEvent.change(screen.getByTestId("analista-caja"), { target: { value: texto } });
  fireEvent.click(screen.getByTestId("analista-enviar"));
};

describe("Comunicación interna en la oficina", () => {
  it("se sienta en la franja «Dirección» junto al CMO (sin bajar) y los demás bajan; va después del CMO", () => {
    const l = personajes(AGENTES, [], AHORA);
    expect(l.map((p) => p.aspecto.corto)).toEqual(["CMO", "Comunicación", "Vigilante", "Analista"]);
    const y = (c: string) => l.find((p) => p.clave === c)!.aspecto.y;
    expect(y("marketing_comunicacion")).toBe(48); expect(y("marketing_cmo")).toBe(48);
    expect(y("marketing_vigilante")).toBeGreaterThanOrEqual(84 + DESPLAZA_CMO);
    const x = (c: string) => l.find((p) => p.clave === c)!.aspecto.x;
    expect(x("marketing_cmo") - x("marketing_comunicacion")).toBeGreaterThanOrEqual(60); // no se encima con el CMO
  });
  it("con solo Comunicación (sin CMO) la oficina también gana la franja de arriba", () => {
    const l = personajes([ag("marketing_comunicacion"), ag("marketing_vigilante")], [], AHORA);
    expect(hayCmo(l)).toBe(true); expect(altoOficina(l)).toBeGreaterThan(altoOficina(personajes([ag("marketing_vigilante")], [], AHORA)));
    expect(l.find((p) => p.clave === "marketing_comunicacion")!.aspecto.y).toBe(48);
  });
  it("su panel tiene textos propios, no ofrece seguimientos y explica que solo redacta y propone", () => {
    abrir("Hola");
    expect(screen.getByText("Cuéntale qué hay que comunicar al equipo")).toBeTruthy();
    expect(screen.getByTestId("analista-enviar").textContent).toBe("Redactar");
    expect(screen.queryByTestId("analista-nuevo-seguimiento")).toBeNull();
    expect(screen.getByText(/solo redacta y propone: no publica ni envía nada/)).toBeTruthy();
    expect(screen.queryByTestId("oficina-proximamente")).toBeNull();
  });
  it("sin el panel de Comunicación (por ejemplo, sin permiso de ver) conserva el aviso de «siguiente fase»", () => {
    render(<OficinaAgentes agentes={AGENTES} tareasMarketing={[]} estadoAgentes="ok" estadoTareas="ok" ahora={AHORA} analista={{ consultas: [], estadoConsultas: "ok", preguntar: vi.fn() }} />);
    fireEvent.click(screen.getByTestId("oficina-agente-Comunicación")); expect(screen.getByTestId("oficina-proximamente")).toBeTruthy();
  });
});

describe("propuesta de comunicado", () => {
  it("muestra la propuesta como tarjeta (título, mensaje con saltos, vigencia y dónde se verá), sin JSON crudo y sin insignia de cifras", async () => {
    abrir(conBloque(PROPUESTA)); await pedir();
    const tarjeta = await screen.findByTestId("propuesta-comunicado");
    expect(within(tarjeta).getByTestId("propuesta-titulo").textContent).toBe("Lunes 16 no se trabaja");
    expect(within(tarjeta).getByTestId("propuesta-mensaje").textContent).toBe("El lunes 16 de noviembre es día de descanso.\nNos vemos el martes.");
    expect(within(tarjeta).getByTestId("propuesta-donde").textContent).toBe("Vigencia: del viernes 13 al lunes 16 de noviembre de 2026. Se mostrará al abrir el sistema (del viernes 13 al lunes 16 de noviembre de 2026).");
    const respuesta = screen.getByTestId("analista-respuesta");
    expect(respuesta.textContent).toContain("Te dejo el borrador:"); expect(respuesta.textContent).not.toContain("```"); expect(respuesta.textContent).not.toContain('"titulo"');
    expect(screen.queryByText("Cifras verificadas")).toBeNull(); expect(screen.queryByText("Cifras sin verificar")).toBeNull();
  });
  it("«Guardar como borrador» manda exactamente la propuesta, una sola vez, y dice dónde revisarla", async () => {
    const { cb } = abrir(conBloque(PROPUESTA)); await pedir();
    fireEvent.click(await screen.findByTestId("propuesta-guardar"));
    expect((await screen.findByTestId("propuesta-guardada")).textContent).toContain("Guardado como borrador. Revísalo y publícalo en Hub → Comunicados.");
    expect(cb.guardarBorrador).toHaveBeenCalledTimes(1); expect(cb.guardarBorrador).toHaveBeenCalledWith(PROPUESTA);
    expect(screen.queryByTestId("propuesta-guardar")).toBeNull(); expect(screen.queryByTestId("propuesta-publicar")).toBeNull(); // no se puede guardar dos veces
    expect(cb.publicarPropuesta).not.toHaveBeenCalled();
  });
  it("«Aprobar y publicar» pide confirmación: no publica hasta el «Sí»; «Cancelar» vuelve atrás", async () => {
    const { cb } = abrir(conBloque(PROPUESTA)); await pedir();
    fireEvent.click(await screen.findByTestId("propuesta-publicar"));
    expect(screen.getByTestId("propuesta-confirmar").textContent).toContain("¿Publicarlo para todo el equipo?"); expect(cb.publicarPropuesta).not.toHaveBeenCalled(); expect(cb.guardarBorrador).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("propuesta-confirmar-no")); expect(screen.queryByTestId("propuesta-confirmar")).toBeNull(); expect(screen.getByTestId("propuesta-publicar")).toBeTruthy();
    fireEvent.click(screen.getByTestId("propuesta-publicar")); fireEvent.click(screen.getByTestId("propuesta-confirmar-si"));
    expect((await screen.findByTestId("propuesta-publicada")).textContent).toBe("Publicado. El equipo lo verá al abrir el sistema.");
    expect(cb.publicarPropuesta).toHaveBeenCalledTimes(1); expect(cb.publicarPropuesta).toHaveBeenCalledWith(PROPUESTA); expect(screen.queryByTestId("propuesta-publicar")).toBeNull();
  });
  it("si falla guardar, lo dice y deja reintentar; si se guardó el borrador pero no se pudo publicar, no ofrece reintentar (crearía un duplicado)", async () => {
    let r = abrir(conBloque(PROPUESTA), { guardar: { ok: false, error: "Solo Dirección puede guardar borradores de comunicados" } }); await pedir();
    fireEvent.click(await screen.findByTestId("propuesta-guardar"));
    expect((await screen.findByTestId("propuesta-error")).textContent).toBe("Solo Dirección puede guardar borradores de comunicados"); expect(screen.getByTestId("propuesta-guardar")).toBeTruthy();
    cleanup();
    r = abrir(conBloque(PROPUESTA), { publicar: { ok: false, id: "b9", error: "Se guardó como borrador, pero no se pudo publicar: La vigencia ya terminó: pide un comunicado con fechas nuevas" } }); await pedir();
    fireEvent.click(await screen.findByTestId("propuesta-publicar")); fireEvent.click(screen.getByTestId("propuesta-confirmar-si"));
    const aviso = await screen.findByTestId("propuesta-guardada");
    expect(aviso.textContent).toContain("Se guardó como borrador, pero no se pudo publicar"); expect(aviso.textContent).toContain("publícalo en Hub → Comunicados");
    expect(screen.queryByTestId("propuesta-publicar")).toBeNull(); expect(r.cb.publicarPropuesta).toHaveBeenCalledTimes(1);
  });
  it("si la acción lanza un error inesperado, no truena la pantalla", async () => {
    const { cb } = abrir(conBloque(PROPUESTA)); cb.guardarBorrador.mockRejectedValueOnce(new Error("red")); await pedir();
    fireEvent.click(await screen.findByTestId("propuesta-guardar")); expect((await screen.findByTestId("propuesta-error")).textContent).toBe("No se pudo completar la acción.");
  });
  it("sin permiso de decidir, muestra la propuesta pero no ofrece guardar ni publicar", async () => {
    abrir(conBloque(PROPUESTA), { sinPermiso: true }); await pedir();
    expect(await screen.findByTestId("propuesta-sin-permiso")).toBeTruthy(); expect(screen.queryByTestId("propuesta-guardar")).toBeNull(); expect(screen.queryByTestId("propuesta-publicar")).toBeNull();
  });
  it("si el agente no manda un bloque válido, no inventa una tarjeta: lo dice y no muestra el JSON roto", async () => {
    abrir(conBloque({ ...PROPUESTA, vigente_hasta: "2020-01-01" })); await pedir();
    expect(await screen.findByTestId("propuesta-invalida")).toBeTruthy(); expect(screen.queryByTestId("propuesta-comunicado")).toBeNull(); expect(screen.getByTestId("analista-respuesta").textContent).not.toContain("vigente_hasta");
  });
  it("una respuesta solo de texto (el agente pregunta algo) se ve normal, sin tarjeta", async () => {
    abrir("¿Para qué día es? Dime el día y lo preparo."); await pedir("avisa que no se trabaja");
    expect((await screen.findByTestId("analista-respuesta")).textContent).toContain("¿Para qué día es?"); expect(screen.queryByTestId("propuesta-comunicado")).toBeNull(); expect(screen.queryByTestId("propuesta-invalida")).toBeNull();
  });
  it("el HTML dentro de la propuesta se pinta como texto", async () => {
    abrir(conBloque({ ...PROPUESTA, titulo: "<img src=x onerror=alert(1)>", mensaje: "<script>alert(1)</script>" })); await pedir();
    const tarjeta = await screen.findByTestId("propuesta-comunicado");
    expect(tarjeta.querySelector("img")).toBeNull(); expect(tarjeta.querySelector("script")).toBeNull();
    expect(within(tarjeta).getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  });
  it("una propuesta sin fechas se ve en Hub → Comunicados y no promete aviso al entrar", async () => {
    abrir(conBloque({ titulo: "Nuevo horario", mensaje: "El horario cambia.", vigente_desde: null, vigente_hasta: null, avisar_al_entrar: false })); await pedir();
    expect((await screen.findByTestId("propuesta-donde")).textContent).toBe("Sin fechas. Se verá solo en Hub → Comunicados.");
    fireEvent.click(screen.getByTestId("propuesta-publicar")); expect(screen.getByTestId("propuesta-confirmar").textContent).toContain("Se verá solo en Hub → Comunicados.");
  });
});
