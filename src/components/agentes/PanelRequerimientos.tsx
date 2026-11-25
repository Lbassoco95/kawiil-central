import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListaDocumentos, documentosDelHilo } from "@/components/agentes/DocumentosHilo";
import { urlChat } from "@/lib/agentes/chat";
import { pendientesDeTi, textoPendientes, type Pendiente } from "@/lib/agentes/pendientes";
import { cuandoRelativo } from "@/lib/agentes/registro";
import { useAprobarPlan, useHilo, useTareasSeguimiento } from "@/hooks/useSeguimientoAgentes";
import type { MensajeHilo } from "../../../supabase/functions/_shared/seguimiento";

// Panel «Requerimientos» de cada conversación (R6.1): tres pestañas. Solo Dirección (los datos vienen de `agente-seguimiento`).
//  · Pendientes de ti: lo que un agente necesita de la persona (hoy: tareas que esperan aprobación). Cada una dice el agente y el motivo y trae su acción.
//  · De la autoridad: SIN DATOS hasta que Dirección decida de dónde salen (decisión pendiente). Nunca muestra ejemplos. Cuando haya datos, un requerimiento sin folio o plazo
//    se mostrará como «Sin plazo leído» y pedirá revisión de una persona (R6.4); no se ocultará.
//  · Documentos: los entregables de esta conversación, con Ver (PDF) y Descargar.
type Pestana = "pendientes" | "autoridad" | "documentos";

function FilaPendiente({ p, ahora }: { p: Pendiente; ahora: Date }) {
  const hilo = useHilo(p.conversacion);
  const aprobar = useAprobarPlan();
  // «Aprobar» solo cuando el agente propuso un plan de encargo y espera esa aprobación; cualquier otra espera se resuelve en su chat.
  const plan = hilo.data?.mensajes.find((m) => m.plan?.fase === "propuesto");
  return (
    <li className="space-y-1 rounded-2xl border border-amber-300/60 bg-amber-50/40 p-3" data-testid={`pendiente-${p.tareaId}`}>
      <p className="text-sm font-medium">{p.agente} <span className="font-normal text-muted-foreground">· Espera tu aprobación</span></p>
      <p className="text-sm">{plan ? "Propuso un plan de trabajo y espera que lo apruebes." : "Necesita que le des el visto bueno para seguir."}</p>
      {p.titulo && <p className="text-xs text-muted-foreground">{p.titulo} · {cuandoRelativo(p.creada, ahora)}</p>}
      {aprobar.isError && <p role="alert" className="text-sm text-destructive">{(aprobar.error as Error).message}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        {plan && (
          <Button size="sm" disabled={aprobar.isPending} data-testid={`pendiente-aprobar-${p.tareaId}`} onClick={() => aprobar.mutate(plan.task_id)}>
            {aprobar.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Aprobar
          </Button>
        )}
        {p.agenteId && <Link to={urlChat(p.agenteId, { conv: p.conversacion })} className="inline-flex min-h-9 items-center rounded-full border border-border/60 px-3 text-sm" data-testid={`pendiente-chat-${p.tareaId}`}>Abrir el chat</Link>}
      </div>
    </li>
  );
}

export function PanelRequerimientos({ mensajes, ahora = new Date() }: { mensajes: MensajeHilo[]; ahora?: Date }) {
  const lista = useTareasSeguimiento("todas");
  const pendientes = pendientesDeTi(lista.data ?? []);
  const docs = documentosDelHilo(mensajes).length;
  const [abierto, setAbierto] = useState(true);
  const [pestana, setPestana] = useState<Pestana>("pendientes");
  const tabs: Array<{ v: Pestana; t: string; n: number | null }> = [{ v: "pendientes", t: "Pendientes de ti", n: pendientes.length }, { v: "autoridad", t: "De la autoridad", n: null }, { v: "documentos", t: "Documentos", n: docs }];
  return (
    <section className="shrink-0 border-b border-border/40 bg-background text-sm" aria-label="Requerimientos" data-testid="requerimientos">
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-xs font-medium" data-testid="requerimientos-resumen">
        Requerimientos · {textoPendientes(pendientes.length)} · {docs} {docs === 1 ? "documento" : "documentos"}
      </button>
      {abierto && (
        <div className="space-y-2 px-3 pb-3">
          <div role="tablist" aria-label="Requerimientos" className="flex flex-wrap gap-1">
            {tabs.map((x) => (
              <button key={x.v} type="button" role="tab" aria-selected={pestana === x.v} onClick={() => setPestana(x.v)} data-testid={`req-tab-${x.v}`}
                className={`min-h-9 rounded-full border px-3 text-xs ${pestana === x.v ? "border-primary/60 bg-primary/10 font-medium" : "border-border/60"}`}>
                {x.t}{x.n !== null ? ` · ${x.n}` : ""}
              </button>
            ))}
          </div>
          {pestana === "pendientes" && (
            lista.isLoading ? <p className="text-sm text-muted-foreground">Leyendo lo que te espera…</p>
              : lista.isError ? <p role="alert" className="text-sm text-destructive">{(lista.error as Error).message}</p>
              : pendientes.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="pendientes-vacio">Nada pendiente de ti.</p>
              : <ul className="space-y-2" aria-label="Pendientes de ti">{pendientes.map((p) => <FilaPendiente key={p.tareaId} p={p} ahora={ahora} />)}</ul>
          )}
          {pestana === "autoridad" && (
            <p className="zen-glass rounded-2xl p-3 text-sm text-muted-foreground" data-testid="autoridad-sin-datos">
              Aún no hay requerimientos de la autoridad conectados. Aparecerán aquí, con folio y plazo, cuando Dirección decida de dónde salen (que el agente los lea o que una persona los capture).
              Uno sin folio o plazo se mostrará como «Sin plazo leído» y pedirá revisión de una persona.
            </p>
          )}
          {pestana === "documentos" && <ListaDocumentos mensajes={mensajes} />}
        </div>
      )}
    </section>
  );
}
