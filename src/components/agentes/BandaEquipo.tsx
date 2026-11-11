import { createContext, useContext } from "react";
import { EscritorioAgente, EstilosOficina } from "@/components/agentes/escritorio";
import { ESTADO_OFICINA, type FiguraOficina } from "@/lib/agentes/oficina";

// Los agentes en su escritorio, siempre a la vista en la página de Agentes: quien trabaja teclea (mismo dibujo y animación de la Oficina).
// Se lee del estado real; todo estado también se dice con texto. Un clic abre a ese agente en la Oficina.
export const FigurasContext = createContext<FiguraOficina[]>([]);
export const useFiguraDe = (agenteId: string | null | undefined): FiguraOficina | undefined => {
  const figuras = useContext(FigurasContext);
  return agenteId ? figuras.find((f) => f.id === agenteId) : undefined;
};

export function BandaEquipo({ figuras, onElegir }: { figuras: FiguraOficina[]; onElegir?: (id: string) => void }) {
  if (figuras.length === 0) return null;
  const trabajando = figuras.filter((f) => f.estado === "trabajando");
  return (
    <section className="zen-glass space-y-2 rounded-3xl p-3" aria-label="Tu equipo en su escritorio" data-testid="banda-equipo">
      <EstilosOficina />
      <p className="text-sm" role="status" data-testid="banda-resumen">
        <strong>Tu equipo en su escritorio</strong> · {trabajando.length > 0 ? `${trabajando.length} ${trabajando.length === 1 ? "trabajando ahora" : "trabajando ahora"}: ${trabajando.map((f) => f.nombre).join(", ")}` : "ninguno trabajando ahora"}
      </p>
      <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Agentes del equipo">
        {figuras.map((f) => (
          <li key={f.id} className="shrink-0" data-testid={`banda-${f.id}`} title={`${f.nombre}: ${ESTADO_OFICINA[f.estado].etiqueta}`}>
            <EscritorioAgente f={f} compacto onElegir={onElegir ? () => onElegir(f.id) : undefined} />
            <p className="text-center text-[11px] text-muted-foreground">{ESTADO_OFICINA[f.estado].etiqueta}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
