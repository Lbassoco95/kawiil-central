import { useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import { PlanoDepartamentos } from "@/components/agentes/PlanoDepartamentos";
import { FranjaEnVivo } from "@/components/agentes/FranjaEnVivo";
import { SalaIsometrica } from "@/components/agentes/SalaIsometrica";
import { agruparPorDepartamento } from "@/lib/agentes/departamentos";
import { VISTA_PLANO, type Vista } from "@/lib/agentes/vistas";
import type { FiguraOficina } from "@/lib/agentes/oficina";
import type { AgenteRegistro, TareaAgente } from "@/lib/agentes/registro";

// Oficina: plano de islas → isla → agente. La vista actual la decide quien la usa (la página la guarda en la URL).
// Sobre cualquier vista va la franja «Equipo en vivo». Una isla abierta es su sala isométrica; los agentes de Marketing abren su módulo (su sala es la misma).
export function VistaOficina({ figuras, agentes, tareas, ahora, vista, onVista, onElegirAgente, alAbrirMarketing }: {
  figuras: FiguraOficina[]; agentes: AgenteRegistro[]; tareas: TareaAgente[]; ahora: Date; vista: Vista; onVista: (v: Vista) => void;
  onElegirAgente: (id: string) => void; alAbrirMarketing?: () => void;
}) {
  const grupos = useMemo(() => agruparPorDepartamento(figuras, agentes), [figuras, agentes]);
  const deptoDe = useMemo(() => new Map(grupos.flatMap((g) => g.figuras.map((f) => [f.id, g.depto.nombre] as const))), [grupos]);
  const isla = vista.tipo === "isla" ? grupos.find((g) => g.depto.clave === vista.clave) : undefined;
  return (
    <div className="space-y-3" data-testid="vista-oficina" data-vista={vista.tipo === "isla" ? `isla:${vista.clave}` : "plano"}>
      <FranjaEnVivo figuras={figuras} departamentoDe={(id) => deptoDe.get(id) ?? "Otros"} onElegir={onElegirAgente} />
      {vista.tipo === "isla" && (
        <nav aria-label="Dónde estás" className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" onClick={() => onVista(VISTA_PLANO)} data-testid="volver-plano" className="inline-flex items-center gap-1 rounded-full border border-border/60 px-3 py-1 text-xs">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />Todos los departamentos
          </button>
          <span aria-current="page" className="font-medium" data-testid="isla-titulo">{isla?.depto.nombre ?? "Departamento sin agentes"}</span>
        </nav>
      )}
      {vista.tipo === "isla" ? (
        isla ? (
          <SalaIsometrica depto={isla.depto} figuras={isla.figuras} onElegir={(id) => (isla.depto.clave === "marketing" && alAbrirMarketing ? alAbrirMarketing() : onElegirAgente(id))} />
        ) : <p className="zen-glass rounded-2xl p-4 text-sm text-muted-foreground" data-testid="isla-vacia">Este departamento no tiene agentes en el registro.</p>
      ) : (
        <PlanoDepartamentos figuras={figuras} agentes={agentes} tareas={tareas} ahora={ahora} alAbrirMarketing={alAbrirMarketing} onElegir={onElegirAgente}
          onAbrirIsla={(clave) => onVista({ tipo: "isla", clave })} />
      )}
    </div>
  );
}
