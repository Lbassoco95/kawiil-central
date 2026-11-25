import { Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EscritorioAgente, EstilosOficina } from "@/components/agentes/escritorio";
import { ResumenConversacion } from "@/components/agentes/ResumenConversacion";
import { MemoriaAgentes } from "@/components/agentes/MemoriaAgentes";
import { EnsenarAgente, ensenable } from "@/components/agentes/EnsenarAgente";
import { CalendarioRutinas } from "@/components/agentes/CalendarioRutinas";
import { ProgramarAgente, programable } from "@/components/agentes/ProgramarAgente";
import { DocumentosAgente, documentable } from "@/components/agentes/DocumentosAgente";
import { ComunicacionInterna } from "@/components/agentes/ComunicacionInterna";
import { actividadDe, colaboracionDe, esperasDe, progresoNivel, type Enlace } from "@/lib/agentes/actividad";
import { NIVELES, nivelDe, perfilDe } from "@/lib/agentes/personajes";
import { descripcionAgente, nombreAgente, type AgenteRegistro, type TareaAgente } from "@/lib/agentes/registro";
import type { FiguraOficina } from "@/lib/agentes/oficina";
import type { PestanaEscritorio } from "@/lib/agentes/vistas";

// Escritorio del agente (panel derecho): lo de ESTE agente en cinco pestañas, con los componentes que ya existían (memoria, enseñar, rutinas, documentos).
// «Conversaciones» solo resume la última y lleva a su chat aparte (R2.b): aquí no se escribe. El perfil se lee de las propuestas iniciales (personajesDatos.ts): editarlo con versiones es una fase aparte que confirma Dirección.
// Solo Dirección escribe, y siempre a través de las funciones de cada pestaña; este panel no escribe nada por su cuenta.
export const PESTANAS_ESCRITORIO: Array<{ v: PestanaEscritorio; t: string }> = [
  { v: "conversaciones", t: "Conversaciones" }, { v: "perfil", t: "Perfil" }, { v: "aprendizaje", t: "Aprendizaje" }, { v: "rutinas", t: "Rutinas" }, { v: "documentos", t: "Documentos" },
];
const Nota = ({ children, id }: { children: React.ReactNode; id?: string }) => <p className="zen-glass rounded-2xl p-3 text-sm text-muted-foreground" data-testid={id}>{children}</p>;

function Enlaces({ titulo, lista, nombreDe, testid }: { titulo: string; lista: Enlace[]; nombreDe: (id: string) => string; testid: string }) {
  if (lista.length === 0) return null;
  return <li data-testid={testid}>{titulo}: {lista.map((e) => `${nombreDe(e.id)} (${e.veces}×)`).join(", ")}</li>;
}

function Perfil({ agente, f }: { agente: AgenteRegistro; f: FiguraOficina }) {
  const p = perfilDe(agente.name), nivel = nivelDe(agente.tasks_completed), n = NIVELES[nivel], prog = progresoNivel(agente.tasks_completed);
  return (
    <div className="space-y-3" data-testid="pestana-perfil">
      <section className="zen-glass space-y-2 rounded-3xl p-4" aria-label="Nivel">
        <h3 className="text-sm font-medium">Nivel</h3>
        <p className="text-base" data-testid="perfil-nivel"><span aria-hidden>{n.estrellas}</span> <strong>{n.etiqueta}</strong></p>
        <p className="text-xs text-muted-foreground">{prog.hechas} {prog.hechas === 1 ? "tarea hecha" : "tareas hechas"}{prog.faltan !== null ? ` · faltan ${prog.faltan} para el siguiente nivel` : " · ya es Experto"}. Se calcula con las tareas hechas; no se asigna a mano.</p>
      </section>
      {p ? (
        <section className="zen-glass space-y-3 rounded-3xl p-4" aria-label="Personalidad" data-testid="perfil-personalidad">
          <h3 className="text-sm font-medium">Personalidad · {p.arquetipo}</h3>
          <p className="text-sm"><span className="text-muted-foreground">Habla:</span> {p.habla}</p>
          <p className="border-l-2 border-border pl-3 text-sm italic">{p.frase}</p>
          <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="Rasgos">{p.rasgos.map((r) => <li key={r} className="rounded-full border border-border/60 px-2.5 py-0.5">{r}</li>)}</ul>
          <div><h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Lo que cuida</h4><p className="text-sm">{p.cuida}</p></div>
          <div><h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aspecto</h4><p className="text-sm">{p.aspecto}</p></div>
          <p className="text-xs text-muted-foreground" data-testid="perfil-propuesta">Es una propuesta inicial para que Dirección la revise. Editar el perfil y las instrucciones, con versión y la posibilidad de volver a la anterior, llegará como un cambio aparte.</p>
        </section>
      ) : <Nota id="perfil-vacio">{f.nombre} es un agente nuevo y aún no tiene un perfil escrito. {descripcionAgente(agente)}</Nota>}
    </div>
  );
}

function Aprendizaje({ agente, tareas, ahora }: { agente: AgenteRegistro; tareas: TareaAgente[]; ahora: Date }) {
  return (
    <div className="space-y-4" data-testid="pestana-aprendizaje">
      <section className="zen-glass space-y-2 rounded-3xl p-4 text-sm" aria-label="Cómo aprende">
        <h3 className="font-medium">Cómo aprende este agente</h3>
        <p className="text-xs text-muted-foreground">Solo por tres vías, y siempre con tu aprobación. Un agente nunca crea ni cambia sus habilidades por su cuenta, y aprender no le da permisos nuevos.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li><strong>Lo que tú le enseñas:</strong> una habilidad con pasos y precauciones; la revisas y la apruebas o la dejas en borrador.</li>
          <li><strong>Lo que recuerda de sus tareas:</strong> memorias con importancia, uso y vencimiento; si una no te convence, la apagas.</li>
          <li><strong>Sus instrucciones y su perfil:</strong> cómo trabaja, cómo habla y qué cuida (cada cambio quedará como versión; llega en otro cambio).</li>
        </ol>
      </section>
      <section className="space-y-2" aria-label="Memoria"><h3 className="text-sm font-medium">Memoria · lo que recuerda de sus tareas</h3><MemoriaAgentes agentes={[agente]} ahora={ahora} agenteInicial={agente.id} fijo /></section>
      <section className="space-y-2" aria-label="Enseñarle algo nuevo"><h3 className="text-sm font-medium">Enseñarle algo nuevo</h3>
        {ensenable(agente) ? <EnsenarAgente agentes={[agente]} tareas={tareas} ahora={ahora} agenteInicial={agente.id} fijo />
          : <Nota id="ensenar-no">Solo se pueden enseñar habilidades a los agentes creados desde el Constructor. {nombreAgente(agente)} no es uno de ellos.</Nota>}
      </section>
    </div>
  );
}

export function PanelAgente({ figura: f, agente, agentes, tareas, ahora, pestana, onPestana, onVolver }: {
  figura: FiguraOficina; agente: AgenteRegistro; agentes: AgenteRegistro[]; tareas: TareaAgente[]; ahora: Date; pestana: PestanaEscritorio; onPestana: (p: PestanaEscritorio) => void; onVolver?: () => void;
}) {
  const nombreDe = (id: string) => { const a = agentes.find((x) => x.id === id); return a ? nombreAgente(a) : "otro agente"; };
  const propias = tareas.filter((t) => t.agent_id === agente.id);
  const colab = colaboracionDe(agente.id, tareas, ahora), espera = esperasDe(agente.id, tareas), nivel = NIVELES[nivelDe(agente.tasks_completed)];
  const perfil = perfilDe(agente.name), sistema = agente.kind === "system", esComunicacion = agente.name === "marketing_comunicacion_interna";
  return (
    <section className="zen-glass min-w-0 space-y-3 rounded-3xl p-4" aria-label={`Escritorio de ${f.nombre}`} data-testid="panel-agente">
      <EstilosOficina />
      <header className="flex items-start gap-3">
        <div className="shrink-0"><EscritorioAgente f={f} compacto /></div>
        <div className="min-w-0 space-y-1">
          <h2 className="truncate text-lg font-medium" data-testid="panel-nombre">{f.nombre}</h2>
          <p className="text-sm" role="status" data-testid="panel-actividad">{actividadDe(agente.id, f.estado, tareas)}</p>
          {f.rol && <p className="text-xs text-muted-foreground">{f.rol}</p>}
          {perfil && <p className="text-xs italic text-muted-foreground">{perfil.frase}</p>}
          <p className="text-xs"><span aria-hidden>{nivel.estrellas}</span> {nivel.etiqueta}{espera > 0 && <> <span aria-hidden>·</span> <button type="button" onClick={() => onPestana("conversaciones")} className="rounded-full border border-amber-300/70 bg-amber-100/60 px-2 py-0.5 text-amber-900 dark:border-amber-400/50 dark:bg-amber-400/20 dark:text-amber-100" data-testid="panel-espera">Te espera: {espera} {espera === 1 ? "tarea" : "tareas"}</button></>}</p>
          {(colab.recibioDe.length > 0 || colab.pasoA.length > 0) && (
            <ul className="text-xs text-muted-foreground" aria-label="Colaboración con otros agentes" data-testid="panel-colaboracion">
              <Enlaces titulo="Le pasó trabajo" lista={colab.recibioDe} nombreDe={nombreDe} testid="panel-recibio" />
              <Enlaces titulo="Pasó trabajo a" lista={colab.pasoA} nombreDe={nombreDe} testid="panel-paso" />
            </ul>
          )}
        </div>
        {onVolver && <button type="button" onClick={onVolver} className="ml-auto shrink-0 rounded-full border border-border/60 px-3 py-1 text-xs" data-testid="panel-cerrar">Cerrar</button>}
      </header>
      <Tabs value={pestana} onValueChange={(v) => onPestana(v as PestanaEscritorio)}>
        <TabsList className="h-auto w-full flex-wrap justify-start" aria-label="Escritorio del agente">
          {PESTANAS_ESCRITORIO.map((p) => <TabsTrigger key={p.v} value={p.v} className="text-foreground/75 data-[state=active]:text-foreground" data-testid={`pestana-${p.v}`}>{p.t}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="conversaciones" className="mt-3 space-y-3">
          {!sistema && <ResumenConversacion agentId={agente.id} nombre={f.nombre} ahora={ahora} />}
          {sistema && !esComunicacion && <Nota id="conv-sistema">Este agente de Marketing trabaja por su cuenta; sus seguimientos están en <Link className="underline" to="/marketing">Marketing</Link>.</Nota>}
          {esComunicacion && <ComunicacionInterna />}
        </TabsContent>
        <TabsContent value="perfil" className="mt-3"><Perfil agente={agente} f={f} /></TabsContent>
        <TabsContent value="aprendizaje" className="mt-3"><Aprendizaje agente={agente} tareas={tareas} ahora={ahora} /></TabsContent>
        <TabsContent value="rutinas" className="mt-3 space-y-3" data-testid="pestana-rutinas-contenido">
          <CalendarioRutinas agentes={[agente]} tareas={propias} ahora={ahora} onProgramar={() => document.getElementById("programar-aqui")?.scrollIntoView?.({ behavior: "smooth" })} />
          <div id="programar-aqui" className="scroll-mt-4">
            {programable(agente) ? <ProgramarAgente agentes={[agente]} agenteInicial={agente.id} fijo /> : <Nota id="programar-no">Solo se pueden programar agentes creados desde el Constructor con cadencia diaria o semanal.</Nota>}
          </div>
        </TabsContent>
        <TabsContent value="documentos" className="mt-3">
          {documentable(agente) ? <DocumentosAgente agentes={[agente]} agenteInicial={agente.id} fijo /> : <Nota id="documentos-no">Los agentes de sistema no tienen documentos propios.</Nota>}
        </TabsContent>
      </Tabs>
    </section>
  );
}
