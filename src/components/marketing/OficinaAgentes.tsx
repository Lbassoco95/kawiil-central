import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConsultaAnalista, RespuestaAnalista } from "@/hooks/useMarketing";
import { Pastilla, Vacio } from "./marketingUi";
import { cuandoRelativo, ESTADO_TAREA, type AgenteRegistro, type TareaMarketing } from "./agentesRegistroLogica";
import { ALTO, ANCHO, personajeEn, personajes, type Animacion, type PersonajeOficina } from "./oficinaAgentesLogica";

export type EstadoCarga = "cargando" | "error" | "ok";

// Lo que necesita el panel «Preguntar» del Analista. Sin esta propiedad (o sin el agente en el registro) no aparece.
export interface AnalistaProps { consultas: ConsultaAnalista[]; estadoConsultas: EstadoCarga; preguntar: (pregunta: string) => Promise<RespuestaAnalista> }

// ── Dibujo (Canvas 2D, pixel art propio) ────────────────────────────────────────────────────────────────────────────
function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); }

function pintar(g: CanvasRenderingContext2D, lista: PersonajeOficina[], elegido: string | null, cuadro: number, oscuro: boolean, quieto: boolean) {
  const c1 = oscuro ? "#2e2820" : "#efe3cf", c2 = oscuro ? "#332c23" : "#e9dcc5", tinta = oscuro ? "#efe6d6" : "#3b3226", suave = oscuro ? "#cdbf9f" : "#7b6f5d";
  for (let y = 0; y < ALTO; y += 16) for (let x = 0; x < ANCHO; x += 16) rect(g, x, y, 16, 16, ((x + y) / 16) % 2 ? c1 : c2);
  g.strokeStyle = oscuro ? "rgba(220,200,160,.25)" : "rgba(120,100,70,.35)"; g.setLineDash([4, 4]); g.strokeRect(6, 6, ANCHO - 12, ALTO - 12); g.setLineDash([]);
  g.fillStyle = suave; g.font = "bold 10px monospace"; g.fillText("MONITOREO", 14, 20);
  if (lista.some((p) => p.clave === "marketing_analista")) { g.setLineDash([4, 4]); g.beginPath(); g.moveTo(436, 12); g.lineTo(436, ALTO - 12); g.stroke(); g.setLineDash([]); g.fillText("ANÁLISIS", 446, 20); }
  [[16, 176], [ANCHO - 28, 176]].forEach(([x, y]) => { rect(g, x, y + 8, 10, 8, "#a9744a"); rect(g, x + 1, y, 8, 8, "#6f9d7a"); rect(g, x + 3, y - 4, 4, 6, "#7fb58c"); });

  for (const p of lista) {
    const { x, y } = p.aspecto, an: Animacion = p.estado.animacion, gris = an === "sin_datos";
    // escritorio
    rect(g, x - 16, y + 20, 48, 12, "#a98558"); rect(g, x - 16, y + 32, 48, 3, "#8a6a43"); rect(g, x - 12, y + 35, 4, 8, "#8a6a43"); rect(g, x + 24, y + 35, 4, 8, "#8a6a43");
    rect(g, x - 2, y + 6, 24, 14, "#2f3a45"); rect(g, x, y + 8, 20, 10, an === "escribiendo" ? "#bfe3c8" : an === "leyendo" ? "#cfe2f3" : an === "error" ? "#f0c9cc" : gris ? "#d9d4c9" : "#f6e7c8"); rect(g, x + 8, y + 20, 4, 3, "#555");
    // personaje
    const piel = gris ? "#b9b1a4" : "#f0c9a0", pelo = gris ? "#8a8478" : p.aspecto.pelo, ropa = gris ? "#9a9488" : p.aspecto.ropa;
    const bob = quieto || an === "descansando" || gris ? 0 : Math.round(Math.sin((cuadro + x) / 9)), px = x - 2, py = y - 26 + bob;
    rect(g, px + 2, py, 12, 4, pelo); rect(g, px, py + 2, 2, 6, pelo); rect(g, px + 2, py + 4, 12, 10, piel); rect(g, px + 4, py + 8, 2, 2, "#2a2a2a"); rect(g, px + 10, py + 8, 2, 2, "#2a2a2a");
    rect(g, px, py + 14, 16, 14, ropa);
    const mov = !quieto && an === "escribiendo" ? Math.floor(cuadro / 6) % 2 : 0;
    rect(g, px - 2, py + 16 + mov * 2, 3, 8, ropa); rect(g, px + 15, py + 16 + (1 - mov) * 2, 3, 8, ropa); rect(g, px - 2, py + 24 + mov * 2, 3, 3, piel); rect(g, px + 15, py + 24 + (1 - mov) * 2, 3, 3, piel);
    if (an === "leyendo" || an === "pensando") { rect(g, px + 3, py + 22, 12, 8, "#fffaf0"); rect(g, px + 9, py + 22, 1, 8, "#c9b99b"); }
    if (an === "pensando") { rect(g, px + 14, py - 14, 16, 12, "#fffaf0"); rect(g, px + 17, py - 2, 4, 3, "#fffaf0"); g.fillStyle = suave; g.fillText(quieto ? "…" : ["·", "··", "···"][Math.floor(cuadro / 12) % 3], px + 17, py - 4); }
    g.font = "bold 10px monospace";
    if (an === "descansando") { g.fillStyle = suave; g.fillText(quieto ? "z" : ["z", "zZ", "zZz"][Math.floor(cuadro / 20) % 3], px + 16, py - 2); }
    if (gris) { g.fillStyle = "#b0a89a"; g.fillText("?", px + 6, py - 4); }
    if (p.estado.burbuja) { rect(g, px + 14, py - 14, 16, 12, "#fffaf0"); rect(g, px + 17, py - 2, 4, 3, "#fffaf0"); g.fillStyle = an === "error" ? "#c0545f" : "#b9772f"; g.fillText(p.estado.burbuja, px + 20, py - 4); }
    if (p.id === elegido) { g.strokeStyle = "#9b7b4f"; g.lineWidth = 2; g.strokeRect(x - 20, y - 32, 56, 70); g.lineWidth = 1; }
    g.fillStyle = tinta; g.font = "9px monospace"; const w = g.measureText(p.aspecto.corto).width; g.fillText(p.aspecto.corto, x + 8 - w / 2, y + 52);
  }
}

const COLOR_TAREA = (s: string) => (ESTADO_TAREA[s]?.falla ? "rojo" : s === "completed" ? "verde" : "gris");

// ── Componente ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Fase 1: solo lectura. Muestra a los agentes de Marketing con su estado real y, al elegir uno, su objetivo, cumplimiento e historial.
// Preguntarles y dejarles tareas llega en fases siguientes (ver docs/marketing-equipo-agentes-diseno.md).
export function OficinaAgentes({ agentes, tareasMarketing, estadoAgentes, estadoTareas, ahora, analista }: {
  agentes: AgenteRegistro[]; tareasMarketing: TareaMarketing[]; estadoAgentes: EstadoCarga; estadoTareas: EstadoCarga; ahora?: Date; analista?: AnalistaProps;
}) {
  const [pensandoId, setPensandoId] = useState<string | null>(null);
  const [reloj, setReloj] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setReloj(new Date()), 60_000); return () => clearInterval(t); }, []);
  const now = ahora ?? reloj;
  const lista = useMemo(() => personajes(agentes, tareasMarketing, now, pensandoId), [agentes, tareasMarketing, now, pensandoId]);
  const [elegidoId, setElegidoId] = useState<string | null>(null);
  const elegido = lista.find((p) => p.id === elegidoId) ?? lista[0] ?? null;

  const ref = useRef<HTMLCanvasElement>(null);
  const datos = useRef({ lista, elegido: elegido?.id ?? null });
  datos.current = { lista, elegido: elegido?.id ?? null };

  useEffect(() => {
    const cv = ref.current, g = cv?.getContext?.("2d");
    if (!cv || !g) return; // sin lienzo (pruebas, navegadores raros): la lista de agentes sigue funcionando
    g.imageSmoothingEnabled = false;
    const quieto = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const oscuro = () => document.documentElement.getAttribute("data-theme") === "dark" || document.documentElement.classList.contains("dark");
    let raf = 0, parar = false;
    const cuadro = (t: number) => { if (parar) return; pintar(g, datos.current.lista, datos.current.elegido, Math.floor(t / 60), oscuro(), quieto); if (!quieto) raf = requestAnimationFrame(cuadro); };
    raf = requestAnimationFrame(cuadro);
    return () => { parar = true; cancelAnimationFrame(raf); };
  }, [lista.length]);
  // con animaciones reducidas se dibuja un solo cuadro: hay que repintar cuando cambia la selección o los datos
  useEffect(() => {
    const cv = ref.current, g = cv?.getContext?.("2d");
    if (!cv || !g || !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    pintar(g, lista, elegido?.id ?? null, 0, document.documentElement.getAttribute("data-theme") === "dark", true);
  }, [lista, elegido?.id]);

  const clic = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p = personajeEn((e.clientX - r.left) * ANCHO / r.width, (e.clientY - r.top) * ALTO / r.height, datos.current.lista);
    if (p) setElegidoId(p.id);
  }, []);

  if (estadoAgentes === "error") return <Vacio>No pudimos leer los agentes de Marketing. Inténtalo de nuevo.</Vacio>;
  if (estadoAgentes === "cargando") return <Vacio>Preparando la oficina…</Vacio>;
  if (lista.length === 0) return <Vacio>Todavía no hay agentes de Marketing en el registro.</Vacio>;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]" data-testid="oficina-agentes">
      <div className="zen-glass rounded-2xl p-3">
        <canvas ref={ref} width={ANCHO} height={ALTO} onClick={clic} className="block h-auto w-full rounded-xl" style={{ imageRendering: "pixelated" }}
          role="img" aria-label={`Oficina de Marketing: ${lista.map((p) => `${p.nombre}, ${p.estado.etiqueta}`).join("; ")}`} data-testid="oficina-lienzo" />
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Agentes de Marketing">
          {lista.map((p) => (
            <button key={p.id} type="button" aria-pressed={p.id === elegido?.id} data-testid={`oficina-agente-${p.aspecto.corto}`} onClick={() => setElegidoId(p.id)}
              className={`rounded-full border px-3 py-1 text-xs ${p.id === elegido?.id ? "border-transparent bg-[#9b7b4f] text-white" : "border-border"}`}>
              {p.nombre} · {p.estado.etiqueta}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Los personajes reflejan lo que registran los agentes: trabajan al correr, descansan entre corridas y avisan con «!» si algo necesita atención.</p>
      </div>

      {elegido && (
        <div className="zen-glass space-y-3 rounded-2xl p-4" data-testid="oficina-panel" aria-live="polite">
          <div className="flex items-start justify-between gap-2">
            <div><p className="text-base font-medium">{elegido.nombre}</p>
              <p className="text-xs text-muted-foreground">{agentes.find((a) => a.id === elegido.id)?.description ?? ""}</p></div>
            <Pastilla color={elegido.estado.color}>{elegido.estado.etiqueta}</Pastilla>
          </div>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Última corrida</dt><dd data-testid="oficina-ultima">{elegido.ultima?.completed_at ? cuandoRelativo(elegido.ultima.completed_at, now) : "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted-foreground">Resultado</dt><dd className="text-right" data-testid="oficina-resultado">{elegido.ultima?.result_summary ?? (elegido.estado.senal === "al_dia" ? "Sin novedad" : "—")}</dd></div>
            <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted-foreground">Objetivo</dt><dd className="text-right">{String(agentes.find((a) => a.id === elegido.id)?.config?.objetivo ?? "—")}</dd></div>
          </dl>
          {elegido.estado.cumple.estado !== "sin_datos" && (
            <p className="flex items-start gap-2 text-xs" data-testid="oficina-cumple">
              <Pastilla color={elegido.estado.cumple.estado === "cumple" ? "verde" : "rojo"}>{elegido.estado.cumple.estado === "cumple" ? "Cumple" : "No cumple"}</Pastilla><span>{elegido.estado.cumple.texto}</span>
            </p>
          )}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Últimas corridas</p>
            {estadoTareas === "error" ? <p className="text-xs text-muted-foreground">No pudimos leer el historial.</p>
              : estadoTareas === "cargando" ? <p className="text-xs text-muted-foreground">Leyendo historial…</p>
              : elegido.historial.length === 0 ? <p className="text-xs text-muted-foreground" data-testid="oficina-sin-historial">Todavía no hay corridas registradas.</p> : (
                <ul className="divide-y divide-border/40 text-xs" data-testid="oficina-historial">
                  {elegido.historial.map((t) => (
                    <li key={t.id} className="flex items-start justify-between gap-2 py-1.5">
                      <span className="min-w-0"><span className="block">{cuandoRelativo(t.completed_at, now)}</span><span className="block text-muted-foreground">{t.result_summary ?? ""}</span></span>
                      <Pastilla color={COLOR_TAREA(t.status)}>{ESTADO_TAREA[t.status]?.etiqueta ?? t.status}</Pastilla>
                    </li>
                  ))}
                </ul>
              )}
          </div>
          {elegido.clave === "marketing_analista" && analista ? (
            <PreguntarAnalista analista={analista} now={now} alPensar={(p) => setPensandoId(p ? elegido.id : null)} />
          ) : (
            <p className="border-t border-border/40 pt-2 text-xs text-muted-foreground" data-testid="oficina-proximamente">
              Preguntarles cómo van y dejarles tareas llegará en una siguiente fase. Por ahora esta vista es solo de lectura.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Preguntar al Analista ───────────────────────────────────────────────────────────────────────────────────────────
const MAX_PREGUNTA = 500;
const ETIQUETA_CONSULTA: Record<ConsultaAnalista["estado"], { etiqueta: string; color: string }> = {
  respondida: { etiqueta: "Respondida", color: "verde" }, error: { etiqueta: "Sin respuesta", color: "rojo" }, rechazada_limite: { etiqueta: "Tope de uso", color: "amarillo" },
};

function PreguntarAnalista({ analista, now, alPensar }: { analista: AnalistaProps; now: Date; alPensar: (pensando: boolean) => void }) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resp, setResp] = useState<RespuestaAnalista | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const limpia = texto.replace(/\s+/g, " ").trim();
  const puede = limpia.length >= 3 && limpia.length <= MAX_PREGUNTA && !enviando;

  const enviar = async () => {
    if (!puede) return;
    setEnviando(true); setResp(null); alPensar(true);
    try { const r = await analista.preguntar(limpia); setResp(r); if (r.ok) setTexto(""); /* si falló, se conserva la pregunta para reintentar */ } catch { setResp({ ok: false, error: "No pudimos hablar con el Analista. Inténtalo de nuevo." }); }
    finally { setEnviando(false); alPensar(false); }
  };

  return (
    <div className="space-y-3 border-t border-border/40 pt-3" data-testid="analista-preguntar">
      <label htmlFor="pregunta-analista" className="block text-xs font-medium text-muted-foreground">Pregúntale cómo van tus resultados</label>
      <textarea id="pregunta-analista" value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={MAX_PREGUNTA + 50} disabled={enviando}
        placeholder="Ej.: ¿cómo va el alcance de los carruseles en Instagram este mes?" className="w-full rounded-lg border border-border bg-background p-2 text-sm"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void enviar(); } }} />
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs ${limpia.length > MAX_PREGUNTA ? "text-red-600" : "text-muted-foreground"}`} data-testid="analista-contador">{limpia.length}/{MAX_PREGUNTA}</span>
        <button type="button" onClick={() => void enviar()} disabled={!puede} data-testid="analista-enviar"
          className="rounded-full bg-[#9b7b4f] px-4 py-1.5 text-xs text-white disabled:opacity-50">{enviando ? "Pensando…" : "Preguntar"}</button>
      </div>

      {resp && !resp.ok && (
        <div className="rounded-lg border border-border p-3 text-sm" role="alert" data-testid="analista-error">
          <p>{resp.error ?? "No pudimos responder ahora."}</p>
          {resp.limite && <p className="mt-1 text-xs text-muted-foreground">{resp.limite === "dia" ? "El tope se reinicia a medianoche (hora de Ciudad de México)." : "Dirección puede ampliar el tope mensual."}</p>}
        </div>
      )}
      {resp?.ok && (
        <div className="space-y-2 rounded-lg border border-border p-3" data-testid="analista-respuesta">
          <p className="whitespace-pre-wrap text-sm">{resp.respuesta}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {resp.verificada
              ? <Pastilla color="verde">Cifras verificadas</Pastilla>
              : <Pastilla color="rojo">Cifras sin verificar</Pastilla>}
            {!resp.verificada && (resp.no_verificadas?.length ?? 0) > 0 && <span className="text-muted-foreground" data-testid="analista-no-verificadas">Revisa: {resp.no_verificadas!.join(", ")}</span>}
          </div>
          {(resp.fuentes?.length ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="analista-fuentes">
              Fuentes: {resp.fuentes!.map((f) => `${f.herramienta}${f.corte ? ` (corte ${f.corte.slice(0, 10)})` : ""}`).join(" · ")}
            </p>
          )}
          {typeof resp.restantes_hoy === "number" && <p className="text-xs text-muted-foreground">Te quedan {resp.restantes_hoy} preguntas hoy.</p>}
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Preguntas recientes</p>
        {analista.estadoConsultas === "error" ? <p className="text-xs text-muted-foreground" data-testid="analista-historial-error">No pudimos leer el historial de preguntas.</p>
          : analista.estadoConsultas === "cargando" ? <p className="text-xs text-muted-foreground">Leyendo historial…</p>
          : analista.consultas.length === 0 ? <p className="text-xs text-muted-foreground" data-testid="analista-sin-historial">Todavía no hay preguntas.</p> : (
            <ul className="divide-y divide-border/40 text-xs" data-testid="analista-historial">
              {analista.consultas.map((c) => (
                <li key={c.id} className="py-1.5">
                  <button type="button" className="flex w-full items-start justify-between gap-2 text-left" aria-expanded={abierta === c.id} onClick={() => setAbierta(abierta === c.id ? null : c.id)}>
                    <span className="min-w-0"><span className="block">{c.pregunta}</span><span className="block text-muted-foreground">{cuandoRelativo(c.created_at, now)}</span></span>
                    <Pastilla color={ETIQUETA_CONSULTA[c.estado].color}>{ETIQUETA_CONSULTA[c.estado].etiqueta}</Pastilla>
                  </button>
                  {abierta === c.id && c.respuesta && (
                    <p className="mt-1 whitespace-pre-wrap rounded bg-background/50 p-2" data-testid={`analista-detalle-${c.id}`}>
                      {c.respuesta}{c.verificada === false && <span className="mt-1 block text-red-600">Cifras sin verificar{c.no_verificadas.length ? `: ${c.no_verificadas.join(", ")}` : ""}.</span>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
      </div>
      <p className="text-xs text-muted-foreground">El Analista solo lee y explica: no publica ni cambia nada. Sus cifras salen de la base y se verifican antes de mostrarlas.</p>
    </div>
  );
}
