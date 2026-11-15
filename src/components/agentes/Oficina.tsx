import { useMemo, useState } from "react";
import { cuandoRelativo } from "@/lib/agentes/registro";
import { spriteAgente, ANCHO, ALTO } from "@/lib/agentes/sprites";
import { CSS, TONO, pintar, PX, COLS, CW, CH } from "@/components/agentes/escritorio";
import { ESTADO_OFICINA, type EstadoOficina, type FiguraOficina } from "@/lib/agentes/oficina";

// Oficina propia (Zen + Glass): cada agente es una figura sencilla en su escritorio; su postura sale del estado real
// (ver src/lib/agentes/oficina.ts). Solo lectura. Movimiento lento; sin animación si el sistema pide menos movimiento.
// Todo estado también se dice con texto (etiqueta y tarjeta), nunca solo por color o movimiento.

function Figura({ f, x, y, activo, onElegir }: { f: FiguraOficina; x: number; y: number; activo: boolean; onElegir: () => void }) {
  const info = ESTADO_OFICINA[f.estado], c = TONO[info.color] ?? TONO.gris;
  const apagado = f.estado === "apagado";
  const sprite = spriteAgente(f.estado, f.id, c.cuerpo);
  return (
    // La posición va en un <g> aparte: index.css aplica transform a todo [role="button"]:active y, en un SVG, eso borraría el translate.
    <g transform={`translate(${x},${y})`}>
    <g className={`of-${f.estado}`} role="button" tabIndex={0} data-testid={`oficina-${f.id}`} data-estado={f.estado}
      aria-label={`${f.nombre}: ${info.etiqueta}`} aria-pressed={activo} style={{ cursor: "pointer", outline: "none", transform: "none" }}
      onClick={onElegir} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onElegir(); } }}>
      <rect className="of-celda" x={4} y={4} width={CW - 8} height={CH - 8} rx={22} style={{ fill: "var(--of-celda, rgba(255,255,255,.55))", pointerEvents: "all" }} stroke={activo ? "#8fb4d9" : "rgba(120,100,70,.18)"} strokeWidth={activo ? 2.5 : 1} />
      <g opacity={apagado ? 0.5 : 1} transform={`translate(${(CW - ANCHO * PX) / 2},${12})`} shapeRendering="crispEdges">
        {sprite.frames.map((fr, k) => (
          <g key={k} className={sprite.frames.length > 1 ? `of-frame of-frame-${k}` : undefined}>{pintar(fr)}</g>
        ))}
        <g className="of-emote">{pintar(sprite.emote)}</g>
      </g>
      <text x={CW / 2} y={136} textAnchor="middle" fontSize={13} fontWeight={600} style={{ fill: "var(--of-texto, #4a4033)" }}>{f.nombre.length > 22 ? f.nombre.slice(0, 21) + "…" : f.nombre}</text>
      {f.rol && <text x={CW / 2} y={152} textAnchor="middle" fontSize={10.5} data-testid={`oficina-rol-${f.id}`} style={{ fill: "var(--of-texto-suave, #7a6d58)" }}>{f.rol}</text>}
      <text x={CW / 2} y={170} textAnchor="middle" fontSize={11.5} fontWeight={500} style={{ fill: "var(--of-texto, #4a4033)" }}>{info.etiqueta}</text>
    </g>
    </g>
  );
}

// `detalleExtra`: lo que se muestra debajo de la tarjeta del agente elegido (la página lo usa para sus trabajos y conversaciones).
export function Oficina({ figuras, ahora, demo, detalleExtra, seleccionInicial = null }: { figuras: FiguraOficina[]; ahora: Date; demo: boolean; detalleExtra?: (f: FiguraOficina) => React.ReactNode; seleccionInicial?: string | null }) {
  const [elegido, setElegido] = useState<string | null>(seleccionInicial);
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
            {sel.descripcion && <p className="text-sm" data-testid="oficina-descripcion">{sel.descripcion}</p>}
            <p className="text-xs">Último latido {cuandoRelativo(sel.ultimoLatido, ahora)} · última tarea {cuandoRelativo(sel.ultimaTareaAt, ahora)} · {sel.tareasBien} bien, {sel.tareasMal} con error</p>
          </div>
        ) : <p className="text-muted-foreground">Elige un agente para ver qué está haciendo, sus trabajos, conversar con él y programar revisiones.</p>}
      </div>
      {sel && detalleExtra && <div data-testid="oficina-extra">{detalleExtra(sel)}</div>}
    </div>
  );
}
