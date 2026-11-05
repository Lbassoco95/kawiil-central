import { useMemo, useState } from "react";
import { cuandoRelativo } from "@/lib/agentes/registro";
import { ESTADO_OFICINA, type EstadoOficina, type FiguraOficina } from "@/lib/agentes/oficina";

// Oficina propia (Zen + Glass): cada agente es una figura sencilla en su escritorio; su postura sale del estado real
// (ver src/lib/agentes/oficina.ts). Solo lectura. Movimiento lento; sin animación si el sistema pide menos movimiento.
// Todo estado también se dice con texto (etiqueta y tarjeta), nunca solo por color o movimiento.

const TONO: Record<string, { cuerpo: string; escritorio: string }> = {
  azul: { cuerpo: "#8fb4d9", escritorio: "#d9c7a8" }, verde: { cuerpo: "#9cc5a1", escritorio: "#d9c7a8" },
  rosa: { cuerpo: "#e3a9b0", escritorio: "#d9c7a8" }, salvia: { cuerpo: "#b5c9a8", escritorio: "#d9c7a8" },
  arena: { cuerpo: "#d8c3a0", escritorio: "#d9c7a8" }, gris: { cuerpo: "#bdb8b0", escritorio: "#cfc7b8" },
};
const COLS = 4, CW = 190, CH = 170;

const CSS = `
/* Solo la celda recibe clics: la figura se mueve y, si también los recibiera, el clic se perdería al cambiar el objeto bajo el cursor. */
[data-estado]>*:not(.of-celda){pointer-events:none}
.of-figura{transform-box:fill-box;transform-origin:center bottom}
.of-trabajando .of-brazos{animation:of-teclea 1.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.of-celebrando .of-figura{animation:of-salta 1.8s cubic-bezier(.22,1,.36,1) infinite}
.of-sentado .of-figura{animation:of-respira 4s ease-in-out infinite}
.of-atascado .of-figura,.of-con_error .of-figura{animation:of-balanceo 3s ease-in-out infinite}
@keyframes of-teclea{0%,100%{transform:translateY(0)}50%{transform:translateY(2px)}}
@keyframes of-salta{0%,100%{transform:translateY(0)}40%{transform:translateY(-8px)}}
@keyframes of-respira{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.025)}}
@keyframes of-balanceo{0%,100%{transform:rotate(-1.5deg)}50%{transform:rotate(1.5deg)}}
@media (prefers-reduced-motion: reduce){.of-figura,.of-brazos{animation:none!important}}
`;

function Figura({ f, x, y, activo, onElegir }: { f: FiguraOficina; x: number; y: number; activo: boolean; onElegir: () => void }) {
  const info = ESTADO_OFICINA[f.estado], c = TONO[info.color] ?? TONO.gris;
  const apagado = f.estado === "apagado", dormido = f.estado === "descansando";
  return (
    // La posición va en un <g> aparte: index.css aplica transform a todo [role="button"]:active y, en un SVG, eso borraría el translate.
    <g transform={`translate(${x},${y})`}>
    <g className={`of-${f.estado}`} role="button" tabIndex={0} data-testid={`oficina-${f.id}`} data-estado={f.estado}
      aria-label={`${f.nombre}: ${info.etiqueta}`} aria-pressed={activo} style={{ cursor: "pointer", outline: "none", transform: "none" }}
      onClick={onElegir} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onElegir(); } }}>
      <rect className="of-celda" x={4} y={4} width={CW - 8} height={CH - 8} rx={22} style={{ fill: "var(--of-celda, rgba(255,255,255,.55))", pointerEvents: "all" }} stroke={activo ? "#8fb4d9" : "rgba(120,100,70,.18)"} strokeWidth={activo ? 2.5 : 1} />
      <g opacity={apagado ? 0.45 : 1}>
        <g className="of-figura">
          <circle cx={CW / 2} cy={52} r={16} fill="#f1dcc2" />
          <rect x={CW / 2 - 17} y={68} width={34} height={36} rx={14} fill={c.cuerpo} />
          {dormido || apagado ? <path d={`M${CW / 2 - 8} 52 q4 3 8 0 M${CW / 2 + 1} 52 q4 3 8 0`} stroke="#6b5d4a" strokeWidth={1.5} fill="none" strokeLinecap="round" />
            : <><circle cx={CW / 2 - 5} cy={51} r={1.8} fill="#6b5d4a" /><circle cx={CW / 2 + 5} cy={51} r={1.8} fill="#6b5d4a" /></>}
          {f.estado === "celebrando" && <path d={`M${CW / 2 - 8} 58 q8 7 16 0`} stroke="#6b5d4a" strokeWidth={1.5} fill="none" strokeLinecap="round" />}
          <g className="of-brazos"><rect x={CW / 2 - 24} y={90} width={48} height={8} rx={4} fill={c.cuerpo} /></g>
        </g>
        <rect x={26} y={102} width={CW - 52} height={16} rx={8} fill={c.escritorio} />
        <rect x={CW / 2 - 16} y={90} width={32} height={12} rx={3} fill={f.estado === "trabajando" ? "#cfe3f5" : "#e8e0d2"} stroke="rgba(120,100,70,.3)" />
      </g>
      {(f.estado === "atascado" || f.estado === "con_error") && <circle cx={CW - 30} cy={28} r={7} fill="#e3a9b0" />}
      {f.estado === "celebrando" && <text x={CW - 36} y={34} fontSize={16} aria-hidden="true">✦</text>}
      {dormido && <text x={CW - 38} y={32} fontSize={13} fill="#8a7d68" aria-hidden="true">z z</text>}
      <text x={CW / 2} y={140} textAnchor="middle" fontSize={13} fontWeight={600} style={{ fill: "var(--of-texto, #4a4033)" }}>{f.nombre.length > 22 ? f.nombre.slice(0, 21) + "…" : f.nombre}</text>
      <text x={CW / 2} y={157} textAnchor="middle" fontSize={11.5} style={{ fill: "var(--of-texto-suave, #7a6d58)" }}>{info.etiqueta}</text>
    </g>
    </g>
  );
}

export function Oficina({ figuras, ahora, demo }: { figuras: FiguraOficina[]; ahora: Date; demo: boolean }) {
  const [elegido, setElegido] = useState<string | null>(null);
  const filas = Math.max(1, Math.ceil(figuras.length / COLS));
  const sel = figuras.find((f) => f.id === elegido) ?? null;
  const conteo = useMemo(() => {
    const m = new Map<EstadoOficina, number>();
    figuras.forEach((f) => m.set(f.estado, (m.get(f.estado) ?? 0) + 1));
    return [...m.entries()];
  }, [figuras]);

  if (figuras.length === 0) return <p className="zen-glass rounded-2xl p-6 text-sm text-muted-foreground">No hay agentes en el registro para mostrar en la oficina.</p>;
  return (
    <div className="space-y-4" data-testid="oficina">
      <style>{CSS}</style>
      {demo && <p className="zen-glass rounded-2xl p-3 text-sm" data-testid="oficina-demo">Estás viendo una <strong>demostración con datos de ejemplo</strong>: no son agentes reales ni tareas reales.</p>}
      <ul className="flex flex-wrap gap-2 text-xs text-muted-foreground" aria-label="Resumen de estados">
        {conteo.map(([e, n]) => <li key={e} className="rounded-full border border-border/50 px-2.5 py-0.5">{ESTADO_OFICINA[e].etiqueta}: {n}</li>)}
      </ul>
      <div className="zen-glass overflow-x-auto rounded-3xl p-3">
        <svg viewBox={`0 0 ${COLS * CW} ${filas * CH}`} className="mx-auto w-full min-w-[640px] max-w-5xl" role="group" aria-label="Oficina de agentes">
          {figuras.map((f, i) => (
            <Figura key={f.id} f={f} x={(i % COLS) * CW} y={Math.floor(i / COLS) * CH} activo={f.id === elegido} onElegir={() => setElegido(f.id === elegido ? null : f.id)} />
          ))}
        </svg>
      </div>
      <div className="zen-glass min-h-[5.5rem] rounded-2xl p-4 text-sm" aria-live="polite" data-testid="oficina-detalle">
        {sel ? (
          <div className="space-y-1">
            <p className="text-base font-medium">{sel.nombre} · {ESTADO_OFICINA[sel.estado].etiqueta}</p>
            <p className="text-muted-foreground">{ESTADO_OFICINA[sel.estado].frase}</p>
            {sel.descripcion && <p className="text-xs text-muted-foreground">{sel.descripcion}</p>}
            <p className="text-xs">Último latido {cuandoRelativo(sel.ultimoLatido, ahora)} · última tarea {cuandoRelativo(sel.ultimaTareaAt, ahora)} · {sel.tareasBien} bien, {sel.tareasMal} con error</p>
          </div>
        ) : <p className="text-muted-foreground">Elige un agente para ver qué está haciendo.</p>}
      </div>
    </div>
  );
}
