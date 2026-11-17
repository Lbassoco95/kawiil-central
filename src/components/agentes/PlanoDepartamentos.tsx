import { useMemo, useState } from "react";
import { cuandoRelativo, type AgenteRegistro, type TareaAgente } from "@/lib/agentes/registro";
import { spriteAgente, ANCHO, ALTO, oscurecer, type Rect } from "@/lib/agentes/sprites";
import { ESTADO_OFICINA, type FiguraOficina } from "@/lib/agentes/oficina";
import {
  agruparPorDepartamento, celdasDe, contarTareas, ESCENA, filasDeTareas, FILTROS_TAREAS, isoPunto, posicionesIslas, resumenDepartamento, TH, TW, DIAS_HECHAS,
  type FiltroTareas, type FilaTarea, type GrupoDepartamento,
} from "@/lib/agentes/departamentos";
import { CSS, TONO } from "@/components/agentes/escritorio";
import { DIAS_COLABORACION, llamadasEntreAgentes, origenDeTarea } from "@/lib/agentes/colaboracion";

// Plano por departamentos (Zen + Glass): una isla isométrica por departamento con sus agentes en su escritorio (los mismos dibujos y animaciones de la
// Oficina), una tarjeta de cifras junto a cada isla y, a la derecha, el estado de las tareas con su filtro. Es solo lectura. Las tareas se cuentan por
// agente y estado: no se muestra ningún título, instrucción ni resultado. Todo estado también se dice con texto.
// El diseño se inspira en los planos de oficina isométricos en general (islas, tarjetas de cifras, centro compartido, lista de tareas por estado); el dibujo,
// el código y los colores son propios de Kawiil.

const CSS_PLANO = `
.pl-agente .pl-anillo{opacity:0;transition:opacity .25s ease}
.pl-agente:hover .pl-anillo,.pl-agente:focus-visible .pl-anillo{opacity:1}
.pl-agente:focus{outline:none}
@keyframes pl-pulso{0%,100%{opacity:.45}50%{opacity:1}}
.pl-viva{animation:pl-pulso 2.4s ease-in-out infinite}
@keyframes pl-barra{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
.pl-barra{animation:pl-barra 2.4s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.pl-barra{animation:none!important;transform:translateX(30%)}.pl-viva{animation:none!important;opacity:.7}}
`;

const PXS = 2.6;                       // tamaño de cada píxel del dibujo de un agente en el plano
const PROF = 16;                       // grosor de las islas
const pintarEsc = (rs: Rect[]) => rs.map((r, i) => <rect key={i} x={r.x * PXS} y={r.y * PXS} width={r.w * PXS} height={r.h * PXS} fill={r.c} />);
const recorta = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const pts = (...p: Array<{ x: number; y: number }>) => p.map((q) => `${q.x},${q.y}`).join(" ");

function Agente({ f, x, y, depto, onElegir }: { f: FiguraOficina; x: number; y: number; depto: string; onElegir?: (id: string) => void }) {
  const info = ESTADO_OFICINA[f.estado], c = TONO[info.color] ?? TONO.gris;
  const sprite = spriteAgente(f.estado, f.id, c.cuerpo);
  const ancho = ANCHO * PXS, alto = ALTO * PXS, apagado = f.estado === "apagado";
  const nombre = recorta(f.nombre, 11), tagW = Math.max(34, nombre.length * 6.1 + 14);
  const activar = () => onElegir?.(f.id);
  return (
    <g transform={`translate(${x},${y})`}>
      <ellipse cx={0} cy={2} rx={27} ry={8} fill="rgba(70,52,28,.14)" />
      {/* La posición va en un <g> aparte: index.css aplica transform a todo [role="button"]:active y, en un SVG, eso borraría el translate. */}
      <g className={`pl-agente of-${f.estado}`} role="button" tabIndex={0} data-testid={`plano-${f.id}`} data-estado={f.estado} style={{ cursor: onElegir ? "pointer" : "default", transform: "none" }}
        aria-label={`${f.nombre}: ${info.etiqueta}. Departamento ${depto}${depto === "Marketing" ? " (abre el módulo de Marketing)" : ""}`} onClick={activar} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activar(); } }}>
        <rect className="of-celda" x={-ancho / 2 - 6} y={-alto - 22} width={ancho + 12} height={alto + 26} rx={10} fill="transparent" style={{ pointerEvents: "all" }} />
        <rect className="pl-anillo" x={-ancho / 2 - 6} y={-alto - 22} width={ancho + 12} height={alto + 26} rx={10} fill="rgba(143,180,217,.12)" stroke="#8fb4d9" strokeWidth={1.5} />
        <g opacity={apagado ? 0.55 : 1} transform={`translate(${-ancho / 2},${-alto + 3})`} shapeRendering="crispEdges">
          {sprite.frames.map((fr, k) => <g key={k} className={sprite.frames.length > 1 ? `of-frame of-frame-${k}` : undefined}>{pintarEsc(fr)}</g>)}
          <g className="of-emote">{pintarEsc(sprite.emote)}</g>
        </g>
        <g transform={`translate(0,${-alto - 8})`}>
          <rect x={-tagW / 2} y={-11} width={tagW} height={15} rx={7.5} fill="rgba(255,255,255,.9)" stroke="rgba(120,100,70,.18)" />
          <text x={0} y={0} textAnchor="middle" fontSize={9.5} fontWeight={600} style={{ fill: "#4a4033" }}>{nombre}</text>
        </g>
      </g>
    </g>
  );
}

function Isla({ g, centro, onElegir }: { g: GrupoDepartamento; centro: { x: number; y: number }; onElegir?: (id: string) => void }) {
  const { cols, filas } = celdasDe(g.figuras.length);
  const s = Math.min(1, 350 / ((cols + filas) * TW));
  const A = isoPunto(0, 0, cols, filas), B = isoPunto(cols, 0, cols, filas), C = isoPunto(cols, filas, cols, filas), D = isoPunto(0, filas, cols, filas);
  const baja = (p: { x: number; y: number }) => ({ x: p.x, y: p.y + PROF });
  const activa = g.figuras.some((f) => f.estado === "trabajando");   // alguien de esta isla está trabajando ahora: la isla se ilumina
  const celdas = g.figuras.map((f, k) => ({ f, i: k % cols, j: Math.floor(k / cols) })).sort((p, q) => p.i + p.j - (q.i + q.j));
  return (
    <g transform={`translate(${centro.x},${centro.y}) scale(${s})`} data-testid={`isla-${g.depto.clave}`} data-activa={activa ? "true" : "false"}>
      <polygon points={pts(D, C, baja(C), baja(D))} fill={oscurecer(g.depto.tinte, 0.86)} />
      <polygon points={pts(B, C, baja(C), baja(B))} fill={oscurecer(g.depto.tinte, 0.74)} />
      <polygon points={pts(A, B, C, D)} fill={g.depto.tinte} />
      {activa && <polygon className="pl-viva" points={pts(A, B, C, D)} fill="none" stroke="#5fb37a" strokeWidth={4} strokeLinejoin="round" data-testid={`isla-viva-${g.depto.clave}`} />}
      {Array.from({ length: cols * filas }, (_, k) => {
        const i = k % cols, j = Math.floor(k / cols);
        return <polygon key={k} points={pts(isoPunto(i, j, cols, filas), isoPunto(i + 1, j, cols, filas), isoPunto(i + 1, j + 1, cols, filas), isoPunto(i, j + 1, cols, filas))} fill="none" stroke="rgba(255,255,255,.5)" strokeWidth={1} />;
      })}
      {celdas.map(({ f, i, j }) => {
        const p = isoPunto(i + 0.5, j + 0.5, cols, filas);
        return <Agente key={f.id} f={f} x={p.x} y={p.y + TH * 0.45} depto={g.depto.nombre} onElegir={onElegir} />;
      })}
    </g>
  );
}

const TW_CARD = 208, TH_CARD = 108;
function Tarjeta({ g, x, y, ahora, tareas }: { g: GrupoDepartamento; x: number; y: number; ahora: Date; tareas: TareaAgente[] }) {
  const activa = g.figuras.some((f) => f.estado === "trabajando");
  const r = resumenDepartamento(g.figuras.map((f) => f.id), tareas, ahora);
  const stat = (etq: string, n: number, dx: number) => <text key={etq} x={x + dx} y={y + 93} fontSize={9} letterSpacing={0.6} style={{ fill: "#7a6d58" }}>{etq} <tspan fontSize={13} fontWeight={700} style={{ fill: "#3f362a" }}>{n}</tspan></text>;
  return (
    <g data-testid={`tarjeta-${g.depto.clave}`} role="group" aria-label={`${g.depto.nombre}: ${r.agentes} agentes, ${r.haciendo} haciendo, ${r.enCola} en cola, ${r.hechas} hechas en ${DIAS_HECHAS} días${r.conError ? `, ${r.conError} con error` : ""}${activa ? ", trabajando ahora" : ""}`}>
      <rect x={x} y={y} width={TW_CARD} height={TH_CARD} rx={18} fill="rgba(255,255,255,.8)" stroke="rgba(120,100,70,.16)" />
      <rect x={x} y={y + 14} width={4} height={26} rx={2} fill={oscurecer(g.depto.tinte, 0.8)} />
      <circle className={activa ? "pl-viva" : undefined} cx={x + 20} cy={y + 24} r={5} fill={activa ? "#5fb37a" : oscurecer(g.depto.tinte, 0.82)} />
      <text x={x + 32} y={y + 28} fontSize={13} fontWeight={600} style={{ fill: "#3f362a" }}>{recorta(g.depto.nombre, r.conError > 0 ? 15 : 24)}</text>
      {r.conError > 0 && (
        <g><rect x={x + TW_CARD - 74} y={y + 10} width={62} height={18} rx={9} fill="rgba(227,169,176,.35)" /><text x={x + TW_CARD - 43} y={y + 23} textAnchor="middle" fontSize={9.5} fontWeight={600} style={{ fill: "#8c4650" }}>{r.conError} con error</text></g>
      )}
      <text x={x + 20} y={y + 66} fontSize={34} fontWeight={300} style={{ fill: "#3f362a" }}>{r.agentes}</text>
      <text x={x + 20 + String(r.agentes).length * 20 + 8} y={y + 64} fontSize={10} letterSpacing={1.4} style={{ fill: "#7a6d58" }}>{r.agentes === 1 ? "AGENTE" : "AGENTES"}</text>
      <line x1={x + 16} x2={x + TW_CARD - 16} y1={y + 78} y2={y + 78} stroke="rgba(120,100,70,.16)" />
      {stat("HACIENDO", r.haciendo, 16)}{stat("EN COLA", r.enCola, 84)}{stat("HECHAS", r.hechas, 148)}
    </g>
  );
}

const ESTADO_TAREA: Record<FilaTarea["grupo"], { t: string; pastilla: string; barra: string }> = {
  en_curso: { t: "En curso", pastilla: "border-sky-300/70 bg-sky-100/60 text-sky-900", barra: "bg-sky-300" },
  en_cola: { t: "En cola", pastilla: "border-amber-300/70 bg-amber-100/60 text-amber-900", barra: "bg-amber-200" },
  terminadas: { t: "Terminada", pastilla: "border-emerald-300/70 bg-emerald-100/60 text-emerald-900", barra: "bg-emerald-300" },
  con_error: { t: "Con error", pastilla: "border-rose-300/70 bg-rose-100/60 text-rose-900", barra: "bg-rose-300" },
};

function Barra({ grupo }: { grupo: FilaTarea["grupo"] }) {
  const e = ESTADO_TAREA[grupo];
  return (
    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-border/40" aria-hidden>
      {grupo === "en_curso" ? <span className={`pl-barra block h-full w-2/5 rounded-full ${e.barra}`} />
        : grupo === "en_cola" ? null
        : <span className={`block h-full w-full rounded-full ${e.barra}`} />}
    </span>
  );
}

// `alAbrirMarketing`: Marketing tiene su módulo aparte (/marketing). Su isla es un resumen: al elegir uno de sus agentes o tareas se abre ese módulo en vez de la Oficina.
export function PlanoDepartamentos({ figuras, agentes, tareas, ahora, onElegir, alAbrirMarketing }: { figuras: FiguraOficina[]; agentes: AgenteRegistro[]; tareas: TareaAgente[]; ahora: Date; onElegir?: (id: string) => void; alAbrirMarketing?: () => void }) {
  const [filtro, setFiltro] = useState<FiltroTareas>("todas");
  const grupos = useMemo(() => agruparPorDepartamento(figuras, agentes), [figuras, agentes]);
  const ids = useMemo(() => new Set(figuras.map((f) => f.id)), [figuras]);
  const visibles = useMemo(() => tareas.filter((t) => t.agent_id !== null && ids.has(t.agent_id)), [tareas, ids]);
  const conteo = useMemo(() => contarTareas(visibles), [visibles]);
  const filas = useMemo(() => filasDeTareas(visibles, agentes, filtro), [visibles, agentes, filtro]);
  const posiciones = posicionesIslas(grupos.length);
  const nombreDe = useMemo(() => new Map(figuras.map((f) => [f.id, f.nombre])), [figuras]);
  const llamadas = useMemo(() => llamadasEntreAgentes(visibles, ahora).filter((l) => ids.has(l.de) && ids.has(l.a)), [visibles, ahora, ids]);
  const indiceIsla = useMemo(() => new Map(grupos.flatMap((g, k) => g.figuras.map((f) => [f.id, k] as const))), [grupos]);
  const origenes = useMemo(() => new Map(visibles.map((t) => [t.id, origenDeTarea(t, visibles)])), [visibles]);
  const idsMarketing = useMemo(() => new Set(grupos.filter((g) => g.depto.clave === "marketing").flatMap((g) => g.figuras.map((f) => f.id))), [grupos]);
  const elegir = onElegir || alAbrirMarketing ? (id: string) => { if (idsMarketing.has(id)) alAbrirMarketing?.(); else onElegir?.(id); } : undefined;

  if (figuras.length === 0) return <p className="zen-glass rounded-2xl p-6 text-sm text-muted-foreground">No hay agentes en el registro para mostrar en el plano.</p>;
  const hub = ESCENA.hub;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start" data-testid="plano">
      <style>{CSS}{CSS_PLANO}</style>
      <div className="zen-glass min-w-0 overflow-x-auto rounded-3xl p-2">
        <svg viewBox={`0 0 ${ESCENA.ancho} ${ESCENA.alto}`} className="mx-auto w-full min-w-[640px]" role="group" aria-label="Plano de departamentos">
          {posiciones.map((p, k) => (
            <g key={"c" + k}>
              <line x1={hub.x} y1={hub.y} x2={p.x} y2={p.y} stroke="#efe6d6" strokeWidth={22} strokeLinecap="round" />
              <line x1={hub.x} y1={hub.y} x2={p.x} y2={p.y} stroke="rgba(120,100,70,.28)" strokeWidth={1.5} strokeDasharray="3 7" strokeLinecap="round" />
            </g>
          ))}
          <g data-testid="plano-centro">
            <polygon points={pts(isoPunto(0, 0, 2, 2), isoPunto(2, 0, 2, 2), isoPunto(2, 2, 2, 2), isoPunto(0, 2, 2, 2)).split(" ").map((q) => { const [a, b] = q.split(",").map(Number); return `${a + hub.x},${b + hub.y + PROF}`; }).join(" ")} fill="#d9cfbd" />
            <polygon points={pts(isoPunto(0, 0, 2, 2), isoPunto(2, 0, 2, 2), isoPunto(2, 2, 2, 2), isoPunto(0, 2, 2, 2)).split(" ").map((q) => { const [a, b] = q.split(",").map(Number); return `${a + hub.x},${b + hub.y}`; }).join(" ")} fill="#ece4d4" stroke="rgba(120,100,70,.2)" />
            <text x={hub.x} y={hub.y - 2} textAnchor="middle" fontSize={11} letterSpacing={2.2} style={{ fill: "#7a6d58" }}>EQUIPO</text>
            <text x={hub.x} y={hub.y + 16} textAnchor="middle" fontSize={15} fontWeight={600} style={{ fill: "#3f362a" }}>{figuras.length} {figuras.length === 1 ? "agente" : "agentes"}</text>
          </g>
          {llamadas.map((l) => {
            const i = indiceIsla.get(l.de), j = indiceIsla.get(l.a);
            if (i === undefined || j === undefined || i === j) return null;
            const p = posiciones[i], q = posiciones[j], mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
            const cx = mx - (dy / d) * 70, cy = my + (dx / d) * 70;   // la curva se abre hacia un lado para no encimarse con los caminos al centro
            const tx = 0.25 * p.x + 0.5 * cx + 0.25 * q.x, ty = 0.25 * p.y + 0.5 * cy + 0.25 * q.y;
            return (
              <g key={`${l.de}>${l.a}`} data-testid={`llamada-${l.de}-${l.a}`}>
                <path d={`M${p.x},${p.y} Q${cx},${cy} ${q.x},${q.y}`} fill="none" stroke="#7fa6d3" strokeWidth={1.5 + Math.min(3, Math.log2(l.veces + 1))} strokeDasharray="6 5" strokeLinecap="round" opacity={0.85} />
                <rect x={tx - 16} y={ty - 10} width={32} height={20} rx={10} fill="rgba(255,255,255,.92)" stroke="#7fa6d3" />
                <text x={tx} y={ty + 4} textAnchor="middle" fontSize={11} fontWeight={600} style={{ fill: "#3f5f86" }}>{l.veces}×</text>
              </g>
            );
          })}
          {grupos.map((g, k) => <Isla key={g.depto.clave} g={g} centro={posiciones[k]} onElegir={elegir} />)}
          {grupos.map((g, k) => {
            const { cols, filas: fl } = celdasDe(g.figuras.length), s = Math.min(1, 350 / ((cols + fl) * TW)), mitad = ((cols + fl) * TH * s) / 2, p = posiciones[k];
            const y = p.fila === "arriba" ? Math.max(12, p.y - mitad - TH_CARD - 92) : Math.min(ESCENA.alto - TH_CARD - 10, p.y + mitad + PROF + 22);
            return <Tarjeta key={"t" + g.depto.clave} g={g} x={p.x - TW_CARD / 2} y={y} ahora={ahora} tareas={visibles} />;
          })}
        </svg>
        {idsMarketing.size > 0 && (
          <p className="px-3 pb-2 pt-1 text-xs text-muted-foreground" data-testid="plano-nota-marketing">
            La isla de Marketing es un resumen: su módulo sigue aparte.{alAbrirMarketing && <> <button type="button" className="underline" onClick={alAbrirMarketing} data-testid="plano-abrir-marketing">Abrir Marketing</button></>}
          </p>
        )}
      </div>

      <aside className="zen-glass min-w-0 rounded-3xl p-4 lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-y-auto" aria-label="Estado de tareas" data-testid="plano-tareas">
        <h2 className="text-lg font-medium">Estado de tareas</h2>
        <p className="mb-3 text-xs text-muted-foreground">Por agente y estado; no se muestran los textos de las tareas.</p>
        <div className="mb-3 flex flex-wrap gap-1.5 text-xs" role="group" aria-label="Filtrar tareas por estado">
          {FILTROS_TAREAS.map((f) => (
            <button key={f.v} type="button" aria-pressed={filtro === f.v} data-testid={`plano-filtro-${f.v}`} onClick={() => setFiltro(f.v)}
              className={`rounded-full border px-2.5 py-1 ${filtro === f.v ? "border-primary/60 bg-primary/10 font-medium" : "border-border/60"}`}>{f.t} <span className="text-muted-foreground">{conteo[f.v]}</span></button>
          ))}
        </div>
        {filas.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="plano-sin-tareas">{conteo.todas === 0 ? "Aún no hay tareas registradas." : "No hay tareas con este filtro."}</p>
        ) : (
          <ul className="space-y-1.5" data-testid="plano-lista">
            {filas.map((t) => {
              const e = ESTADO_TAREA[t.grupo];
              return (
                <li key={t.id}>
                  <button type="button" disabled={!elegir || !t.agenteId} onClick={() => t.agenteId && elegir?.(t.agenteId)} data-testid={`plano-tarea-${t.id}`}
                    className="w-full rounded-2xl border border-border/50 bg-background/40 p-2.5 text-left text-sm enabled:hover:bg-background/70">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{t.agente}</span>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${e.pastilla}`}>{e.t}</span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{t.tipo} · {cuandoRelativo(t.fin ?? t.creada, ahora)}{origenes.get(t.id) ? ` · pedida por ${origenes.get(t.id) === "desconocido" ? "otra tarea" : nombreDe.get(origenes.get(t.id)!) ?? "otro agente"}` : ""}</span>
                    <Barra grupo={t.grupo} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <section className="mt-4 border-t border-border/40 pt-3" aria-label="Colaboración entre agentes" data-testid="plano-colaboracion">
          <h3 className="text-sm font-medium">Colaboración entre agentes</h3>
          {llamadas.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="plano-sin-colaboracion">Aún no hay llamadas entre agentes. Cuando un agente le pida trabajo a otro, aparecerá aquí.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs" data-testid="plano-llamadas">
              {llamadas.map((l) => (
                <li key={`${l.de}>${l.a}`}>{nombreDe.get(l.de)} → {nombreDe.get(l.a)} · {l.veces} {l.veces === 1 ? "vez" : "veces"} en {DIAS_COLABORACION} días{l.conError > 0 ? ` (${l.conError} con error)` : ""}</li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
