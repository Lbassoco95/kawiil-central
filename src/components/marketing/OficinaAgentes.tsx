import { useEffect, useMemo, useState } from "react";
import type { AccionSeguimiento, ConsultaAnalista, FrecuenciaSeguimiento, RespuestaAnalista, SeguimientoAnalista, TurnoHistorial } from "@/hooks/useMarketing";
import { useFuentesPropuestas, useFuentesWeb, useHallazgosWeb } from "@/hooks/useMarketing";
import { Pastilla, Vacio } from "./marketingUi";
import { TextoAnalista } from "./TextoAnalista";
import { cuandoRelativo, ESTADO_TAREA, type AgenteRegistro, type TareaMarketing } from "./agentesRegistroLogica";
import { personajes, figurasDeSala } from "./oficinaAgentesLogica";
import { SalaIsometrica } from "@/components/agentes/SalaIsometrica";
import { DEPARTAMENTOS } from "@/lib/agentes/departamentos";
import { oficinasDe } from "@/lib/agentes/equipos";
import { figurasOficina } from "@/lib/agentes/oficina";

export type EstadoCarga = "cargando" | "error" | "ok";

// Lo que necesita el panel «Preguntar» del Analista. Sin esta propiedad (o sin el agente en el registro) no aparece.
export interface AnalistaProps {
  consultas: ConsultaAnalista[]; estadoConsultas: EstadoCarga; preguntar: (pregunta: string, historial?: TurnoHistorial[]) => Promise<RespuestaAnalista>;
  // Seguimientos (opcionales: sin ellos no aparece la sección).
  // Panel del CMO (opcional: sin él, o sin el agente en el registro, no aparece la caja de preguntas del CMO).
  cmo?: { consultas: ConsultaAnalista[]; estadoConsultas: EstadoCarga; preguntar: (pregunta: string, historial?: TurnoHistorial[]) => Promise<RespuestaAnalista> };
  seguimientos?: SeguimientoAnalista[]; estadoSeguimientos?: EstadoCarga; gestionarSeguimiento?: (c: AccionSeguimiento) => Promise<{ ok: boolean; error?: string }>;
}

const COLOR_TAREA = (s: string) => (ESTADO_TAREA[s]?.falla ? "rojo" : s === "completed" ? "verde" : "gris");

// ── Componente ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Fase 1: solo lectura. Muestra a los agentes de Marketing con su estado real y, al elegir uno, su objetivo, cumplimiento e historial.
// Preguntarles y dejarles tareas llega en fases siguientes (ver docs/marketing-equipo-agentes-diseno.md).
export function OficinaAgentes({ agentes, tareasMarketing, estadoAgentes, estadoTareas, ahora, analista, onAbrirOficina }: {
  agentes: AgenteRegistro[]; tareasMarketing: TareaMarketing[]; estadoAgentes: EstadoCarga; estadoTareas: EstadoCarga; ahora?: Date; analista?: AnalistaProps;
  onAbrirOficina?: (jefeId: string) => void;   // la pantalla de una oficina vive en /agentes; Marketing solo la dibuja en su sala (R1.5)
}) {
  const [pensandoId, setPensandoId] = useState<string | null>(null);
  const [reloj, setReloj] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setReloj(new Date()), 60_000); return () => clearInterval(t); }, []);
  const now = ahora ?? reloj;
  const lista = useMemo(() => personajes(agentes, tareasMarketing, now, pensandoId), [agentes, tareasMarketing, now, pensandoId]);
  const [elegidoId, setElegidoId] = useState<string | null>(null);
  const elegido = lista.find((p) => p.id === elegidoId) ?? lista[0] ?? null;

  const figuras = useMemo(() => figurasDeSala(lista), [lista]);
  const etiquetas = useMemo(() => new Map(lista.map((p) => [p.id, p.estado.etiqueta])), [lista]);
  // Oficinas de equipo (R1.5): los agentes que crea un agente de Marketing viven en su oficina dentro de esta sala, con su piso y su letrero.
  const oficinas = useMemo(() => oficinasDe(agentes as never).filter((o) => lista.some((p) => p.id === o.jefeId)).map((o) => ({
    clave: o.jefeId, nombre: o.nombre, tinte: o.tinte, figuras: figurasOficina(o.miembros.map((m) => m.agente), [], now),
  })), [agentes, lista, now]);

  if (estadoAgentes === "error") return <Vacio>No pudimos leer los agentes de Marketing. Inténtalo de nuevo.</Vacio>;
  if (estadoAgentes === "cargando") return <Vacio>Preparando la oficina…</Vacio>;
  if (lista.length === 0) return <Vacio>Todavía no hay agentes de Marketing en el registro.</Vacio>;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]" data-testid="oficina-agentes">
      <div className="min-w-0 space-y-3">
        <SalaIsometrica depto={DEPARTAMENTOS.marketing} figuras={figuras} elegidoId={elegido?.id} etiqueta={(f) => etiquetas.get(f.id) ?? ""} onElegir={(id) => { if (etiquetas.has(id)) setElegidoId(id); }}
          oficinas={oficinas} onAbrirOficina={onAbrirOficina} />
        <div className="zen-glass rounded-2xl p-3">
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Agentes de Marketing">
          {lista.map((p) => (
            <button key={p.id} type="button" aria-pressed={p.id === elegido?.id} data-testid={`oficina-agente-${p.aspecto.corto}`} onClick={() => setElegidoId(p.id)}
              className={`rounded-full border px-3 py-1 text-xs ${p.id === elegido?.id ? "border-transparent bg-[#7a5f38] text-white" : "border-border"}`}>
              {p.nombre} · {p.estado.etiqueta}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Los personajes reflejan lo que registran los agentes: trabajan al correr, descansan entre corridas y avisan con «!» si algo necesita atención.</p>
        </div>
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
            <PreguntarAnalista key="analista" analista={analista} datos={analista} agente="marketing_analista" now={now} alPensar={(p) => setPensandoId(p ? elegido.id : null)} />
          ) : elegido.clave === "marketing_cmo" && analista?.cmo ? (
            <PreguntarAnalista key="cmo" analista={analista} datos={analista.cmo} agente="marketing_cmo" now={now} alPensar={(p) => setPensandoId(p ? elegido.id : null)} />
          ) : elegido.clave === "marketing_investigador" ? (
            <HallazgosWeb now={now} />
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

type DatosAgente = { consultas: ConsultaAnalista[]; estadoConsultas: EstadoCarga; preguntar: (pregunta: string, historial?: TurnoHistorial[]) => Promise<RespuestaAnalista> };
// Caja de preguntas, conversación y seguimientos de un agente consultable: el Analista o el CMO.
function PreguntarAnalista({ analista, datos, agente, now, alPensar }: { analista: AnalistaProps; datos: DatosAgente; agente: "marketing_analista" | "marketing_cmo"; now: Date; alPensar: (pensando: boolean) => void }) {
  const esCmo = agente === "marketing_cmo";
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  // Conversación: cada turno guarda la pregunta y su respuesta. Al preguntar de nuevo se mandan los últimos turnos como contexto.
  const [hilo, setHilo] = useState<Array<{ pregunta: string; resp: RespuestaAnalista }>>([]);
  const [resp, setResp] = useState<RespuestaAnalista | null>(null); // última respuesta con error (las buenas viven en el hilo)
  const [abierta, setAbierta] = useState<string | null>(null);
  const [frecuencia, setFrecuencia] = useState<FrecuenciaSeguimiento>("semanal");
  const [guardando, setGuardando] = useState(false);
  const [avisoSeg, setAvisoSeg] = useState<{ ok: boolean; texto: string } | null>(null);
  const limpia = texto.replace(/\s+/g, " ").trim();
  const puede = limpia.length >= 3 && limpia.length <= MAX_PREGUNTA && !enviando;

  const enviar = async () => {
    if (!puede) return;
    setEnviando(true); setResp(null); alPensar(true);
    const contexto: TurnoHistorial[] = hilo.slice(-3).flatMap((t) => [{ rol: "user" as const, texto: t.pregunta }, { rol: "assistant" as const, texto: t.resp.respuesta ?? "" }]);
    try {
      const r = await (contexto.length > 0 ? datos.preguntar(limpia, contexto) : datos.preguntar(limpia));
      if (r.ok) { setHilo((h) => [...h, { pregunta: limpia, resp: r }]); setTexto(""); } else setResp(r); /* si falló, se conserva la pregunta para reintentar */
    } catch { setResp({ ok: false, error: "No pudimos hablar con el Analista. Inténtalo de nuevo." }); }
    finally { setEnviando(false); alPensar(false); }
  };
  const nuevaConversacion = () => { setHilo([]); setResp(null); setTexto(""); setAvisoSeg(null); };

  const darSeguimiento = async () => {
    if (!puede || guardando || !analista.gestionarSeguimiento) return;
    setGuardando(true); setAvisoSeg(null);
    try {
      const r = await analista.gestionarSeguimiento({ accion: "crear_seguimiento", pregunta: limpia, frecuencia, agente });
      if (r.ok) { setTexto(""); setAvisoSeg({ ok: true, texto: "Listo. Se responderá mañana a las 7:45 (hora de Ciudad de México) y lo verás aquí." }); }
      else setAvisoSeg({ ok: false, texto: r.error ?? "No se pudo guardar el seguimiento." });
    } catch { setAvisoSeg({ ok: false, texto: "No se pudo guardar el seguimiento." }); }
    finally { setGuardando(false); }
  };

  return (
    <div className="space-y-3 border-t border-border/40 pt-3" data-testid="analista-preguntar">
      <label htmlFor="pregunta-analista" className="block text-xs font-medium text-muted-foreground">{hilo.length > 0 ? "Sigue la conversación" : esCmo ? "Pídele al CMO un panorama o qué priorizar" : "Pregúntale cómo van tus resultados"}</label>
      <textarea id="pregunta-analista" data-testid="analista-caja" value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={MAX_PREGUNTA + 50} disabled={enviando}
        placeholder={hilo.length > 0 ? (esCmo ? "Ej.: ¿y qué necesitas de mí?" : "Ej.: ¿y en Facebook?") : esCmo ? "Ej.: ¿qué debería priorizar esta semana?" : "Ej.: ¿cómo va el alcance de los carruseles en Instagram este mes?"} className="w-full rounded-lg border border-border bg-background p-2 text-sm"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void enviar(); } }} />
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs ${limpia.length > MAX_PREGUNTA ? "text-red-600" : "text-muted-foreground"}`} data-testid="analista-contador">{limpia.length}/{MAX_PREGUNTA}</span>
        <button type="button" onClick={() => void enviar()} disabled={!puede} data-testid="analista-enviar"
          className="rounded-full bg-[#9b7b4f] px-4 py-1.5 text-xs text-white disabled:opacity-50">{enviando ? "Pensando…" : "Preguntar"}</button>
      </div>
      {analista.gestionarSeguimiento && (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="analista-nuevo-seguimiento">
          <span className="text-muted-foreground">O pídele que lo repita:</span>
          <select value={frecuencia} onChange={(e) => setFrecuencia(e.target.value as FrecuenciaSeguimiento)} aria-label="Frecuencia del seguimiento" disabled={guardando}
            className="rounded-lg border border-border bg-background px-2 py-1">
            {(Object.keys(FRECUENCIA) as FrecuenciaSeguimiento[]).map((f) => <option key={f} value={f}>{FRECUENCIA[f]}</option>)}
          </select>
          <button type="button" onClick={() => void darSeguimiento()} disabled={!puede || guardando} data-testid="analista-dar-seguimiento"
            className="rounded-full border border-[#9b7b4f] px-3 py-1 text-[#9b7b4f] disabled:opacity-50">{guardando ? "Guardando…" : "Dar seguimiento"}</button>
        </div>
      )}
      {avisoSeg && <p className={`text-xs ${avisoSeg.ok ? "text-muted-foreground" : "text-red-600"}`} role={avisoSeg.ok ? "status" : "alert"} data-testid="analista-aviso-seguimiento">{avisoSeg.texto}</p>}

      {resp && !resp.ok && (
        <div className="rounded-lg border border-border p-3 text-sm" role="alert" data-testid="analista-error">
          <p>{resp.error ?? "No pudimos responder ahora."}</p>
          {resp.limite && <p className="mt-1 text-xs text-muted-foreground">{resp.limite === "dia" ? "El tope se reinicia a medianoche (hora de Ciudad de México)." : "Dirección puede ampliar el tope mensual."}</p>}
        </div>
      )}
      {hilo.length > 0 && (
        <div className="space-y-3" data-testid="analista-hilo">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Conversación ({hilo.length} {hilo.length === 1 ? "pregunta" : "preguntas"})</p>
            <button type="button" onClick={nuevaConversacion} disabled={enviando} data-testid="analista-nueva-conversacion"
              className="rounded-full border border-border px-3 py-0.5 text-xs disabled:opacity-50">Nueva conversación</button>
          </div>
          {hilo.map((turno, i) => (
            <div key={i} className="space-y-2">
              <p className="ml-auto max-w-[90%] rounded-2xl rounded-br-sm bg-[#9b7b4f]/15 px-3 py-1.5 text-sm" data-testid="analista-pregunta-hecha">{turno.pregunta}</p>
              <TarjetaRespuesta resp={turno.resp} ultima={i === hilo.length - 1} />
            </div>
          ))}
        </div>
      )}

      {analista.gestionarSeguimiento && <SeguimientosLista analista={analista} agente={agente} now={now} />}

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Preguntas recientes</p>
        {datos.estadoConsultas === "error" ? <p className="text-xs text-muted-foreground" data-testid="analista-historial-error">No pudimos leer el historial de preguntas.</p>
          : datos.estadoConsultas === "cargando" ? <p className="text-xs text-muted-foreground">Leyendo historial…</p>
          : datos.consultas.length === 0 ? <p className="text-xs text-muted-foreground" data-testid="analista-sin-historial">Todavía no hay preguntas.</p> : (
            <ul className="divide-y divide-border/40 text-xs" data-testid="analista-historial">
              {datos.consultas.map((c) => (
                <li key={c.id} className="py-1.5">
                  <button type="button" className="flex w-full items-start justify-between gap-2 text-left" aria-expanded={abierta === c.id} onClick={() => setAbierta(abierta === c.id ? null : c.id)}>
                    <span className="min-w-0"><span className="block">{c.pregunta}</span><span className="block text-muted-foreground">{cuandoRelativo(c.created_at, now)}{c.seguimiento_id ? " · seguimiento" : ""}</span></span>
                    <Pastilla color={ETIQUETA_CONSULTA[c.estado].color}>{ETIQUETA_CONSULTA[c.estado].etiqueta}</Pastilla>
                  </button>
                  {abierta === c.id && c.respuesta && (
                    <div className="mt-1 rounded bg-background/50 p-2" data-testid={`analista-detalle-${c.id}`}>
                      <TextoAnalista texto={c.respuesta} />{c.verificada === false && <span className="mt-1 block text-red-600">Cifras sin verificar{c.no_verificadas.length ? `: ${c.no_verificadas.join(", ")}` : ""}.</span>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
      </div>
      <p className="text-xs text-muted-foreground">{esCmo ? "El CMO solo lee y propone: no publica ni cambia nada, y cada propuesta la decide una persona. Sus cifras salen de la base y se verifican antes de mostrarlas." : "El Analista solo lee y explica: no publica ni cambia nada. Sus cifras salen de la base y se verifican antes de mostrarlas."}</p>
    </div>
  );
}

// ── Seguimientos: preguntas que el Analista o el CMO responden solos ──────────────────────────────────────────────────────────
const FRECUENCIA: Record<FrecuenciaSeguimiento, string> = { una_vez: "Una vez", diaria: "Cada día", semanal: "Cada semana" };

function proximaLegible(iso: string, ahora: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "pronto";
  if (d.getTime() <= ahora.getTime()) return "en la próxima corrida (7:45)";
  return `el ${d.toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" })} a las 7:45`;
}

function SeguimientosLista({ analista, agente, now }: { analista: AnalistaProps; agente: "marketing_analista" | "marketing_cmo"; now: Date }) {
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cada agente ve solo sus seguimientos (los anteriores a que existiera el CMO no traen agente: son del Analista).
  const lista = (analista.seguimientos ?? []).filter((s) => (s.agente ?? "marketing_analista") === agente);
  const cambiar = async (id: string, estado: "activo" | "pausado" | "terminado") => {
    if (!analista.gestionarSeguimiento || trabajando) return;
    setTrabajando(id); setError(null);
    try { const r = await analista.gestionarSeguimiento({ accion: "cambiar_seguimiento", id, estado }); if (!r.ok) setError(r.error ?? "No se pudo cambiar el seguimiento."); }
    catch { setError("No se pudo cambiar el seguimiento."); }
    finally { setTrabajando(null); }
  };
  return (
    <div data-testid="analista-seguimientos">
      <p className="mb-1 text-xs font-medium text-muted-foreground">Seguimientos</p>
      {analista.estadoSeguimientos === "error" ? <p className="text-xs text-muted-foreground" data-testid="analista-seguimientos-error">No pudimos leer los seguimientos.</p>
        : analista.estadoSeguimientos === "cargando" ? <p className="text-xs text-muted-foreground">Leyendo seguimientos…</p>
        : lista.length === 0 ? <p className="text-xs text-muted-foreground" data-testid="analista-sin-seguimientos">Todavía no hay seguimientos. Escribe una pregunta y elige «Dar seguimiento».</p> : (
          <ul className="divide-y divide-border/40 text-xs">
            {lista.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-2 py-1.5" data-testid={`seguimiento-${s.id}`}>
                <span className="min-w-0">
                  <span className="block">{s.pregunta}</span>
                  <span className="block text-muted-foreground">{FRECUENCIA[s.frecuencia]} · {s.estado === "pausado" ? "en pausa" : `próxima ${proximaLegible(s.proxima_at, now)}`}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  {s.estado === "activo"
                    ? <button type="button" disabled={!!trabajando} onClick={() => void cambiar(s.id, "pausado")} className="rounded-full border border-border px-2 py-0.5 disabled:opacity-50">Pausar</button>
                    : <button type="button" disabled={!!trabajando} onClick={() => void cambiar(s.id, "activo")} className="rounded-full border border-border px-2 py-0.5 disabled:opacity-50">Reanudar</button>}
                  <button type="button" disabled={!!trabajando} onClick={() => void cambiar(s.id, "terminado")} className="rounded-full border border-border px-2 py-0.5 disabled:opacity-50">Terminar</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      {error && <p className="mt-1 text-xs text-red-600" role="alert" data-testid="analista-seguimientos-fallo">{error}</p>}
    </div>
  );
}

// Una respuesta del Analista: texto limpio, si se verificaron las cifras y sus fuentes con fecha de corte.
function TarjetaRespuesta({ resp, ultima }: { resp: RespuestaAnalista; ultima: boolean }) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3" data-testid={ultima ? "analista-respuesta" : "analista-respuesta-previa"}>
      <TextoAnalista texto={resp.respuesta ?? ""} className="text-sm leading-relaxed" />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {resp.verificada
          ? <Pastilla color="verde">Cifras verificadas</Pastilla>
          : <Pastilla color="rojo">Cifras sin verificar</Pastilla>}
        {!resp.verificada && (resp.no_verificadas?.length ?? 0) > 0 && <span className="text-muted-foreground" data-testid={ultima ? "analista-no-verificadas" : undefined}>Revisa: {resp.no_verificadas!.join(", ")}</span>}
      </div>
      {(resp.fuentes?.length ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground" data-testid={ultima ? "analista-fuentes" : undefined}>
          Fuentes: {resp.fuentes!.map((f) => `${f.herramienta}${f.corte ? ` (corte ${f.corte.slice(0, 10)})` : ""}`).join(" · ")}
        </p>
      )}
      {ultima && typeof resp.restantes_hoy === "number" && <p className="text-xs text-muted-foreground">Te quedan {resp.restantes_hoy} preguntas hoy.</p>}
    </div>
  );
}


// ── Investigador web: qué vigila y qué encontró ──────────────────────────────────────────────────────────────────────
const TIPO_FUENTE: Record<string, string> = { propio: "Sitio propio", competencia: "Competencia", noticias: "Noticias" };
// Todo lo que viene de páginas externas se pinta como texto (nunca como HTML); el enlace solo se abre si es https.
const enlaceSeguro = (u: string): string | null => { try { const x = new URL(u); return x.protocol === "https:" ? x.toString() : null; } catch { return null; } };

function HallazgosWeb({ now }: { now: Date }) {
  const fuentes = useFuentesWeb(), hallazgos = useHallazgosWeb(), propuestas = useFuentesPropuestas();
  return (
    <div className="space-y-3 border-t border-border/40 pt-3" data-testid="investigador-panel">
      <p className="text-xs text-muted-foreground">Solo lee las páginas y noticias que Dirección define. No inicia sesión ni escribe en ningún sitio. Lo que ves es un resumen con su fuente, no el texto de la página.</p>
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Qué vigila</p>
        {fuentes.isError ? <p className="text-xs text-muted-foreground" data-testid="investigador-fuentes-error">No pudimos leer la lista de fuentes.</p>
          : fuentes.isLoading ? <p className="text-xs text-muted-foreground">Leyendo…</p>
          : (fuentes.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground" data-testid="investigador-sin-fuentes">Todavía no hay fuentes. Dirección las define (sitio propio, competencia y noticias) y hasta entonces no lee nada.</p> : (
            <ul className="divide-y divide-border/40 text-xs" data-testid="investigador-fuentes">
              {(fuentes.data ?? []).map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-2 py-1.5">
                  <span className="min-w-0"><span className="block">{f.nombre}</span><span className="block text-muted-foreground">{TIPO_FUENTE[f.tipo] ?? f.tipo} · {f.ultima_lectura_at ? `leída ${cuandoRelativo(f.ultima_lectura_at, now)}` : "sin leer todavía"}</span></span>
                  {f.ultimo_estado && <span className="shrink-0 text-muted-foreground">{f.ultimo_estado}</span>}
                </li>
              ))}
            </ul>
          )}
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Fuentes que propone (esperan tu aprobación)</p>
        {propuestas.isError ? <p className="text-xs text-muted-foreground" data-testid="investigador-propuestas-error">No pudimos leer las propuestas.</p>
          : propuestas.isLoading ? <p className="text-xs text-muted-foreground">Leyendo…</p>
          : (propuestas.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground" data-testid="investigador-sin-propuestas">Todavía no propone ninguna. No lee nada de lo que propone hasta que una persona lo apruebe.</p> : (
            <ul className="space-y-2 text-xs" data-testid="investigador-propuestas">
              {(propuestas.data ?? []).map((p) => {
                const url = enlaceSeguro(p.url);
                return (
                  <li key={p.id} className="rounded-xl border border-border/40 p-2">
                    <p className="font-medium">{p.nombre}</p>
                    {p.motivo && <p className="mt-0.5 text-muted-foreground">{p.motivo}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-muted-foreground">
                      <span>{TIPO_FUENTE[p.tipo] ?? p.tipo} · {p.formato === "feed" ? "feed de noticias" : "página"}{p.verificada_at ? ` · verificada ${cuandoRelativo(p.verificada_at, now)}` : ""}</span>
                      {url && <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">Ver sitio</a>}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Qué encontró</p>
        {hallazgos.isError ? <p className="text-xs text-muted-foreground" data-testid="investigador-hallazgos-error">No pudimos leer los hallazgos.</p>
          : hallazgos.isLoading ? <p className="text-xs text-muted-foreground">Leyendo…</p>
          : (hallazgos.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground" data-testid="investigador-sin-hallazgos">Todavía no hay hallazgos.</p> : (
            <ul className="space-y-2 text-xs" data-testid="investigador-hallazgos">
              {(hallazgos.data ?? []).map((h) => {
                const url = enlaceSeguro(h.enlace);
                return (
                  <li key={h.id} className="rounded-xl border border-border/40 p-2">
                    <p className="font-medium">{h.titulo}</p>
                    {h.resumen && <p className="mt-0.5 text-muted-foreground">{h.resumen}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-muted-foreground">
                      <span>{h.mk_fuente_web?.nombre ?? "Fuente"} · {h.tipo === "cambio_pagina" ? "cambio en la página" : "nota nueva"} · {cuandoRelativo(h.publicado_at ?? h.encontrado_at, now)}</span>
                      {url && <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">Abrir fuente</a>}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </div>
  );
}
