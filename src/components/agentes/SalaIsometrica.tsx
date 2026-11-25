import { useEffect, useMemo, useRef } from "react";
import { spriteAgente, ANCHO, ALTO, oscurecer } from "@/lib/agentes/sprites";
import { ESTADO_OFICINA, type FiguraOficina } from "@/lib/agentes/oficina";
import { distribuirSala, distribuirOficinas } from "@/lib/agentes/salas";
import { CSS, TONO, pintarAccesorios } from "@/components/agentes/escritorio";
import type { Departamento } from "@/lib/agentes/departamentos";
import { textoAgentes } from "@/lib/agentes/equipos";

// Sala isométrica de una isla (pixel art, Zen + Glass): piso, dos paredes, zonas con alfombra y cada agente en su escritorio con el nombre debajo.
// Es la misma sala en Agentes y en Marketing. Solo lectura: lo que se ve es agente y estado (nunca textos de tareas); un clic abre al agente.
const TW = 96, TH = 48, PX = 4.2, PARED = 120, MARGEN = 30;
const P = (u: number, v: number) => ({ x: (u - v) * (TW / 2), y: (u + v) * (TH / 2) });
const pts = (...q: Array<{ x: number; y: number }>) => q.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
const recorta = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const CSS_SALA = `
.sl{--sl-piso:#efe4d0;--sl-piso2:#e8dcc5;--sl-pared-i:#f4ecdd;--sl-pared-d:#eadfca;--sl-borde:rgba(120,100,70,.28);--sl-ventana:#cfe6ee;--sl-texto:#4a4033;--sl-etq:rgba(255,255,255,.92)}
[data-theme="dark"] .sl{--sl-piso:#3a342b;--sl-piso2:#342e26;--sl-pared-i:#4a4237;--sl-pared-d:#40392f;--sl-borde:rgba(255,255,255,.14);--sl-ventana:#5a7f8c;--sl-texto:#eadfce;--sl-etq:rgba(40,36,30,.92)}
.sl-agente:focus{outline:none}.sl-agente:focus-visible .sl-aro,.sl-agente:hover .sl-aro{opacity:1}.sl-aro{opacity:0;transition:opacity .2s ease}
`;

function Puesto({ f, x, y, onElegir, elegido, texto }: { f: FiguraOficina; x: number; y: number; onElegir?: (id: string) => void; elegido: boolean; texto: string }) {
  const info = ESTADO_OFICINA[f.estado], c = TONO[info.color] ?? TONO.gris, apagado = f.estado === "apagado";
  const sprite = spriteAgente(f.estado, f.id, c.cuerpo, f.clave);
  const w = ANCHO * PX, h = ALTO * PX, activar = () => onElegir?.(f.id);
  const nombre = recorta(f.nombre, 18), tw = Math.max(50, nombre.length * 7.6 + 18);
  return (
    <g transform={`translate(${x},${y})`}>
      <ellipse cx={0} cy={2} rx={42} ry={11} fill="rgba(70,52,28,.16)" />
      {/* La posición va en un <g> aparte: index.css aplica transform a todo [role="button"]:active y borraría el translate. */}
      <g className={`sl-agente of-${f.estado}`} role="button" tabIndex={0} data-testid={`sala-agente-${f.id}`} data-estado={f.estado} style={{ cursor: onElegir ? "pointer" : "default", transform: "none" }}
        aria-label={`${f.nombre}: ${texto}`} aria-pressed={onElegir ? elegido : undefined} onClick={activar} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activar(); } }}>
        <rect className="of-celda" x={-w / 2 - 8} y={-h - 4} width={w + 16} height={h + 56} rx={10} fill="transparent" style={{ pointerEvents: "all" }} />
        <rect className="sl-aro" style={elegido ? { opacity: 1 } : undefined} x={-w / 2 - 8} y={-h - 4} width={w + 16} height={h + 56} rx={10} fill="rgba(143,180,217,.14)" stroke="#8fb4d9" strokeWidth={1.5} />
        <g opacity={apagado ? 0.55 : 1} transform={`translate(${-w / 2},${-h + 6})`} shapeRendering="crispEdges">
          {sprite.frames.map((fr, k) => <g key={k} className={sprite.frames.length > 1 ? `of-frame of-frame-${k}` : undefined}>{fr.map((r, i) => <rect key={i} x={r.x * PX} y={r.y * PX} width={r.w * PX} height={r.h * PX} fill={r.c} />)}</g>)}
          {pintarAccesorios(sprite.accesorios, PX)}
          <g className="of-emote">{sprite.emote.map((r, i) => <rect key={i} x={r.x * PX} y={r.y * PX} width={r.w * PX} height={r.h * PX} fill={r.c} />)}</g>
        </g>
        <rect x={-tw / 2} y={14} width={tw} height={19} rx={9.5} style={{ fill: "var(--sl-etq)", stroke: "var(--sl-borde)" }} />
        <text x={0} y={28} textAnchor="middle" fontSize={12} fontWeight={600} style={{ fill: "var(--sl-texto)" }}>{nombre}</text>
        <text x={0} y={48} textAnchor="middle" fontSize={11} style={{ fill: "var(--sl-texto)", opacity: 0.8 }}>{texto}</text>
      </g>
    </g>
  );
}

// Oficina de equipo dibujada dentro de la sala: piso de otro color, letrero con el nombre del jefe y el número de agentes, un escritorio por agente y un lugar libre.
export interface OficinaEnSala { clave: string; nombre: string; tinte: string; figuras: FiguraOficina[] }

// `etiqueta`: texto del estado si no es el de la oficina (Marketing usa el suyo). `elegidoId`: agente con el aro fijo.
// `oficinas` + `onAbrirOficina`: oficinas de equipo (R1.b). `hrefPestana`: si se da, cada agente de la lista lleva «Abrir en pestaña» (R2.1).
export function SalaIsometrica({ depto, figuras, onElegir, elegidoId, etiqueta, oficinas = [], onAbrirOficina, hrefPestana }: {
  depto: Departamento; figuras: FiguraOficina[]; onElegir?: (id: string) => void; elegidoId?: string | null; etiqueta?: (f: FiguraOficina) => string;
  oficinas?: OficinaEnSala[]; onAbrirOficina?: (clave: string) => void; hrefPestana?: (id: string) => string;
}) {
  const texto = (f: FiguraOficina) => etiqueta?.(f) || ESTADO_OFICINA[f.estado].etiqueta;
  const base = useMemo(() => distribuirSala(depto.clave, figuras, (f) => f.clave), [depto.clave, figuras]);
  const ext = useMemo(() => distribuirOficinas(base, oficinas.map((o) => ({ clave: o.clave, items: o.figuras }))), [base, oficinas]);
  const sala = useMemo(() => ({ ...base, n: ext.n }), [base, ext.n]);
  const n = sala.n;
  // En pantallas angostas la sala se desliza de lado: se empieza viéndola por el centro, no por una esquina.
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => { const c = caja.current; if (c && c.scrollWidth > c.clientWidth) c.scrollLeft = (c.scrollWidth - c.clientWidth) / 2; }, [depto.clave, n]);
  const A = P(0, 0), B = P(n, 0), C = P(n, n), D = P(0, n);
  const sube = (p: { x: number; y: number }) => ({ x: p.x, y: p.y - PARED });
  const ancho = n * TW + MARGEN * 2, alto = n * TH + PARED + 40 + MARGEN;
  const ox = n * (TW / 2) + MARGEN, oy = PARED + MARGEN;
  const colocadas = ext.oficinas.map((c) => ({ c, of: oficinas.find((o) => o.clave === c.clave)! }));
  const orden = [...sala.puestos.map((p) => ({ item: p.item, u: p.u, v: p.v })), ...colocadas.flatMap(({ c }) => c.escritorios.filter((e) => e.item).map((e) => ({ item: e.item as FiguraOficina, u: e.u, v: e.v })))].sort((a, b) => a.u + a.v - (b.u + b.v));
  const ventana = (desde: number, hasta: number, lado: "i" | "d") => {
    const f = (t: number, z: number) => { const p = lado === "d" ? P(t, 0) : P(0, t); return { x: p.x, y: p.y - z }; };
    return <polygon points={pts(f(desde, 40), f(hasta, 40), f(hasta, 88), f(desde, 88))} style={{ fill: "var(--sl-ventana)", stroke: "var(--sl-borde)" }} />;
  };
  const activa = figuras.some((f) => f.estado === "trabajando");
  return (
    <div className="sl zen-glass flex flex-col rounded-3xl p-2" data-testid={`sala-${depto.clave}`} data-activa={activa ? "true" : "false"}>
      <style>{CSS}{CSS_SALA}</style>
      <p className="order-2 px-2 pt-1 text-[11px] text-muted-foreground sm:hidden">Plano de la sala (desliza para verlo completo). La lista de agentes está arriba.</p>
      <div ref={caja} className="order-3 overflow-x-auto sm:order-none">
      <svg viewBox={`0 0 ${ancho} ${alto}`} className="mx-auto w-full min-w-[620px] max-w-[980px]" role="group" aria-label={`Sala de ${depto.nombre}`} shapeRendering="geometricPrecision">
        <g transform={`translate(${ox},${oy})`}>
          <polygon points={pts(A, B, sube(B), sube(A))} style={{ fill: "var(--sl-pared-d)", stroke: "var(--sl-borde)" }} />
          <polygon points={pts(A, D, sube(D), sube(A))} style={{ fill: "var(--sl-pared-i)", stroke: "var(--sl-borde)" }} />
          <polygon points={pts(A, B, sube(B), sube(A))} fill={depto.tinte} opacity={0.18} />
          {ventana(n * 0.2, n * 0.4, "d")}{ventana(n * 0.6, n * 0.8, "d")}{ventana(n * 0.3, n * 0.5, "i")}{ventana(n * 0.65, n * 0.85, "i")}
          <polygon points={pts(D, C, { x: C.x, y: C.y + 10 }, { x: D.x, y: D.y + 10 })} fill={oscurecer(depto.tinte, 0.7)} opacity={0.55} />
          <polygon points={pts(B, C, { x: C.x, y: C.y + 10 }, { x: B.x, y: B.y + 10 })} fill={oscurecer(depto.tinte, 0.6)} opacity={0.55} />
          <polygon points={pts(A, B, C, D)} style={{ fill: "var(--sl-piso)", stroke: "var(--sl-borde)" }} />
          {Array.from({ length: n * n }, (_, k) => { const i = k % n, j = Math.floor(k / n); return (i + j) % 2 === 0 ? null : <polygon key={k} points={pts(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1))} style={{ fill: "var(--sl-piso2)" }} />; })}
          {sala.zonas.map((z) => {
            const u0 = Math.max(0.15, z.u0), v0 = Math.max(0.15, z.v0), u1 = Math.min(n - 0.15, z.u1), v1 = Math.min(n - 0.15, z.v1);
            return <polygon key={z.nombre} data-testid={`zona-${z.nombre}`} points={pts(P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1))} fill={depto.tinte} opacity={0.55} stroke={oscurecer(depto.tinte, 0.75)} strokeWidth={1.5} strokeDasharray="6 5" />;
          })}
          {colocadas.map(({ c, of }) => {
            const u0 = Math.max(0.15, c.u0), v0 = Math.max(0.15, c.v0), u1 = Math.min(n - 0.15, c.u1), v1 = Math.min(n - 0.15, c.v1);
            return (
              <g key={of.clave} data-testid={`oficina-${of.clave}`}>
                <polygon points={pts(P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1))} fill={of.tinte} opacity={0.9} stroke={oscurecer(of.tinte, 0.6)} strokeWidth={2} strokeDasharray="6 4" />
                {c.escritorios.filter((e) => !e.item).map((e, k) => { const p = P(e.u, e.v); return (
                  <g key={`libre-${k}`} transform={`translate(${p.x},${p.y + TH * 0.5})`} data-testid={`oficina-libre-${of.clave}`}>
                    <rect x={-44} y={-26} width={88} height={34} rx={17} fill="rgba(255,255,255,.55)" stroke={oscurecer(of.tinte, 0.5)} strokeWidth={1.5} strokeDasharray="5 4" />
                    <text x={0} y={-5} textAnchor="middle" fontSize={11.5} fontWeight={600} style={{ fill: "var(--sl-texto)" }}>Lugar libre</text>
                  </g>); })}
              </g>
            );
          })}
          {orden.map(({ item, u, v }) => { const p = P(u, v); return <Puesto key={item.id} f={item} x={p.x} y={p.y + TH * 0.5} onElegir={onElegir} elegido={item.id === elegidoId} texto={texto(item)} />; })}
          {/* Los letreros se dibujan al final para que ningún escritorio los tape. */}
          {colocadas.map(({ c, of }) => {
            const u1 = Math.min(n - 0.15, c.u1), v1 = Math.min(n - 0.15, c.v1);
            const etiquetaAgentes = `${textoAgentes(of.figuras.length)}${onAbrirOficina ? " · Entrar" : ""}`;
            const abrir = () => onAbrirOficina?.(of.clave), ancho = Math.max(150, of.nombre.length * 7.4 + 24);
            const cartel = { x: P(u1, v1).x - ancho / 2, y: P(u1, v1).y + 22 };   // al pie de la oficina (esquina frontal): ningún escritorio lo tapa
            return (
              <g key={`letrero-${of.clave}`}>
                {/* La posición va en un <g> aparte: index.css aplica transform a todo [role="button"]:active y borraría el translate. */}
                <g transform={`translate(${cartel.x},${cartel.y})`}>
                  <g role="button" tabIndex={onAbrirOficina ? 0 : -1} data-testid={`oficina-letrero-${of.clave}`} style={{ cursor: onAbrirOficina ? "pointer" : "default", transform: "none" }}
                    aria-label={`${of.nombre}: ${etiquetaAgentes}`} onClick={abrir} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } }}>
                    <rect x={0} y={-4} width={ancho} height={40} rx={14} style={{ fill: "var(--sl-etq)" }} stroke={oscurecer(of.tinte, 0.45)} strokeWidth={2} />
                    <text x={12} y={12} fontSize={12.5} fontWeight={700} style={{ fill: "var(--sl-texto)" }}>{of.nombre}</text>
                    <text x={12} y={28} fontSize={11} style={{ fill: "var(--sl-texto)", opacity: 0.85 }}>{etiquetaAgentes}</text>
                  </g>
                </g>
              </g>
            );
          })}
        </g>
      </svg>
      </div>
      {/* La lista repite lo que se ve en la sala: sirve con teclado y lector de pantalla, y en el celular, donde el dibujo se ve chico. */}
      <ul className="order-1 mb-2 grid gap-2 px-2 pb-2 sm:order-none sm:mb-0 sm:mt-2 sm:grid-cols-2" aria-label={`Zonas de ${depto.nombre}`} data-testid="sala-zonas">
        {sala.zonas.map((z) => (
          <li key={z.nombre} className="rounded-2xl border border-border/50 bg-background/40 p-2.5">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-foreground/75">{z.nombre}</p>
            <ul className="flex flex-wrap gap-1.5">
              {z.claves.map((c) => { const f = figuras.find((x) => x.clave === c)!; return (
                <li key={f.id} className="inline-flex items-center gap-1">
                  <button type="button" onClick={() => onElegir?.(f.id)} disabled={!onElegir} data-testid={`sala-lista-${f.id}`} className="min-h-11 rounded-full border border-border/60 px-3 py-1 text-xs enabled:hover:bg-background/70 sm:min-h-8 sm:px-2.5">
                    <span className="font-medium">{f.nombre}</span> <span className="text-foreground/70">· {texto(f)}</span>
                  </button>
                  {hrefPestana && <a href={hrefPestana(f.id)} target="_blank" rel="noopener noreferrer" data-testid={`sala-pestana-${f.id}`} className="hidden rounded-full px-2 py-1 text-xs underline sm:inline" aria-label={`Abrir a ${f.nombre} en pestaña nueva`}>Abrir en pestaña</a>}
                </li>); })}
            </ul>
          </li>
        ))}
        {oficinas.map((o) => (
          <li key={o.clave} className="rounded-2xl border p-2.5" style={{ borderColor: o.tinte, background: `${o.tinte}55` }} data-testid={`lista-oficina-${o.clave}`}>
            <p className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-foreground/75">
              <span>{o.nombre}</span><span className="font-normal normal-case text-foreground/70">· {textoAgentes(o.figuras.length)}</span>
              {onAbrirOficina && <button type="button" onClick={() => onAbrirOficina(o.clave)} data-testid={`lista-oficina-abrir-${o.clave}`} className="min-h-11 rounded-full border border-border/60 bg-background/70 px-3 py-1 text-xs normal-case sm:min-h-8 sm:px-2.5">Entrar a la oficina</button>}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {o.figuras.map((f) => (
                <li key={f.id} className="inline-flex items-center gap-1">
                  <button type="button" onClick={() => onElegir?.(f.id)} disabled={!onElegir} data-testid={`sala-lista-${f.id}`} className="min-h-11 rounded-full border border-border/60 bg-background/70 px-3 py-1 text-xs sm:min-h-8 sm:px-2.5">
                    <span className="font-medium">{f.nombre}</span> <span className="text-foreground/70">· {texto(f)}</span>
                  </button>
                  {hrefPestana && <a href={hrefPestana(f.id)} target="_blank" rel="noopener noreferrer" data-testid={`sala-pestana-${f.id}`} className="hidden rounded-full px-2 py-1 text-xs underline sm:inline" aria-label={`Abrir a ${f.nombre} en pestaña nueva`}>Abrir en pestaña</a>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
