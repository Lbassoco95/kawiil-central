import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const J = "11111111-1111-4111-8111-111111111111";   // Vizumi (jefe)
const V = "22222222-2222-4222-8222-222222222222";   // Vigilante SITI (creado por Vizumi)
const N = "33333333-3333-4333-8333-333333333333";   // Nelli (sin creador)
const T0 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", T1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AHORA = new Date("2026-11-25T12:00:00Z");
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();

vi.mock("@/components/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useAgentesEnVivo", () => ({ useAgentesEnVivo: () => "conectado" }));
vi.mock("@/components/agentes/IndicadorEnVivo", () => ({ IndicadorEnVivo: () => null }));
vi.mock("@/components/agentes/TrabajosAgente", () => ({ TrabajosAgente: ({ agentId, convInicial }: { agentId: string; convInicial?: string | null }) => <div data-testid="stub-chat">{agentId}|{convInicial ?? ""}</div> }));
const tareasSeg = vi.hoisted(() => ({ data: [] as unknown[], isLoading: false, isError: false }));
vi.mock("@/hooks/useSeguimientoAgentes", () => ({ useTareasSeguimiento: () => tareasSeg }));
const registro = vi.hoisted(() => ({ agentes: [] as unknown[], tareas: [] as unknown[] }));
vi.mock("@/hooks/useAgentesRegistro", () => ({
  useAgentesRegistro: () => ({ data: registro.agentes, isLoading: false, isError: false, dataUpdatedAt: 0 }),
  useTareasAgentes: () => ({ data: registro.tareas, isLoading: false, isError: false, dataUpdatedAt: 0 }),
}));

import { creacionDe, oficinasDe, llamadasDeOficina, resumenLlamadas, textoAgentes } from "@/lib/agentes/equipos";
import { distribuirSala, distribuirOficinas } from "@/lib/agentes/salas";
import { agruparPorDepartamento, DEPARTAMENTOS } from "@/lib/agentes/departamentos";
import { figurasOficina } from "@/lib/agentes/oficina";
import { leerVista, escribirVista } from "@/lib/agentes/vistas";
import { urlChat, leerAbiertos, estadoVisible } from "@/lib/agentes/chat";
import { SalaIsometrica } from "@/components/agentes/SalaIsometrica";
import { OficinaEquipo } from "@/components/agentes/OficinaEquipo";
import { ResumenConversacion } from "@/components/agentes/ResumenConversacion";
import { AvisoAgentesCreados } from "@/components/agentes/AvisoAgentesCreados";
import AgentesChat from "@/pages/AgentesChat";
import type { AgenteRegistro, TareaAgente } from "@/lib/agentes/registro";

const ag = (id: string, name: string, config: Record<string, unknown> | null = null, o: Partial<AgenteRegistro> = {}): AgenteRegistro => ({
  id, name, display_name: name, description: null, role: null, status: "idle", kind: "consultable", last_heartbeat: hace(5), last_task_at: null, tasks_completed: 0, tasks_failed: 0, config, ...o,
});
const AGENTES = [
  ag(J, "vizumi_listas_y_kyc_vizum_vizum", {}, { display_name: "Vizumi" }),
  ag(V, "vigilante_siti", { creado_por: { tipo: "agente", id: J, para: "Revisar cada día SITI AA y SITI PLD" }, creado_en: hace(60 * 24) }, { display_name: "Vigilante SITI" }),
  ag(N, "nelli", null, { display_name: "Nelli" }),
];
const ta = (id: string, agent_id: string, status: string, o: Partial<TareaAgente> = {}): TareaAgente => ({ id, agent_id, task_type: "consulta_siti", status, created_at: hace(30), started_at: null, completed_at: null, ...o });
const TAREAS = [ta(T0, V, "completed"), ta(T1, J, "in_progress", { source_task_id: T0 })];
const figs = figurasOficina(AGENTES, TAREAS, AHORA);

describe("R1 · quién creó a cada agente", () => {
  it("lee al creador del registro: persona (como lo escribe el Constructor), agente o nada", () => {
    expect(creacionDe(ag("x", "x", { creado_por: "uuid-persona", creado_en: "2026-11-01T10:00:00Z", mision: "Vigilar vencimientos de Vizum." }))).toEqual({ tipo: "persona", creadorId: "uuid-persona", cuando: "2026-11-01T10:00:00Z", para: "Vigilar vencimientos de Vizum." });
    expect(creacionDe(AGENTES[1])).toMatchObject({ tipo: "agente", creadorId: J, para: "Revisar cada día SITI AA y SITI PLD" });
    expect(creacionDe(AGENTES[0])).toBeNull();
    expect(creacionDe(ag("x", "x", { creado_por: { tipo: "marciano" } }))).toBeNull();
  });
  it("una oficina existe solo si su jefe es un agente activo con agentes creados por él; nadie es su propio jefe", () => {
    const [o] = oficinasDe(AGENTES);
    expect(o.nombre).toBe("Oficina de Vizumi");
    expect(o.miembros.map((m) => m.agente.id)).toEqual([V]);
    expect(oficinasDe([AGENTES[1]])).toEqual([]);   // el jefe no está en el registro
    expect(oficinasDe([ag(J, "j", { creado_por: { tipo: "agente", id: J } })])).toEqual([]);
    expect(oficinasDe(AGENTES.map((a) => (a.id === J ? { ...a, status: "archived" } : a)))).toEqual([]);
  });
  it("lo que crea una persona sigue en el equipo principal: no hay oficina", () => {
    expect(oficinasDe([AGENTES[0], ag(V, "v", { creado_por: "uuid-persona", creado_en: hace(10) })])).toEqual([]);
  });
  it("el agente de la oficina cuenta en la isla de su jefe (Cumplimiento) aunque su nombre no diga nada", () => {
    const grupos = agruparPorDepartamento(figs, AGENTES);
    const cumpl = grupos.find((g) => g.depto.clave === "cumplimiento")!;
    expect(cumpl.figuras.map((f) => f.id).sort()).toEqual([J, N, V].sort());
    expect(cumpl.oficinas.map((o) => o.jefeId)).toEqual([J]);
  });
  it("las llamadas entre agentes de la oficina salen de los registros reales; sin registros, nada", () => {
    const [o] = oficinasDe(AGENTES);
    const ls = llamadasDeOficina(o, TAREAS);
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ de: V, a: J, estado: "en_curso", conversacionOrigen: T0 });
    expect(resumenLlamadas(ls, AHORA)).toEqual({ semana: 1, enCurso: 1, conError: 0 });
    expect(llamadasDeOficina(o, [ta(T0, V, "completed")])).toEqual([]);
  });
});

describe("R1.b y R1.d · la oficina se dibuja y crece dentro de la sala", () => {
  it("coloca la oficina debajo de las zonas, con un lugar libre al final, y la sala crece si hace falta", () => {
    const base = distribuirSala("cumplimiento", figs.filter((f) => f.id !== V), (f) => f.clave);
    const e = distribuirOficinas(base, [{ clave: J, items: figs.filter((f) => f.id === V) }]);
    const [of] = e.oficinas;
    expect(of.escritorios).toHaveLength(2);
    expect(of.escritorios[0].item?.id).toBe(V);
    expect(of.escritorios[1].item).toBeNull();   // lugar libre
    expect(of.v0).toBeGreaterThan(Math.max(...base.zonas.map((z) => z.v1)));
    expect(e.n).toBeGreaterThanOrEqual(base.n);
    expect(of.v1).toBeLessThanOrEqual(e.n - 0.15);
  });
  it("con más agentes se ensancha, no se encima, y siempre queda un lugar libre", () => {
    const base = distribuirSala("cumplimiento", figs.slice(0, 1), (f) => f.clave);
    const muchos = Array.from({ length: 6 }, (_, k) => ({ ...figs[1], id: `m${k}`, clave: `m${k}` }));
    const e = distribuirOficinas(base, [{ clave: "o", items: muchos }]);
    const es = e.oficinas[0].escritorios;
    expect(es).toHaveLength(7);
    expect(es.filter((x) => !x.item)).toHaveLength(1);
    const pos = new Set(es.map((x) => `${x.u.toFixed(1)},${x.v.toFixed(1)}`));
    expect(pos.size).toBe(7);
  });
  it("la sala muestra el letrero con el nombre y el número de agentes, el lugar libre, y abre la pantalla de la oficina", () => {
    const onAbrir = vi.fn();
    const [o] = oficinasDe(AGENTES);
    render(<SalaIsometrica depto={DEPARTAMENTOS.cumplimiento} figuras={figs.filter((f) => f.id !== V)} oficinas={[{ clave: o.jefeId, nombre: o.nombre, tinte: o.tinte, figuras: figs.filter((f) => f.id === V) }]} onAbrirOficina={onAbrir} hrefPestana={(id) => `/agentes/chat/${id}`} />);
    const letrero = screen.getByTestId(`oficina-letrero-${J}`);
    expect(letrero.getAttribute("aria-label")).toBe("Oficina de Vizumi: 1 agente · Entrar");
    expect(screen.getByTestId(`oficina-libre-${J}`).textContent).toContain("Lugar libre");
    fireEvent.click(letrero);
    expect(onAbrir).toHaveBeenCalledWith(J);
    expect(screen.getByTestId(`lista-oficina-${J}`).textContent).toContain("Vigilante SITI");
    expect(screen.getByTestId(`sala-pestana-${V}`).getAttribute("target")).toBe("_blank");
    expect(screen.getByTestId(`sala-pestana-${V}`).getAttribute("href")).toBe(`/agentes/chat/${V}`);
  });
  it("sin oficinas, la sala se ve igual que antes (sin letreros)", () => {
    render(<SalaIsometrica depto={DEPARTAMENTOS.cumplimiento} figuras={figs.filter((f) => f.id !== V)} />);
    expect(screen.queryByTestId(`oficina-letrero-${J}`)).toBeNull();
  });
  it("la vista de la oficina vive en la URL", () => {
    expect(escribirVista({ tipo: "oficina", id: J })).toBe(`oficina:${J}`);
    expect(leerVista(`oficina:${J}`)).toEqual({ tipo: "oficina", id: J });
    expect(leerVista("oficina:no-es-uuid")).toEqual({ tipo: "plano" });
  });
});

describe("R1.b/c · pantalla de la oficina", () => {
  const [of] = oficinasDe(AGENTES);
  const montar = () => render(<MemoryRouter><OficinaEquipo oficina={of} jefe={AGENTES[0]} agentes={AGENTES} figuras={figs} tareas={TAREAS} ahora={AHORA} nombreSala="Cumplimiento" onVolverSala={() => {}} /></MemoryRouter>);
  it("muestra jefe, agentes con quién/cuándo/para qué, lugar libre, organigrama, llamadas e historial", () => {
    montar();
    expect(screen.getByTestId("oficina-nombre").textContent).toBe("Oficina de Vizumi");
    expect(screen.getByTestId("oficina-contador").textContent).toContain("1 agente");
    expect(screen.getByTestId("oficina-hablar").getAttribute("href")).toBe(`/agentes/chat/${J}`);
    expect(screen.getByTestId("oficina-jefe-equipos").textContent).toContain("donde no dirige");
    const m = screen.getByTestId(`oficina-miembro-${V}`).textContent!;
    expect(m).toContain("Creado por Vizumi");
    expect(m).toContain("Para qué: Revisar cada día SITI AA y SITI PLD");
    expect(screen.getByTestId("oficina-lugar-libre").textContent).toContain("Lugar libre");
    expect(screen.getByTestId("oficina-pedir-crear").textContent).toBe("Pedirle a Vizumi que cree un agente");
    expect(screen.getByTestId("oficina-pedir-crear").getAttribute("href")).toBe(`/agentes/chat/${J}`);
    expect(screen.getByTestId(`organigrama-${V}`).textContent).toContain("reporta a Vizumi");
    expect(screen.getByTestId("organigrama-jefe").textContent).toContain("no dirige");
    expect(screen.getByTestId("oficina-llamadas-resumen").textContent).toBe("Esta semana: 1 · En curso: 1 · Con error: 0");
    expect(screen.getByTestId(`llamada-abrir-${T1}`).getAttribute("href")).toBe(`/agentes/chat/${V}?conv=${T0}`);
    expect(screen.getByTestId("oficina-historial").textContent).toContain("Vizumi creó a Vigilante SITI");
  });
  it("sin llamadas dice que aún no hay; nunca muestra ejemplos ni campos entre corchetes", () => {
    const { container } = render(<MemoryRouter><OficinaEquipo oficina={of} jefe={AGENTES[0]} agentes={AGENTES} figuras={figs} tareas={[]} ahora={AHORA} nombreSala="Cumplimiento" onVolverSala={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId("oficina-llamadas-vacio")).toBeTruthy();
    container.querySelectorAll("style").forEach((n) => n.remove());   // el CSS del dibujo lleva corchetes de selectores; el texto visible no
    expect(container.textContent).not.toMatch(/\[[^\]]+\]/);
  });
});

describe("R1.e.4 · aviso cuando un agente crea a otro", () => {
  beforeEach(() => localStorage.clear());
  it("dice quién, para qué, cuándo y permisos; ofrece ver la oficina y revisar permisos; «Pausar» queda desactivado", () => {
    const ver = vi.fn(), rev = vi.fn();
    render(<MemoryRouter><AvisoAgentesCreados agentes={AGENTES} ahora={AHORA} onVerOficina={ver} onRevisarPermisos={rev} /></MemoryRouter>);
    const a = screen.getByTestId(`aviso-creado-${V}`).textContent!;
    expect(a).toContain("Vizumi creó a Vigilante SITI");
    expect(a).toContain("Para qué: Revisar cada día SITI AA y SITI PLD");
    expect(a).toContain("Permisos: aún sin definir por Dirección");
    fireEvent.click(screen.getByTestId(`aviso-ver-${V}`)); expect(ver).toHaveBeenCalledWith(J);
    fireEvent.click(screen.getByTestId(`aviso-permisos-${V}`)); expect(rev).toHaveBeenCalledWith(V);
    expect((screen.getByTestId(`aviso-pausar-${V}`) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId(`aviso-visto-${V}`));
    expect(screen.queryByTestId("aviso-creados")).toBeNull();
  });
  it("no avisa de agentes creados por personas ni de creaciones de hace más de 14 días", () => {
    const viejos = AGENTES.map((a) => (a.id === V ? { ...a, config: { ...a.config, creado_en: hace(60 * 24 * 30) } } : a));
    const { container } = render(<MemoryRouter><AvisoAgentesCreados agentes={viejos} ahora={AHORA} onVerOficina={() => {}} onRevisarPermisos={() => {}} /></MemoryRouter>);
    expect(container.textContent).toBe("");
  });
});

describe("R2.b · el panel de la sala no escribe; el chat va aparte", () => {
  it("el resumen de la última conversación solo trae «Abrir el chat» y «Abrir en pestaña», sin cuadro para escribir", () => {
    tareasSeg.data = [
      { id: T0, agent_id: V, agente: "Vigilante SITI", titulo: "Revisión de SITI AA", estado: "completed", tipo: "x", prioridad: "normal", creada: hace(120), inicio: null, fin: null, resumen: "Revisó SITI AA.", con_error: false, entregables: 1, hilo: null },
    ];
    const { container } = render(<MemoryRouter><ResumenConversacion agentId={V} nombre="Vigilante SITI" ahora={AHORA} /></MemoryRouter>);
    expect(screen.getByTestId("resumen-ultima").textContent).toContain("Revisión de SITI AA");
    expect(screen.getByTestId("abrir-chat").getAttribute("href")).toBe(`/agentes/chat/${V}?conv=${T0}`);
    expect(screen.getByTestId("abrir-pestana").getAttribute("target")).toBe("_blank");
    expect(container.querySelector("textarea, input[type=text], input:not([type])")).toBeNull();
  });
  it("sin conversaciones lo dice y el botón sigue ahí", () => {
    tareasSeg.data = [];
    render(<MemoryRouter><ResumenConversacion agentId={V} nombre="Vigilante SITI" ahora={AHORA} /></MemoryRouter>);
    expect(screen.getByTestId("resumen-vacio")).toBeTruthy();
    expect(screen.getByTestId("abrir-chat").getAttribute("href")).toBe(`/agentes/chat/${V}`);
  });
});

describe("R2 · una pestaña por agente, con dirección propia", () => {
  const Ruta = () => { const l = useLocation(); return <span data-testid="ruta">{l.pathname}{l.search}</span>; };
  const montar = (url: string) => render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/agentes/chat/:agenteId" element={<><AgentesChat /><Ruta /></>} /><Route path="*" element={<Ruta />} /></Routes></MemoryRouter>);
  beforeEach(() => { registro.agentes = AGENTES; registro.tareas = [ta(T0, V, "waiting_approval")]; });
  it("al abrir la dirección vuelve a la misma conversación", () => {
    montar(`/agentes/chat/${V}?conv=${T0}`);
    expect(screen.getByTestId("stub-chat").textContent).toBe(`${V}|${T0}`);
  });
  it("cada agente abierto tiene pestaña con nombre y estado en palabra y marca; «Te necesita» cuando espera algo", () => {
    montar(`/agentes/chat/${V}?a=${V},${J}`);
    expect(screen.getByTestId(`pestana-chat-${V}`).textContent).toContain("Vigilante SITI");
    expect(screen.getByTestId(`pestana-estado-${V}`).textContent).toBe("▲Te necesita");
    expect(screen.getByTestId(`pestana-estado-${J}`).textContent).toMatch(/Disponible|Trabajando|Descansando|Sin señal/);
  });
  it("«Abrir otro agente» suma una pestaña y la deja abierta junto a la anterior", () => {
    montar(`/agentes/chat/${V}`);
    fireEvent.change(screen.getByTestId("abrir-otro-agente"), { target: { value: N } });
    expect(decodeURIComponent(screen.getByTestId("ruta").textContent!)).toBe(`/agentes/chat/${N}?a=${N},${V}`);
  });
  it("cerrar la única pestaña regresa a la sala", () => {
    montar(`/agentes/chat/${V}`);
    fireEvent.click(screen.getByTestId(`cerrar-pestana-${V}`));
    expect(screen.getByTestId("ruta").textContent).toBe(`/agentes?vista=agente:${V}`);
  });
  it("un agente que no existe lo dice", () => {
    montar(`/agentes/chat/99999999-9999-4999-8999-999999999999`);
    expect(screen.getByTestId("chat-no-existe")).toBeTruthy();
  });
});

describe("ayudas del chat", () => {
  it("urlChat solo lleva conversaciones válidas y conserva las pestañas abiertas", () => {
    expect(urlChat(V)).toBe(`/agentes/chat/${V}`);
    expect(urlChat(V, { conv: "no-uuid" })).toBe(`/agentes/chat/${V}`);
    expect(urlChat(V, { conv: T0, abiertos: [J] })).toBe(`/agentes/chat/${V}?conv=${T0}&a=${encodeURIComponent(`${V},${J}`)}`);
    expect(leerAbiertos(`${V},${V},basura,${J}`)).toEqual([V, J]);
  });
  it("«Solo lectura» no se deduce: solo si el registro lo dice", () => {
    expect(estadoVisible("sentado", 0).texto).toBe("Disponible");
    expect(estadoVisible("sentado", 0, true).texto).toBe("Solo lectura");
    expect(estadoVisible("con_error", 0).texto).toBe("Con error");
    expect(estadoVisible("celebrando", 0).texto).toBe("Terminó");
    expect(estadoVisible("sentado", 2).texto).toBe("Te necesita");
    expect(textoAgentes(2)).toBe("2 agentes");
    void within;
  });
});
