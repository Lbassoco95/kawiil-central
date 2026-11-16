import { useMemo } from "react";
import { Link } from "react-router-dom";
import { cuandoRelativo, type AgenteRegistro, type TareaAgente } from "@/lib/agentes/registro";
import { DIAS_CORTOS, DIAS_OBSERVADOS, enMexico, filasDeRutinas, resumenRutinas, ZONA, type Celda, type FilaRutina } from "@/lib/agentes/rutinas";

// Calendario de rutinas (Zen + Glass): una semana, lunes a domingo, con una fila por agente que corre solo. Junta lo programado en «Programar» y lo que
// de verdad corrió solo en los últimos 30 días (incluye a los agentes de Marketing). Hora de Ciudad de México. Solo lectura: no muestra títulos,
// instrucciones ni resultados de ninguna tarea. Todo estado también se dice con texto, no solo con color.

const TXT_PROX = new Intl.DateTimeFormat("es-MX", { timeZone: ZONA, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function textoCelda(c: Celda): string {
  if (c.corridas === 0) return `Programada a las ${c.hora}, aún sin corridas`;
  const base = `${c.hora}, ${c.corridas} ${c.corridas === 1 ? "corrida" : "corridas"} en 30 días`;
  return c.mal > 0 ? `${base}, ${c.mal} con error` : base;
}

function CeldaRutina({ c, hoy }: { c: Celda | null; hoy: boolean }) {
  const fondo = hoy ? "bg-primary/5" : "";
  if (!c) return <td className={`p-1 text-center align-middle ${fondo}`}><span className="text-muted-foreground/50" aria-label="Sin rutina ese día">·</span></td>;
  const clase = c.corridas === 0 ? "border-dashed border-amber-300/80 bg-amber-50/50 text-amber-900"
    : c.mal > 0 ? "border-rose-300/70 bg-rose-100/50 text-rose-900" : "border-emerald-300/70 bg-emerald-100/50 text-emerald-900";
  return (
    <td className={`p-1 text-center align-middle ${fondo}`}>
      <span className={`inline-flex min-w-[3.6rem] flex-col items-center rounded-xl border px-1.5 py-0.5 text-[11px] leading-tight ${clase}`} aria-label={textoCelda(c)} title={textoCelda(c)} data-testid="rutina-celda">
        <span className="font-medium">{c.hora}</span>
        <span>{c.corridas === 0 ? "programada" : c.mal > 0 ? `${c.bien}✓ ${c.mal}✗` : `${c.corridas}×`}</span>
      </span>
    </td>
  );
}

function Nombre({ f, onElegir }: { f: FilaRutina; onElegir?: (id: string) => void }) {
  if (f.marketing) return <Link to="/marketing" className="font-medium underline-offset-2 hover:underline" data-testid={`rutina-nombre-${f.agenteId}`}>{f.nombre}</Link>;
  return <button type="button" onClick={() => onElegir?.(f.agenteId)} disabled={!onElegir} className="text-left font-medium underline-offset-2 enabled:hover:underline" data-testid={`rutina-nombre-${f.agenteId}`}>{f.nombre}</button>;
}

function Detalle({ f, ahora }: { f: FilaRutina; ahora: Date }) {
  const partes: string[] = [];
  if (f.programada === "activa" && f.proxima) partes.push(`Próxima: ${TXT_PROX.format(f.proxima)}`);
  if (f.programada === "pausada") partes.push(`Pausada: ${f.pausadaMotivo}`);
  if (f.corridas30 > 0) partes.push(`última ${cuandoRelativo(f.ultimaCorrida, ahora)}${f.ultimaFalla ? " (con error)" : ""}`);
  const etiqueta = f.fuente === "programada" ? "Programada" : f.fuente === "observada" ? "Corre sola" : "Programada y observada";
  return <span className="block text-[11px] text-muted-foreground">{etiqueta}{partes.length ? ` · ${partes.join(" · ")}` : ""}{f.marketing ? " · Marketing" : ""}</span>;
}

export function CalendarioRutinas({ agentes, tareas, ahora, onElegir, onProgramar }: {
  agentes: AgenteRegistro[]; tareas: TareaAgente[]; ahora: Date; onElegir?: (id: string) => void; onProgramar?: () => void;
}) {
  const filas = useMemo(() => filasDeRutinas(agentes, tareas, ahora), [agentes, tareas, ahora]);
  const r = useMemo(() => resumenRutinas(filas), [filas]);
  const hoy = enMexico(ahora).dia;

  return (
    <div className="space-y-3" data-testid="rutinas">
      <ul className="flex flex-wrap gap-2 text-xs text-muted-foreground" aria-label="Resumen de rutinas">
        <li className="rounded-full border border-border/50 px-2.5 py-0.5" data-testid="rutinas-programadas">Programadas activas: {r.programadas}</li>
        {r.pausadas > 0 && <li className="rounded-full border border-border/50 px-2.5 py-0.5">Pausadas: {r.pausadas}</li>}
        <li className="rounded-full border border-border/50 px-2.5 py-0.5" data-testid="rutinas-observadas">Agentes con corridas solas: {r.conCorridas}</li>
        <li className="rounded-full border border-border/50 px-2.5 py-0.5">Corridas en {DIAS_OBSERVADOS} días: {r.corridas}{r.fallas > 0 ? ` (${r.fallas} con error)` : ""}</li>
      </ul>

      {filas.length === 0 ? (
        <div className="zen-glass space-y-2 rounded-3xl p-5 text-sm" data-testid="rutinas-vacio">
          <p>Ningún agente tiene rutinas programadas ni corridas automáticas en los últimos {DIAS_OBSERVADOS} días.</p>
          {onProgramar && <button type="button" className="underline" onClick={onProgramar} data-testid="rutinas-ir-programar">Programar una rutina</button>}
        </div>
      ) : (
        <div className="zen-glass min-w-0 overflow-x-auto rounded-3xl p-3">
          <table className="w-full min-w-[40rem] border-separate border-spacing-y-1 text-sm" data-testid="rutinas-tabla">
            <caption className="sr-only">Rutinas de los agentes por día de la semana, hora de Ciudad de México</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="px-2 py-1 text-left font-normal">Agente</th>
                {DIAS_CORTOS.map((d, i) => <th key={d} scope="col" className={`px-1 py-1 text-center font-normal ${i === hoy ? "rounded-t-xl bg-primary/5 font-medium text-foreground" : ""}`} aria-current={i === hoy ? "date" : undefined}>{d}{i === hoy ? " · hoy" : ""}</th>)}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.agenteId} data-testid={`rutina-${f.agenteId}`}>
                  <th scope="row" className="min-w-[11rem] px-2 py-1 text-left font-normal"><Nombre f={f} onElegir={onElegir} /><Detalle f={f} ahora={ahora} /></th>
                  {f.celdas.map((c, i) => <CeldaRutina key={i} c={c} hoy={i === hoy} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="rutinas-leyenda">
        <span><span className="text-emerald-700">●</span> corrió sola sin error</span>
        <span><span className="text-rose-700">●</span> hubo corridas con error</span>
        <span><span className="text-amber-700">◌</span> programada, aún sin corridas</span>
        <span>Hora de Ciudad de México · «3×» = corridas de ese día de la semana en {DIAS_OBSERVADOS} días</span>
      </p>
    </div>
  );
}
