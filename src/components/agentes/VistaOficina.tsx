import { useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import { PlanoDepartamentos } from "@/components/agentes/PlanoDepartamentos";
import { FranjaEnVivo } from "@/components/agentes/FranjaEnVivo";
import { SalaIsometrica } from "@/components/agentes/SalaIsometrica";
import { PanelAgente } from "@/components/agentes/PanelAgente";
import { OficinaEquipo } from "@/components/agentes/OficinaEquipo";
import { idsEnOficinas } from "@/lib/agentes/equipos";
import { urlChat } from "@/lib/agentes/chat";
import type { OficinaEnSala } from "@/components/agentes/SalaIsometrica";
import { agruparPorDepartamento } from "@/lib/agentes/departamentos";
import { nombreAgente } from "@/lib/agentes/registro";
import { actividadDe, agentesQueEsperan } from "@/lib/agentes/actividad";
import { VISTA_PLANO, type PestanaEscritorio, type Vista } from "@/lib/agentes/vistas";
import type { FiguraOficina } from "@/lib/agentes/oficina";
import type { AgenteRegistro, TareaAgente } from "@/lib/agentes/registro";

// Oficina: plano de islas → sala de la isla → escritorio del agente (panel a la derecha). La vista actual la decide quien la usa (la página la guarda en la URL).
// Sobre cualquier vista va la franja «Equipo en vivo». Los agentes de Marketing abren su módulo, salvo «Comunicación interna», cuyo escritorio vive aquí.
const ABRE_AQUI = new Set(["marketing_comunicacion_interna"]);
export function VistaOficina({ figuras, agentes, tareas, ahora, vista, onVista, onElegirAgente, alAbrirMarketing, pestana = "conversaciones", onPestana }: {
  figuras: FiguraOficina[]; agentes: AgenteRegistro[]; tareas: TareaAgente[]; ahora: Date; vista: Vista; onVista: (v: Vista) => void;
  onElegirAgente: (id: string) => void; alAbrirMarketing?: () => void; pestana?: PestanaEscritorio; onPestana?: (p: PestanaEscritorio) => void;
}) {
  const grupos = useMemo(() => agruparPorDepartamento(figuras, agentes), [figuras, agentes]);
  const deptoDe = useMemo(() => new Map(grupos.flatMap((g) => g.figuras.map((f) => [f.id, g.depto.nombre] as const))), [grupos]);
  const esperan = useMemo(() => agentesQueEsperan(tareas), [tareas]);
  const archivados = useMemo(() => agentes.filter((a) => a.status === "archived").sort((x, y) => nombreAgente(x).localeCompare(nombreAgente(y), "es")), [agentes]);
  const figuraAgente = vista.tipo === "agente" ? figuras.find((f) => f.id === vista.id) : undefined;
  const agenteSel = vista.tipo === "agente" ? agentes.find((a) => a.id === vista.id) : undefined;
  const isla = vista.tipo === "isla" ? grupos.find((g) => g.depto.clave === vista.clave) : vista.tipo === "agente" ? grupos.find((g) => g.figuras.some((f) => f.id === vista.id))
    : vista.tipo === "oficina" ? grupos.find((g) => g.oficinas.some((o) => o.jefeId === vista.id)) : undefined;
  const oficinaSel = vista.tipo === "oficina" ? isla?.oficinas.find((o) => o.jefeId === vista.id) : undefined;
  // Sala de la isla: el equipo principal (sin los agentes de las oficinas) + las oficinas de equipo dibujadas dentro (R1.b). Marketing abre su módulo, así que no lleva «Abrir en pestaña».
  const propsSala = (g: NonNullable<typeof isla>) => {
    const enOficina = idsEnOficinas(g.oficinas);
    const oficinasSala: OficinaEnSala[] = g.oficinas.map((o) => ({ clave: o.jefeId, nombre: o.nombre, tinte: o.tinte, figuras: o.miembros.map((m) => g.figuras.find((f) => f.id === m.agente.id)).filter((f): f is typeof g.figuras[number] => !!f) }));
    return { figuras: g.figuras.filter((f) => !enOficina.has(f.id)), oficinas: oficinasSala, onAbrirOficina: (clave: string) => onVista({ tipo: "oficina", id: clave }), hrefPestana: g.depto.clave === "marketing" ? undefined : (id: string) => urlChat(id) };
  };
  // Un agente de Marketing abre su módulo; el resto abre su escritorio.
  const alElegir = (id: string) => {
    const f = figuras.find((x) => x.id === id);
    if (f && isla?.depto.clave === "marketing" && !ABRE_AQUI.has(f.clave) && alAbrirMarketing) alAbrirMarketing(); else onElegirAgente(id);
  };
  const migas = vista.tipo !== "plano" && (
    <nav aria-label="Dónde estás" className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" onClick={() => onVista(VISTA_PLANO)} data-testid="volver-plano" className="inline-flex items-center gap-1 rounded-full border border-border/60 px-3 py-1 text-xs">
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />Todos los departamentos
      </button>
      {vista.tipo === "oficina" && isla && oficinaSel ? (
        <>
          <button type="button" onClick={() => onVista({ tipo: "isla", clave: isla.depto.clave })} data-testid="volver-isla" className="rounded-full border border-border/60 px-3 py-1 text-xs">{isla.depto.nombre}</button>
          <span aria-current="page" className="font-medium" data-testid="oficina-titulo">{oficinaSel.nombre}</span>
        </>
      ) : vista.tipo === "agente" && isla ? (
        <>
          <button type="button" onClick={() => onVista({ tipo: "isla", clave: isla.depto.clave })} data-testid="volver-isla" className="rounded-full border border-border/60 px-3 py-1 text-xs">{isla.depto.nombre}</button>
          <span aria-current="page" className="font-medium" data-testid="agente-titulo">{figuraAgente?.nombre ?? "Agente"}</span>
        </>
      ) : <span aria-current="page" className="font-medium" data-testid="isla-titulo">{isla?.depto.nombre ?? "Departamento sin agentes"}</span>}
    </nav>
  );
  return (
    <div className="space-y-3" data-testid="vista-oficina" data-vista={vista.tipo === "plano" ? "plano" : vista.tipo === "isla" ? `isla:${vista.clave}` : vista.tipo === "oficina" ? `oficina:${vista.id}` : `agente:${vista.id}`}>
      <FranjaEnVivo figuras={figuras} departamentoDe={(id) => deptoDe.get(id) ?? "Otros"} onElegir={alElegir} esperan={esperan} actividad={(f) => actividadDe(f.id, f.estado, tareas)} />
      {migas}
      {vista.tipo === "plano" && (
        <p className="px-1 text-sm text-muted-foreground" data-testid="resumen-agentes">
          {figuras.length} {figuras.length === 1 ? "agente" : "agentes"} en {grupos.length} {grupos.length === 1 ? "isla" : "islas"}
          {archivados.length > 0 && ` · ${archivados.length} ${archivados.length === 1 ? "archivado" : "archivados"} (abajo)`}
        </p>
      )}
      {vista.tipo === "plano" ? (
        <PlanoDepartamentos figuras={figuras} agentes={agentes} tareas={tareas} ahora={ahora} alAbrirMarketing={alAbrirMarketing} onElegir={onElegirAgente}
          onAbrirIsla={(clave) => onVista({ tipo: "isla", clave })} />
      ) : !isla || (vista.tipo === "oficina" && !oficinaSel) ? (
        <p className="zen-glass rounded-2xl p-4 text-sm text-muted-foreground" data-testid={vista.tipo === "agente" ? "agente-no-existe" : vista.tipo === "oficina" ? "oficina-no-existe" : "isla-vacia"}>
          {vista.tipo === "agente" ? "No encontramos a ese agente en el registro." : vista.tipo === "oficina" ? "No encontramos esa oficina: aún no tiene agentes creados por su jefe." : "Este departamento no tiene agentes en el registro."}
        </p>
      ) : vista.tipo === "oficina" && oficinaSel ? (
        <OficinaEquipo oficina={oficinaSel} jefe={agentes.find((a) => a.id === oficinaSel.jefeId)!} agentes={agentes} figuras={figuras} tareas={tareas} ahora={ahora} nombreSala={isla.depto.nombre}
          onVolverSala={() => onVista({ tipo: "isla", clave: isla.depto.clave })} />
      ) : vista.tipo === "isla" ? (
        <SalaIsometrica depto={isla.depto} onElegir={alElegir} {...propsSala(isla)} />
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] xl:items-start">
          <SalaIsometrica depto={isla.depto} onElegir={alElegir} {...propsSala(isla)} />
          {figuraAgente && agenteSel
            ? <div className="min-w-0 xl:sticky xl:top-3 xl:max-h-[calc(100vh-1.5rem)] xl:overflow-y-auto"><PanelAgente figura={figuraAgente} agente={agenteSel} agentes={agentes} tareas={tareas} ahora={ahora} pestana={pestana} onPestana={(p) => onPestana?.(p)} onVolver={() => onVista({ tipo: "isla", clave: isla.depto.clave })} /></div>
            : <p className="zen-glass rounded-2xl p-4 text-sm text-muted-foreground" data-testid="agente-no-existe">No encontramos a ese agente en el registro.</p>}
        </div>
      )}
      {vista.tipo === "plano" && (
        <details className="zen-glass rounded-2xl p-3 text-sm" data-testid="archivados">
          <summary className="cursor-pointer font-medium">Agentes archivados ({archivados.length})</summary>
          {archivados.length === 0 ? <p className="mt-2 text-muted-foreground">No hay agentes archivados.</p> : (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Agentes archivados">
              {archivados.map((a) => <li key={a.id} className="rounded-full border border-border/60 px-2.5 py-1 text-xs" data-testid={`archivado-${a.id}`}>{nombreAgente(a)} <span className="text-foreground/70">· archivado</span></li>)}
            </ul>
          )}
          <p className="mt-2 text-xs text-foreground/70">Los archivados no tienen sala. Un agente de la VM aparece aquí solo cuando se registra: lo hace solo al arrancar la VM. Si falta alguno, aún no se ha registrado.</p>
        </details>
      )}
    </div>
  );
}
