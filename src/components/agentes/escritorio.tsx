import { spriteAgente, ANCHO, type Rect } from "@/lib/agentes/sprites";
import { ESTADO_OFICINA, type FiguraOficina } from "@/lib/agentes/oficina";

// Piezas compartidas de la oficina: estilos, colores y un escritorio suelto (un agente en su escritorio) que se usa en la banda del equipo
// y en la conversación de Seguimiento. El dibujo y la animación son los mismos de la Oficina: la postura sale del estado real.

export const TONO: Record<string, { cuerpo: string; escritorio: string }> = {
  azul: { cuerpo: "#8fb4d9", escritorio: "#d9c7a8" }, verde: { cuerpo: "#9cc5a1", escritorio: "#d9c7a8" },
  rosa: { cuerpo: "#e3a9b0", escritorio: "#d9c7a8" }, salvia: { cuerpo: "#b5c9a8", escritorio: "#d9c7a8" },
  arena: { cuerpo: "#d8c3a0", escritorio: "#d9c7a8" }, gris: { cuerpo: "#bdb8b0", escritorio: "#cfc7b8" },
};
export const COLS = 4, CW = 190, CH = 188, PX = 5;
export const pintar = (rs: Rect[]) => rs.map((r, i) => <rect key={i} x={r.x * PX} y={r.y * PX} width={r.w * PX} height={r.h * PX} fill={r.c} />);

export const CSS = `
/* Solo la celda recibe clics: la figura se mueve y, si también los recibiera, el clic se perdería al cambiar el objeto bajo el cursor. */
[data-estado]>*:not(.of-celda){pointer-events:none}
/* Pixel art: cada cuadro se alterna con saltos (sin transiciones suaves) y lento, a tono con Zen. */
.of-frame-1{opacity:0}
.of-trabajando .of-frame-0{animation:of-a 0.8s steps(1,end) infinite}
.of-trabajando .of-frame-1{animation:of-b 0.8s steps(1,end) infinite}
.of-celebrando .of-frame-0{animation:of-a 1.2s steps(1,end) infinite}
.of-celebrando .of-frame-1{animation:of-b 1.2s steps(1,end) infinite}
.of-sentado .of-frame-1{animation:of-parpadeo 4s steps(1,end) infinite}
.of-sentado .of-frame-0{animation:of-parpadeo-inv 4s steps(1,end) infinite}
.of-atascado .of-emote,.of-con_error .of-emote{animation:of-pulso 2.4s ease-in-out infinite}
.of-descansando .of-emote{animation:of-pulso 3.2s ease-in-out infinite}
@keyframes of-a{0%{opacity:1}50%{opacity:0}}
@keyframes of-b{0%{opacity:0}50%{opacity:1}}
@keyframes of-parpadeo{0%,90%{opacity:0}95%,100%{opacity:1}}
@keyframes of-parpadeo-inv{0%,90%{opacity:1}95%,100%{opacity:0}}
@keyframes of-pulso{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion: reduce){.of-frame-0,.of-frame-1,.of-emote{animation:none!important}.of-frame-0{opacity:1!important}.of-frame-1{opacity:0!important}}
`;


export function EstilosOficina() { return <style>{CSS}</style>; }

// Un agente en su escritorio. `compacto` lo hace de unos 110 px de ancho para tiras y encabezados. Es solo lectura; si se pasa `onElegir` es un botón.
export function EscritorioAgente({ f, compacto = false, onElegir, activo = false }: { f: FiguraOficina; compacto?: boolean; onElegir?: () => void; activo?: boolean }) {
  const info = ESTADO_OFICINA[f.estado], c = TONO[info.color] ?? TONO.gris;
  const apagado = f.estado === "apagado";
  const sprite = spriteAgente(f.estado, f.id, c.cuerpo);
  const alto = compacto ? 150 : CH;
  const contenido = (
    <svg viewBox={`0 0 ${CW} ${alto}`} className={compacto ? "h-[100px] w-[127px] shrink-0" : "w-full max-w-[190px]"} role="img" aria-label={`${f.nombre}: ${info.etiqueta}`} data-testid={`escritorio-${f.id}`} data-estado={f.estado}>
      <g className={`of-${f.estado}`}>
        <rect x={4} y={4} width={CW - 8} height={alto - 8} rx={22} style={{ fill: "var(--of-celda, rgba(255,255,255,.55))" }} stroke={activo ? "#8fb4d9" : "rgba(120,100,70,.18)"} strokeWidth={activo ? 2.5 : 1} />
        <g opacity={apagado ? 0.5 : 1} transform={`translate(${(CW - ANCHO * PX) / 2},${12})`} shapeRendering="crispEdges">
          {sprite.frames.map((fr, k) => <g key={k} className={sprite.frames.length > 1 ? `of-frame of-frame-${k}` : undefined}>{pintar(fr)}</g>)}
          <g className="of-emote">{pintar(sprite.emote)}</g>
        </g>
        <text x={CW / 2} y={compacto ? 130 : 136} textAnchor="middle" fontSize={compacto ? 15 : 13} fontWeight={600} style={{ fill: "var(--of-texto, #4a4033)" }}>{f.nombre.length > 20 ? f.nombre.slice(0, 19) + "…" : f.nombre}</text>
        {!compacto && <text x={CW / 2} y={170} textAnchor="middle" fontSize={11.5} fontWeight={500} style={{ fill: "var(--of-texto, #4a4033)" }}>{info.etiqueta}</text>}
      </g>
    </svg>
  );
  return onElegir
    ? <button type="button" onClick={onElegir} aria-pressed={activo} className="rounded-2xl text-left" data-testid={`escritorio-boton-${f.id}`}>{contenido}</button>
    : contenido;
}
