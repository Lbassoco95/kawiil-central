import { useMemo, useRef, useState } from "react";
import { cuandoRelativo } from "@/lib/agentes/registro";
import { CSS, EscritorioAgente } from "@/components/agentes/escritorio";
import { ESTADO_OFICINA, type EstadoOficina, type FiguraOficina } from "@/lib/agentes/oficina";

// Oficina (Zen + Glass), con el mismo esquema de la oficina de Marketing: a un lado los agentes en su escritorio (compactos, para elegir) y al
// otro, FIJA en pantalla, la ficha del agente elegido con sus trabajos y su conversación. Antes la ficha y el chat se agregaban debajo de
// toda la rejilla (con 25 agentes quedaban muy abajo y había que bajar y subir para elegir y conversar).
// La postura de cada figura sale del estado real (src/lib/agentes/oficina.ts). Solo lectura. Movimiento lento; sin animación si el sistema
// pide menos movimiento. Todo estado también se dice con texto (etiqueta y ficha), nunca solo por color o movimiento.

function Tarjeta({ f, activo, onElegir }: { f: FiguraOficina; activo: boolean; onElegir: () => void }) {
  const info = ESTADO_OFICINA[f.estado];
  return (
    <button type="button" onClick={onElegir} aria-pressed={activo} aria-label={`${f.nombre}: ${info.etiqueta}`} data-testid={`oficina-${f.id}`} data-estado={f.estado}
      className={`flex w-full flex-col items-center gap-0.5 rounded-2xl border p-1.5 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/60 ${activo ? "border-primary/60 bg-primary/10 shadow-sm" : "border-border/50 bg-background/40 hover:bg-background/70"}`}>
      <EscritorioAgente f={f} compacto activo={activo} />
      {f.rol && <span className="line-clamp-1 text-[11px] text-muted-foreground" data-testid={`oficina-rol-${f.id}`}>{f.rol}</span>}
      <span className="text-xs font-medium">{info.etiqueta}</span>
    </button>
  );
}

// `detalleExtra`: lo que se muestra bajo la ficha del agente elegido (la página lo usa para sus trabajos y conversaciones).
export function Oficina({ figuras, ahora, demo, detalleExtra, seleccionInicial = null }: { figuras: FiguraOficina[]; ahora: Date; demo: boolean; detalleExtra?: (f: FiguraOficina) => React.ReactNode; seleccionInicial?: string | null }) {
  const [elegido, setElegido] = useState<string | null>(seleccionInicial);
  const panel = useRef<HTMLDivElement>(null);
  const sel = figuras.find((f) => f.id === elegido) ?? null;
  const conteo = useMemo(() => {
    const m = new Map<EstadoOficina, number>();
    figuras.forEach((f) => m.set(f.estado, (m.get(f.estado) ?? 0) + 1));
    return [...m.entries()];
  }, [figuras]);

  // En pantallas angostas la ficha queda debajo de los agentes: al elegir uno se lleva la vista hasta ella (en escritorio ya está al lado y fija).
  const elegir = (id: string) => {
    const nuevo = id === elegido ? null : id;
    setElegido(nuevo);
    if (nuevo && typeof window !== "undefined" && window.matchMedia?.("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => panel.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
    }
  };

  if (figuras.length === 0) return <p className="zen-glass rounded-2xl p-6 text-sm text-muted-foreground">No hay agentes en el registro para mostrar en la oficina.</p>;
  return (
    <div className="space-y-3" data-testid="oficina">
      <style>{CSS}</style>
      {demo && <p className="zen-glass rounded-2xl p-3 text-sm" data-testid="oficina-demo">Estás viendo una <strong>demostración con datos de ejemplo</strong>: no son agentes reales ni tareas reales.</p>}
      <ul className="flex flex-wrap gap-2 text-xs text-muted-foreground" aria-label="Resumen de estados">
        {conteo.map(([e, n]) => <li key={e} className="rounded-full border border-border/50 px-2.5 py-0.5">{ESTADO_OFICINA[e].etiqueta}: {n}</li>)}
      </ul>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
        <section aria-label="Elige un agente" className="zen-glass min-w-0 rounded-3xl p-3 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto" data-testid="oficina-agentes">
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.25rem,1fr))] gap-2">
            {figuras.map((f) => <li key={f.id}><Tarjeta f={f} activo={f.id === elegido} onElegir={() => elegir(f.id)} /></li>)}
          </ul>
        </section>
        <div ref={panel} className="min-w-0 scroll-mt-4 space-y-3 lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-y-auto lg:pr-1" data-testid="oficina-panel-lateral">
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
      </div>
    </div>
  );
}
