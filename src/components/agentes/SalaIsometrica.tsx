import { useMemo } from "react";
import { spriteAgente, ANCHO, ALTO, oscurecer } from "@/lib/agentes/sprites";
import { ESTADO_OFICINA, type FiguraOficina } from "@/lib/agentes/oficina";
import { distribuirSala } from "@/lib/agentes/salas";
import { CSS, TONO, pintarAccesorios } from "@/components/agentes/escritorio";
import type { Departamento } from "@/lib/agentes/departamentos";

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

// `etiqueta`: texto del estado si no es el de la oficina (Marketing usa el suyo). `elegidoId`: agente con el aro fijo.
export function SalaIsometrica({ depto, figuras, onElegir, elegidoId, etiqueta }: { depto: Departamento; figuras: FiguraOficina[]; onElegir?: (id: string) => void; elegidoId?: string | null; etiqueta?: (f: FiguraOficina) => string }) {
  const texto = (f: FiguraOficina) => etiqueta?.(f) || ESTADO_OFICINA[f.estado].etiqueta;
  const sala = useMemo(() => distribuirSala(depto.clave, figuras, (f) => f.clave), [depto.clave, figuras]);
  const n = sala.n;
  const A = P(0, 0), B = P(n, 0), C = P(n, n), D = P(0, n);
  const sube = (p: { x: number; y: number }) => ({ x: p.x, y: p.y - PARED });
  const ancho = n * TW + MARGEN * 2, alto = n * TH + PARED + 40 + MARGEN;
  const ox = n * (TW / 2) + MARGEN, oy = PARED + MARGEN;
  const orden = [...sala.puestos].sort((a, b) => a.u + a.v - (b.u + b.v));
  const ventana = (desde: number, hasta: number, lado: "i" | "d") => {
    const f = (t: number, z: number) => { const p = lado === "d" ? P(t, 0) : P(0, t); return { x: p.x, y: p.y - z }; };
    return <polygon points={pts(f(desde, 40), f(hasta, 40), f(hasta, 88), f(desde, 88))} style={{ fill: "var(--sl-ventana)", stroke: "var(--sl-borde)" }} />;
  };
  const activa = figuras.some((f) => f.estado === "trabajando");
  return (
    <div className="sl zen-glass overflow-x-auto rounded-3xl p-2" data-testid={`sala-${depto.clave}`} data-activa={activa ? "true" : "false"}>
      <style>{CSS}{CSS_SALA}</style>
      <p className="px-2 pt-1 text-[11px] text-muted-foreground sm:hidden">Desliza para ver toda la sala; abajo está la lista de agentes.</p>
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
          {orden.map(({ item, u, v }) => { const p = P(u, v); return <Puesto key={item.id} f={item} x={p.x} y={p.y + TH * 0.5} onElegir={onElegir} elegido={item.id === elegidoId} texto={texto(item)} />; })}
        </g>
      </svg>
      {/* La lista repite lo que se ve en la sala: sirve con teclado y lector de pantalla, y en el celular, donde el dibujo se ve chico. */}
      <ul className="mt-2 grid gap-2 px-2 pb-2 sm:grid-cols-2" aria-label={`Zonas de ${depto.nombre}`} data-testid="sala-zonas">
        {sala.zonas.map((z) => (
          <li key={z.nombre} className="rounded-2xl border border-border/50 bg-background/40 p-2.5">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{z.nombre}</p>
            <ul className="flex flex-wrap gap-1.5">
              {z.claves.map((c) => { const f = figuras.find((x) => x.clave === c)!; return (
                <li key={f.id}>
                  <button type="button" onClick={() => onElegir?.(f.id)} disabled={!onElegir} data-testid={`sala-lista-${f.id}`} className="rounded-full border border-border/60 px-2.5 py-1 text-xs enabled:hover:bg-background/70">
                    <span className="font-medium">{f.nombre}</span> <span className="text-muted-foreground">· {texto(f)}</span>
                  </button>
                </li>); })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
