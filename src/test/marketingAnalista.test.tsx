import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { OficinaAgentes, type AnalistaProps } from "@/components/marketing/OficinaAgentes";
import { estadoVisual, personajes } from "@/components/marketing/oficinaAgentesLogica";
import { cumplimiento, senalAgente, type AgenteRegistro, type TareaMarketing } from "@/components/marketing/agentesRegistroLogica";
import type { ConsultaAnalista, RespuestaAnalista } from "@/hooks/useMarketing";

beforeAll(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext; });

const ag = (name: string, o: Partial<AgenteRegistro> = {}): AgenteRegistro => ({
  id: name, name, display_name: name, description: `Descripción de ${name}`, role: name, status: "idle", kind: "system", last_heartbeat: null, last_task_at: null,
  tasks_completed: 0, tasks_failed: 0, config: { objetivo: `Objetivo de ${name}` }, ...o,
});
const ANALISTA = ag("marketing_analista", { display_name: "Analista de resultados", config: { objetivo: "Responder con cifras de la base", cadencia: "bajo_demanda" } });
const AGENTES = [ag("marketing_vigilante", { last_heartbeat: "2026-11-05T13:00:05Z" }), ag("marketing_informe_diario", { last_heartbeat: "2026-11-05T13:00:05Z" }), ag("marketing_vigia", { last_heartbeat: "2026-11-05T13:30:00Z" }), ANALISTA];
const AHORA = new Date("2026-11-05T17:00:00Z");
const tm = (id: string, agent_id: string, status: string, completed_at: string, result: TareaMarketing["result"] = null): TareaMarketing => ({ id, agent_id, status, completed_at, result_summary: null, result });
const consulta = (id: string, pregunta: string, o: Partial<ConsultaAnalista> = {}): ConsultaAnalista => ({ id, pregunta, respuesta: "Respuesta " + id, estado: "respondida", verificada: true, no_verificadas: [], created_at: "2026-11-05T16:00:00Z", ...o });

describe("estado del Analista (agente bajo demanda)", () => {
  it("sin latido ni preguntas está 'Disponible' (no 'sin latido' ni 'atrasado'), incluso días después de la última pregunta", () => {
    expect(senalAgente(ANALISTA, AHORA)).toBe("disponible");
    expect(senalAgente({ ...ANALISTA, last_heartbeat: "2026-10-01T00:00:00Z" }, AHORA)).toBe("disponible");
    expect(estadoVisual(ANALISTA, undefined, AHORA)).toMatchObject({ animacion: "descansando", etiqueta: "Disponible", color: "verde", burbuja: null });
  });
  it("con error en su última corrida: 'con error'; los agentes programados siguen atrasándose normal", () => {
    expect(senalAgente({ ...ANALISTA, status: "error" }, AHORA)).toBe("con_error");
    expect(senalAgente(ag("marketing_vigilante", { last_heartbeat: "2026-11-01T00:00:00Z" }), AHORA)).toBe("atrasado");
  });
  it("acaba de responder (≤30 min) → trabaja; pensando → animación y burbuja de pensar, aunque esté disponible", () => {
    const reciente = tm("a1", "marketing_analista", "completed", "2026-11-05T16:45:00Z", { verificada: true });
    expect(estadoVisual({ ...ANALISTA, last_heartbeat: "2026-11-05T16:45:00Z" }, reciente, AHORA)).toMatchObject({ animacion: "escribiendo", etiqueta: "Acaba de responder" });
    expect(estadoVisual(ANALISTA, undefined, AHORA, true)).toMatchObject({ animacion: "pensando", etiqueta: "Pensando", color: "amarillo" });
  });
  it("cumplimiento: cifras verificadas → cumple; sin verificar → no cumple; error → no cumple; sin preguntas → sin datos", () => {
    expect(cumplimiento(ANALISTA, undefined, AHORA).estado).toBe("sin_datos");
    expect(cumplimiento(ANALISTA, tm("a", "marketing_analista", "completed", "2026-11-05T16:00:00Z", { verificada: true }), AHORA).estado).toBe("cumple");
    expect(cumplimiento(ANALISTA, tm("a", "marketing_analista", "completed", "2026-11-05T16:00:00Z", { verificada: false }), AHORA).estado).toBe("no_cumple");
    expect(cumplimiento(ANALISTA, tm("a", "marketing_analista", "error", "2026-11-05T16:00:00Z"), AHORA).estado).toBe("no_cumple");
    expect(cumplimiento(ANALISTA, tm("a", "marketing_analista", "completed", "2026-11-05T16:00:00Z", null), AHORA).estado).toBe("sin_datos");
  });
  it("la oficina ordena a los cuatro (el Analista al final) y marca su clave interna", () => {
    const l = personajes(AGENTES, [], AHORA); expect(l.map((p) => p.aspecto.corto)).toEqual(["Vigilante", "Informe", "Vigía", "Analista"]); expect(l[3].clave).toBe("marketing_analista");
    expect(personajes(AGENTES, [], AHORA, "marketing_analista")[3].estado.animacion).toBe("pensando");
  });
});

const vista = (analista: AnalistaProps | undefined, o: Partial<Parameters<typeof OficinaAgentes>[0]> = {}) =>
  render(<OficinaAgentes agentes={AGENTES} tareasMarketing={[]} estadoAgentes="ok" estadoTareas="ok" ahora={AHORA} analista={analista} {...o} />);
const props = (preguntar: AnalistaProps["preguntar"], consultas: ConsultaAnalista[] = [], estadoConsultas: AnalistaProps["estadoConsultas"] = "ok"): AnalistaProps => ({ consultas, estadoConsultas, preguntar });
const elegirAnalista = () => fireEvent.click(screen.getByTestId("oficina-agente-Analista"));
const caja = () => screen.getByTestId("analista-caja") as HTMLTextAreaElement;
const escribir = (t: string) => fireEvent.change(caja(), { target: { value: t } });

describe("panel Preguntar del Analista", () => {
  it("aparece solo al elegir al Analista y solo si hay propiedades del agente; los demás agentes conservan el aviso de 'siguiente fase'", () => {
    vista(props(vi.fn()));
    expect(screen.queryByTestId("analista-preguntar")).toBeNull(); expect(screen.getByTestId("oficina-proximamente")).toBeTruthy();
    elegirAnalista(); expect(screen.getByTestId("analista-preguntar")).toBeTruthy(); expect(screen.queryByTestId("oficina-proximamente")).toBeNull();
  });
  it("sin la propiedad analista (o sin el agente en el registro), no hay caja de preguntas", () => {
    const r = vista(undefined); elegirAnalista(); expect(screen.queryByTestId("analista-preguntar")).toBeNull(); expect(screen.getByTestId("oficina-proximamente")).toBeTruthy(); r.unmount();
    render(<OficinaAgentes agentes={AGENTES.slice(0, 3)} tareasMarketing={[]} estadoAgentes="ok" estadoTareas="ok" ahora={AHORA} analista={props(vi.fn())} />);
    expect(screen.queryByTestId("oficina-agente-Analista")).toBeNull(); expect(screen.queryByTestId("analista-preguntar")).toBeNull();
  });
  it("el botón está apagado con menos de 3 caracteres, solo espacios o más de 500; el contador cuenta lo limpio", () => {
    vista(props(vi.fn())); elegirAnalista();
    const boton = screen.getByTestId("analista-enviar") as HTMLButtonElement;
    expect(boton.disabled).toBe(true); escribir("   ab   "); expect(boton.disabled).toBe(true);
    escribir("  ¿Cómo   va?  "); expect(boton.disabled).toBe(false); expect(screen.getByTestId("analista-contador").textContent).toBe("9/500");
    escribir("x".repeat(501)); expect(boton.disabled).toBe(true);
  });
  it("envía la pregunta LIMPIA, muestra 'Pensando…' mientras espera y bloquea el doble envío", async () => {
    let resolver!: (r: RespuestaAnalista) => void;
    const preguntar = vi.fn(() => new Promise<RespuestaAnalista>((r) => { resolver = r; }));
    vista(props(preguntar)); elegirAnalista(); escribir("  ¿Cómo   va el colchón? ");
    fireEvent.click(screen.getByTestId("analista-enviar"));
    expect(preguntar).toHaveBeenCalledWith("¿Cómo va el colchón?");
    expect(screen.getByTestId("analista-enviar").textContent).toBe("Pensando…"); expect((screen.getByTestId("analista-enviar") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("oficina-agente-Analista").textContent).toContain("Pensando");
    fireEvent.click(screen.getByTestId("analista-enviar")); expect(preguntar).toHaveBeenCalledTimes(1);
    resolver({ ok: true, respuesta: "El colchón es de 23 días.", verificada: true, no_verificadas: [], fuentes: [], restantes_hoy: 29 });
    await waitFor(() => expect(screen.getByTestId("analista-respuesta")).toBeTruthy());
    expect(screen.getByTestId("oficina-agente-Analista").textContent).toContain("Disponible");
  });
  it("respuesta verificada: texto, insignia 'Cifras verificadas', fuentes con su corte y preguntas restantes; la caja se limpia", async () => {
    vista(props(vi.fn(async () => ({ ok: true, respuesta: "El colchón es de 23 días.", verificada: true, no_verificadas: [], fuentes: [{ herramienta: "colchon_actual", filas: 1, corte: "2026-11-05T17:00:00Z" }], restantes_hoy: 28 }))));
    elegirAnalista(); escribir("¿colchón?"); fireEvent.click(screen.getByTestId("analista-enviar"));
    const r = await screen.findByTestId("analista-respuesta");
    expect(r.textContent).toContain("El colchón es de 23 días."); expect(r.textContent).toContain("Cifras verificadas"); expect(r.textContent).toContain("Te quedan 28 preguntas hoy");
    expect(screen.getByTestId("analista-fuentes").textContent).toContain("colchon_actual (corte 2026-11-05)");
    expect(caja().value).toBe("");
  });
  it("respuesta con cifras sin verificar: se avisa en rojo y se listan las cifras para revisar", async () => {
    vista(props(vi.fn(async () => ({ ok: true, respuesta: "Subió 312.", verificada: false, no_verificadas: ["312"], fuentes: [] }))));
    elegirAnalista(); escribir("¿cuánto subió?"); fireEvent.click(screen.getByTestId("analista-enviar"));
    const r = await screen.findByTestId("analista-respuesta"); expect(r.textContent).toContain("Cifras sin verificar"); expect(screen.getByTestId("analista-no-verificadas").textContent).toContain("312");
    expect(r.textContent).not.toContain("Cifras verificadas");
  });
  it("el texto del modelo se muestra como TEXTO (no se interpreta HTML)", async () => {
    vista(props(vi.fn(async () => ({ ok: true, respuesta: "<img src=x onerror=alert(1)><b>hola</b>", verificada: true, no_verificadas: [], fuentes: [] }))));
    elegirAnalista(); escribir("prueba html"); fireEvent.click(screen.getByTestId("analista-enviar"));
    const r = await screen.findByTestId("analista-respuesta"); expect(r.querySelector("img")).toBeNull(); expect(r.querySelector("b")).toBeNull(); expect(r.textContent).toContain("<img src=x");
  });
  it("errores: tope diario (con explicación), error genérico y fallo inesperado de la llamada; el botón vuelve a quedar disponible", async () => {
    const r1 = vista(props(vi.fn(async () => ({ ok: false, error: "Llegaste al tope de 30 preguntas por día. Vuelve a intentarlo mañana.", limite: "dia" as const }))));
    elegirAnalista(); escribir("otra pregunta"); fireEvent.click(screen.getByTestId("analista-enviar"));
    const e1 = await screen.findByTestId("analista-error"); expect(e1.textContent).toContain("tope de 30"); expect(e1.textContent).toContain("medianoche"); r1.unmount();
    const r2 = vista(props(vi.fn(async () => ({ ok: false })))); elegirAnalista(); escribir("otra más"); fireEvent.click(screen.getByTestId("analista-enviar"));
    expect((await screen.findByTestId("analista-error")).textContent).toContain("No pudimos responder ahora"); r2.unmount();
    vista(props(vi.fn(async () => { throw new Error("red caída"); }))); elegirAnalista(); escribir("tercera"); fireEvent.click(screen.getByTestId("analista-enviar"));
    expect((await screen.findByTestId("analista-error")).textContent).toContain("No pudimos hablar con el Analista");
    // si la respuesta falla, la pregunta escrita se conserva y se puede reintentar
    expect(caja().value).toBe("tercera");
    await waitFor(() => expect((screen.getByTestId("analista-enviar") as HTMLButtonElement).disabled).toBe(false));
  });
  it("historial: muestra las preguntas con su estado, abre la respuesta al pulsar y marca las que tenían cifras sin verificar", () => {
    vista(props(vi.fn(), [consulta("c1", "¿Cómo va el colchón?"), consulta("c2", "¿Y el semáforo?", { verificada: false, no_verificadas: ["87"] }), consulta("c3", "Otra", { estado: "rechazada_limite", respuesta: null, verificada: null })]));
    elegirAnalista();
    const lista = within(screen.getByTestId("analista-historial")); expect(lista.getAllByRole("listitem").length).toBe(3);
    expect(lista.getByText("Tope de uso")).toBeTruthy(); expect(screen.queryByTestId("analista-detalle-c1")).toBeNull();
    fireEvent.click(lista.getByText("¿Cómo va el colchón?")); expect(screen.getByTestId("analista-detalle-c1").textContent).toContain("Respuesta c1");
    fireEvent.click(lista.getByText("¿Y el semáforo?")); expect(screen.getByTestId("analista-detalle-c2").textContent).toContain("Cifras sin verificar: 87");
    fireEvent.click(lista.getByText("Otra")); expect(screen.queryByTestId("analista-detalle-c3")).toBeNull();
  });
  it("historial vacío, cargando o con error no rompe el panel", () => {
    const a = vista(props(vi.fn(), [])); elegirAnalista(); expect(screen.getByTestId("analista-sin-historial")).toBeTruthy(); a.unmount();
    const b = vista(props(vi.fn(), [], "error")); elegirAnalista(); expect(screen.getByTestId("analista-historial-error")).toBeTruthy(); b.unmount();
    vista(props(vi.fn(), [], "cargando")); elegirAnalista(); expect(screen.getByText("Leyendo historial…")).toBeTruthy();
  });
  it("recuerda que el Analista solo lee y que sus cifras se verifican", () => {
    vista(props(vi.fn())); elegirAnalista(); expect(screen.getByTestId("analista-preguntar").textContent).toContain("solo lee y explica");
  });
});

describe("TextoAnalista: respuesta legible, sin símbolos", () => {
  it("convierte negritas y viñetas en elementos, sin ** ni guiones sueltos", async () => {
    const { render, screen } = await import("@testing-library/react");
    const { TextoAnalista } = await import("@/components/marketing/TextoAnalista");
    const { container } = render(<TextoAnalista texto={"**Facebook** (fuente: x):\n- La semana está en *rojo*\n- Otra con `valor`\n\n---\n## Límites\nTexto <b>no html</b>"} />);
    expect(container.textContent).not.toMatch(/\*\*|^- |`|##/m);
    expect(container.querySelectorAll("strong").length).toBe(1);
    expect(container.querySelectorAll("li").length).toBe(2);
    expect(container.querySelector("em")?.textContent).toBe("rojo");
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText(/no html/).textContent).toContain("<b>");
  });
});

describe("seguimientos del Analista", () => {
  const seg = (id: string, o: Partial<import("@/hooks/useMarketing").SeguimientoAnalista> = {}): import("@/hooks/useMarketing").SeguimientoAnalista =>
    ({ id, pregunta: `Pregunta de ${id}`, frecuencia: "semanal", estado: "activo", proxima_at: "2026-11-09T13:45:00Z", ultima_at: null, corridas: 0, ...o });
  const conSeg = (gestionar: NonNullable<AnalistaProps["gestionarSeguimiento"]>, seguimientos = [seg("s1")], estadoSeguimientos: AnalistaProps["estadoSeguimientos"] = "ok"): AnalistaProps =>
    ({ ...props(vi.fn()), seguimientos, estadoSeguimientos, gestionarSeguimiento: gestionar });

  it("sin gestionarSeguimiento no aparece nada de seguimientos (el panel sigue como antes)", () => {
    vista(props(vi.fn())); elegirAnalista();
    expect(screen.queryByTestId("analista-seguimientos")).toBeNull(); expect(screen.queryByTestId("analista-nuevo-seguimiento")).toBeNull();
  });
  it("lista los seguimientos con su frecuencia y próxima corrida; vacío y error tienen su mensaje", () => {
    const g = vi.fn(); const { unmount } = vista(conSeg(g)); elegirAnalista();
    const fila = screen.getByTestId("seguimiento-s1"); expect(fila.textContent).toContain("Pregunta de s1"); expect(fila.textContent).toContain("Cada semana"); expect(fila.textContent).toContain("7:45");
    unmount(); vista(conSeg(g, [])); elegirAnalista(); expect(screen.getByTestId("analista-sin-seguimientos")).toBeTruthy();
    cleanup(); vista(conSeg(g, [], "error")); elegirAnalista(); expect(screen.getByTestId("analista-seguimientos-error")).toBeTruthy();
  });
  it("dar seguimiento envía la pregunta limpia con la frecuencia elegida, avisa cuándo corre y vacía el texto; el botón se bloquea con pregunta corta", async () => {
    const g = vi.fn().mockResolvedValue({ ok: true }); vista(conSeg(g)); elegirAnalista();
    const boton = screen.getByTestId("analista-dar-seguimiento") as HTMLButtonElement; expect(boton.disabled).toBe(true);
    escribir("  ¿Cómo va   el alcance de Facebook?  "); fireEvent.change(screen.getByLabelText("Frecuencia del seguimiento"), { target: { value: "diaria" } });
    expect(boton.disabled).toBe(false); fireEvent.click(boton);
    await waitFor(() => expect(g).toHaveBeenCalledWith({ accion: "crear_seguimiento", pregunta: "¿Cómo va el alcance de Facebook?", frecuencia: "diaria" }));
    await waitFor(() => expect(screen.getByTestId("analista-aviso-seguimiento").textContent).toContain("7:45"));
    expect(caja().value).toBe("");
  });
  it("si falla (por ejemplo el tope de 5), muestra el mensaje y conserva la pregunta", async () => {
    const g = vi.fn().mockResolvedValue({ ok: false, error: "Ya tienes 5 seguimientos. Termina alguno para agregar otro." }); vista(conSeg(g)); elegirAnalista();
    escribir("¿Cómo va Instagram esta semana?"); fireEvent.click(screen.getByTestId("analista-dar-seguimiento"));
    await waitFor(() => expect(screen.getByTestId("analista-aviso-seguimiento").textContent).toContain("Ya tienes 5"));
    expect(caja().value).toContain("Instagram");
  });
  it("pausar, reanudar y terminar envían la acción correcta; un seguimiento en pausa ofrece Reanudar", async () => {
    const g = vi.fn().mockResolvedValue({ ok: true }); vista(conSeg(g, [seg("s1"), seg("s2", { estado: "pausado" })])); elegirAnalista();
    fireEvent.click(within(screen.getByTestId("seguimiento-s1")).getByText("Pausar"));
    await waitFor(() => expect(g).toHaveBeenCalledWith({ accion: "cambiar_seguimiento", id: "s1", estado: "pausado" }));
    expect(screen.getByTestId("seguimiento-s2").textContent).toContain("en pausa");
    fireEvent.click(within(screen.getByTestId("seguimiento-s2")).getByText("Reanudar"));
    await waitFor(() => expect(g).toHaveBeenCalledWith({ accion: "cambiar_seguimiento", id: "s2", estado: "activo" }));
    fireEvent.click(within(screen.getByTestId("seguimiento-s2")).getByText("Terminar"));
    await waitFor(() => expect(g).toHaveBeenCalledWith({ accion: "cambiar_seguimiento", id: "s2", estado: "terminado" }));
  });
  it("las respuestas de un seguimiento se marcan en el historial", () => {
    vista({ ...conSeg(vi.fn()), consultas: [consulta("c1", "Pregunta repetida", { seguimiento_id: "s1" })] }); elegirAnalista();
    expect(within(screen.getByTestId("analista-historial")).getByText(/· seguimiento/)).toBeTruthy();
  });
});

describe("conversación con el Analista", () => {
  const ok = (respuesta: string): RespuestaAnalista => ({ ok: true, respuesta, verificada: true, no_verificadas: [], fuentes: [{ herramienta: "colchon_actual", filas: 3, corte: "2026-11-13T01:00:00Z" }], restantes_hoy: 20 });
  it("la primera pregunta se manda sin historial; la segunda lleva la pregunta y la respuesta anteriores como contexto", async () => {
    const preguntar = vi.fn().mockResolvedValueOnce(ok("Colchón verde en las tres redes.")).mockResolvedValueOnce(ok("LinkedIn también: 19 días."));
    vista(props(preguntar)); elegirAnalista();
    escribir("¿Cómo va el colchón?"); fireEvent.click(screen.getByTestId("analista-enviar"));
    await waitFor(() => expect(screen.getByTestId("analista-hilo")).toBeTruthy());
    expect(preguntar).toHaveBeenNthCalledWith(1, "¿Cómo va el colchón?");
    expect(screen.getByText("Sigue la conversación")).toBeTruthy();
    escribir("¿Y LinkedIn?"); fireEvent.click(screen.getByTestId("analista-enviar"));
    await waitFor(() => expect(screen.getAllByTestId("analista-pregunta-hecha").length).toBe(2));
    expect(preguntar).toHaveBeenNthCalledWith(2, "¿Y LinkedIn?", [{ rol: "user", texto: "¿Cómo va el colchón?" }, { rol: "assistant", texto: "Colchón verde en las tres redes." }]);
    expect(screen.getAllByTestId("analista-respuesta")).toHaveLength(1); expect(screen.getAllByTestId("analista-respuesta-previa")).toHaveLength(1);
  });
  it("solo manda los últimos 3 turnos como contexto", async () => {
    const preguntar = vi.fn().mockImplementation(async (p: string) => ok(`resp ${p}`));
    vista(props(preguntar)); elegirAnalista();
    const preguntas = ["pregunta uno", "pregunta dos", "pregunta tres", "pregunta cuatro", "pregunta cinco"];
    for (const [i, q] of preguntas.entries()) {
      escribir(q); fireEvent.click(screen.getByTestId("analista-enviar"));
      await waitFor(() => expect(screen.getAllByTestId("analista-pregunta-hecha")).toHaveLength(i + 1));
    }
    const ultima = preguntar.mock.calls.at(-1)!; expect(ultima[0]).toBe("pregunta cinco"); expect(ultima[1]).toHaveLength(6); expect(ultima[1][0].texto).toBe("pregunta dos");
  });
  it("«Nueva conversación» vacía el hilo y la siguiente pregunta va sin historial", async () => {
    const preguntar = vi.fn().mockResolvedValue(ok("Listo.")); vista(props(preguntar)); elegirAnalista();
    escribir("¿Cómo vamos?"); fireEvent.click(screen.getByTestId("analista-enviar")); await waitFor(() => expect(screen.getByTestId("analista-hilo")).toBeTruthy());
    fireEvent.click(screen.getByTestId("analista-nueva-conversacion")); expect(screen.queryByTestId("analista-hilo")).toBeNull();
    escribir("¿Otra cosa distinta?"); fireEvent.click(screen.getByTestId("analista-enviar")); await waitFor(() => expect(preguntar).toHaveBeenCalledTimes(2));
    expect(preguntar).toHaveBeenNthCalledWith(2, "¿Otra cosa distinta?");
  });
  it("una respuesta con error no entra al hilo (se conserva la pregunta para reintentar)", async () => {
    const preguntar = vi.fn().mockResolvedValue({ ok: false, error: "No pudimos responder." }); vista(props(preguntar)); elegirAnalista();
    escribir("¿Cómo vamos?"); fireEvent.click(screen.getByTestId("analista-enviar")); await waitFor(() => expect(screen.getByTestId("analista-error")).toBeTruthy());
    expect(screen.queryByTestId("analista-hilo")).toBeNull(); expect(caja().value).toBe("¿Cómo vamos?");
  });
});
