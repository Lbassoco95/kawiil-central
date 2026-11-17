import { EscritorioAgente, EstilosOficina } from "@/components/agentes/escritorio";
import { ESTADO_OFICINA, type FiguraOficina } from "@/lib/agentes/oficina";

// «Equipo en vivo»: quién trabaja ahora (de cualquier isla) y quién necesita atención, siempre arriba del plano. Solo agente, estado y departamento: sin textos de tareas.
const ATENCION = new Set(["atascado", "con_error"]);
export function FranjaEnVivo({ figuras, departamentoDe, onElegir, esperan, actividad }: { figuras: FiguraOficina[]; departamentoDe: (id: string) => string; onElegir?: (id: string) => void; esperan?: ReadonlySet<string>; actividad?: (f: FiguraOficina) => string }) {
  const trabajando = figuras.filter((f) => f.estado === "trabajando");
  const atencion = figuras.filter((f) => ATENCION.has(f.estado));
  const esperando = figuras.filter((f) => esperan?.has(f.id) && f.estado !== "trabajando" && !ATENCION.has(f.estado));
  const lista = [...trabajando, ...esperando, ...atencion].slice(0, 12);
  return (
    <section className="zen-glass space-y-2 rounded-3xl p-3" aria-label="Equipo en vivo" data-testid="franja-vivo">
      <EstilosOficina />
      <p className="text-sm" role="status" data-testid="franja-resumen">
        <strong>Equipo en vivo</strong> · {trabajando.length === 0 ? "nadie trabaja ahora" : `${trabajando.length} ${trabajando.length === 1 ? "trabajando" : "trabajando"} ahora`}
        {(esperan?.size ?? 0) > 0 && <span data-testid="franja-esperan"> · {esperan!.size} {esperan!.size === 1 ? "te espera" : "te esperan"}</span>}
        {atencion.length > 0 && ` · ${atencion.length} ${atencion.length === 1 ? "necesita atención" : "necesitan atención"}`}
      </p>
      {lista.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Agentes en vivo">
          {lista.map((f) => (
            <li key={f.id} className="shrink-0 text-center" data-testid={`franja-${f.id}`}>
              <EscritorioAgente f={f} compacto onElegir={onElegir ? () => onElegir(f.id) : undefined} />
              <p className="max-w-[140px] text-[11px] text-muted-foreground">{actividad ? actividad(f) : ESTADO_OFICINA[f.estado].etiqueta}{esperan?.has(f.id) && " · te espera"}<br />{departamentoDe(f.id)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
