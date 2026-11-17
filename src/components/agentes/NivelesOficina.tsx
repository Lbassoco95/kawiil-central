import { useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import { PlanoDepartamentos } from "@/components/agentes/PlanoDepartamentos";
import { SalaIsometrica } from "@/components/agentes/SalaIsometrica";
import { EscritorioAgente, EstilosOficina } from "@/components/agentes/escritorio";
import { agruparPorDepartamento } from "@/lib/agentes/departamentos";
import { VISTA_PLANO, type Vista } from "@/lib/agentes/vistas";
import {
  NIVELES_OFICINA, catalogoDeNivel, comoAgenteRegistro, comoFigura, nombreDepto, zonaPorId, type AgenteCatalogo, type NivelOficina,
} from "@/lib/agentes/louis";

// Niveles de la oficina. «Kawiil» es la oficina de siempre (agentes del registro); «Louis» e «Internacional» muestran el CATÁLOGO de los agentes de OpenClaw,
// que no están en el registro: se ven (sin señal) pero no reciben tareas desde Kawiil Central. Nada de esto lee ni escribe en la base.
export function SelectorNivel({ nivel, onNivel }: { nivel: NivelOficina; onNivel: (n: NivelOficina) => void }) {
  return (
    <div className="space-y-1.5" data-testid="selector-nivel">
      <div role="group" aria-label="Nivel de la oficina" className="inline-flex flex-wrap gap-1 rounded-full border border-border/60 p-1 text-sm">
        {NIVELES_OFICINA.map((n) => (
          <button key={n.v} type="button" aria-pressed={nivel === n.v} onClick={() => onNivel(n.v)} data-testid={`nivel-${n.v}`}
            className={`rounded-full px-3.5 py-1 ${nivel === n.v ? "bg-primary/10 font-medium text-foreground" : "text-foreground/75"}`}>{n.t}</button>
        ))}
      </div>
      <p className="px-1 text-xs text-foreground/70" data-testid="nivel-detalle">{NIVELES_OFICINA.find((n) => n.v === nivel)?.detalle}</p>
    </div>
  );
}

const ORIGEN: Record<AgenteCatalogo["origen"], string> = {
  "kawiil-louis": "Agente de Louis (OpenClaw)", revisor: "Revisor de Donna (OpenClaw)", "claude-for-legal": "Flujo de Claude for Legal (Anthropic), ejecutado por Louis",
};

export function FichaCatalogo({ agente, onCerrar }: { agente: AgenteCatalogo; onCerrar?: () => void }) {
  const f = useMemo(() => comoFigura(agente), [agente]);
  return (
    <section className="zen-glass min-w-0 space-y-3 rounded-3xl p-4" aria-label={`Ficha de ${agente.nombre}`} data-testid="ficha-catalogo">
      <EstilosOficina />
      <header className="flex items-start gap-3">
        <div className="shrink-0"><EscritorioAgente f={f} compacto /></div>
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-medium" data-testid="ficha-nombre">{agente.nombre}</h2>
          <p className="text-sm" role="status">En catálogo · sin señal</p>
          <p className="text-xs text-foreground/70">{nombreDepto(agente.depto)} · {agente.zona}</p>
        </div>
        {onCerrar && <button type="button" onClick={onCerrar} className="ml-auto shrink-0 rounded-full border border-border/60 px-3 py-1 text-xs" data-testid="ficha-cerrar">Cerrar</button>}
      </header>
      <p className="text-sm" data-testid="ficha-rol">{agente.rol}</p>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-foreground/70">Origen</dt><dd className="text-right">{ORIGEN[agente.origen]}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-foreground/70">Archivo</dt><dd className="text-right font-mono text-xs">{agente.clave}.md</dd></div>
      </dl>
      <div className="rounded-2xl border border-border/50 bg-background/40 p-3 text-sm" data-testid="ficha-pendiente">
        <p className="font-medium">Todavía no se ve trabajar aquí</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-foreground/80">
          <li>Lo ejecuta Louis, no el servicio de agentes: no escribe tareas ni latidos en Kawiil Central.</li>
          <li>Para verlo en vivo, Louis tendría que avisar cuándo corre y el agente tendría que estar en el registro (Dirección lo confirma antes de escribir nada).</li>
          <li>Por ahora no se le pueden mandar tareas desde este módulo.</li>
        </ul>
      </div>
    </section>
  );
}

export function VistaCatalogo({ nivel, vista, onVista }: { nivel: Exclude<NivelOficina, "kawiil">; vista: Vista; onVista: (v: Vista) => void }) {
  const catalogo = useMemo(() => catalogoDeNivel(nivel), [nivel]);
  const agentes = useMemo(() => catalogo.map(comoAgenteRegistro), [catalogo]);
  const figuras = useMemo(() => catalogo.map(comoFigura), [catalogo]);
  const zonas = useMemo(() => zonaPorId(catalogo), [catalogo]);
  const zonaDe = useMemo(() => (f: { id: string }) => zonas.get(f.id) ?? "", [zonas]);
  const grupos = useMemo(() => agruparPorDepartamento(figuras, agentes), [figuras, agentes]);
  const elegido = vista.tipo === "agente" ? catalogo.find((c) => c.id === vista.id) : undefined;
  const isla = vista.tipo === "isla" ? grupos.find((g) => g.depto.clave === vista.clave) : vista.tipo === "agente" ? grupos.find((g) => g.figuras.some((f) => f.id === vista.id)) : undefined;
  const etiqueta = () => "En catálogo";
  const elegir = (id: string) => onVista({ tipo: "agente", id });
  return (
    <div className="space-y-3" data-testid="vista-catalogo" data-nivel={nivel}>
      <p className="zen-glass rounded-2xl p-3 text-sm" data-testid="catalogo-aviso">
        <strong>{catalogo.length} agentes en {grupos.length} {grupos.length === 1 ? "isla" : "islas"}.</strong> Estos agentes los ejecuta Louis (OpenClaw) y no están en el registro de Kawiil Central:
        se ven aquí como catálogo, sin señal, y no reciben tareas desde este módulo.
      </p>
      {vista.tipo !== "plano" && (
        <nav aria-label="Dónde estás" className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" onClick={() => onVista(VISTA_PLANO)} data-testid="volver-plano" className="inline-flex items-center gap-1 rounded-full border border-border/60 px-3 py-1 text-xs">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />Todas las islas
          </button>
          {vista.tipo === "agente" && isla ? (
            <>
              <button type="button" onClick={() => onVista({ tipo: "isla", clave: isla.depto.clave })} data-testid="volver-isla" className="rounded-full border border-border/60 px-3 py-1 text-xs">{isla.depto.nombre}</button>
              <span aria-current="page" className="font-medium" data-testid="agente-titulo">{elegido?.nombre ?? "Agente"}</span>
            </>
          ) : <span aria-current="page" className="font-medium" data-testid="isla-titulo">{isla?.depto.nombre ?? "Isla sin agentes"}</span>}
        </nav>
      )}
      {vista.tipo === "plano" ? (
        <PlanoDepartamentos figuras={figuras} agentes={agentes} tareas={[]} ahora={new Date(0)} sinTareas onElegir={elegir} onAbrirIsla={(clave) => onVista({ tipo: "isla", clave })} />
      ) : !isla ? (
        <p className="zen-glass rounded-2xl p-4 text-sm text-muted-foreground" data-testid="catalogo-no-existe">No encontramos esa isla o ese agente en el catálogo.</p>
      ) : vista.tipo === "isla" ? (
        <SalaIsometrica depto={isla.depto} figuras={isla.figuras} zonaDe={zonaDe} etiqueta={etiqueta} onElegir={elegir} />
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:items-start">
          <SalaIsometrica depto={isla.depto} figuras={isla.figuras} zonaDe={zonaDe} etiqueta={etiqueta} elegidoId={vista.id} onElegir={elegir} />
          {elegido ? <div className="min-w-0 xl:sticky xl:top-3"><FichaCatalogo agente={elegido} onCerrar={() => onVista({ tipo: "isla", clave: isla.depto.clave })} /></div>
            : <p className="zen-glass rounded-2xl p-4 text-sm text-muted-foreground" data-testid="catalogo-no-existe">No encontramos ese agente en el catálogo.</p>}
        </div>
      )}
    </div>
  );
}
