import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MessageSquare, X } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { TrabajosAgente } from "@/components/agentes/TrabajosAgente";
import { FigurasContext } from "@/components/agentes/BandaEquipo";
import { IndicadorEnVivo } from "@/components/agentes/IndicadorEnVivo";
import { esperasDe } from "@/lib/agentes/actividad";
import { estadoVisible, esSoloLectura, leerAbiertos, MAX_ABIERTOS, urlChat } from "@/lib/agentes/chat";
import { figurasOficina } from "@/lib/agentes/oficina";
import { agentesDelModulo, nombreAgente } from "@/lib/agentes/registro";
import { useAgentesRegistro, useTareasAgentes } from "@/hooks/useAgentesRegistro";
import { useAgentesEnVivo } from "@/hooks/useAgentesEnVivo";

// Espacio de trabajo: el chat de cada agente en su propia pantalla (R2 y R2.b). Dirección propia por agente (`/agentes/chat/<id>?conv=<conversación>`),
// así que se puede abrir en una pestaña del navegador, recargar o compartir. Dentro, cada agente abierto tiene su pestaña con nombre, estado (palabra y marca)
// y botón para cerrarla, más «Abrir otro agente». La vista «Varios a la vez» llega con R3; aquí solo «Una conversación».
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AgentesChat() {
  const { agenteId = "" } = useParams();
  const activo = agenteId.toLowerCase();
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const agentes = useAgentesRegistro();
  const tareas = useTareasAgentes();
  const enVivo = useAgentesEnVivo();
  const [reloj, setReloj] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setReloj(new Date()), 60_000); return () => clearInterval(t); }, []);

  const reales = useMemo(() => agentesDelModulo(agentes.data ?? []), [agentes.data]);
  const figuras = useMemo(() => figurasOficina(agentes.data ?? [], tareas.data ?? [], reloj), [agentes.data, tareas.data, reloj]);
  const abiertos = useMemo(() => { const a = leerAbiertos(params.get("a")); return UUID.test(activo) && !a.includes(activo) ? [activo, ...a].slice(0, MAX_ABIERTOS) : a; }, [params, activo]);
  const conv = params.get("conv");
  const agente = (agentes.data ?? []).find((a) => a.id === activo);
  const disponibles = reales.filter((a) => a.status !== "archived" && !abiertos.includes(a.id) && a.kind !== "system");

  const cerrar = (id: string) => {
    const resto = abiertos.filter((x) => x !== id);
    if (id !== activo) { setParams((p) => { const n = new URLSearchParams(p); if (resto.length > 1) n.set("a", resto.join(",")); else n.delete("a"); return n; }, { replace: true }); return; }
    if (resto.length === 0) { navegar(`/agentes?vista=agente:${id}`); return; }
    navegar(urlChat(resto[0], { abiertos: resto }));
  };
  const cambiarConv = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set("conv", id); else n.delete("conv"); return n; }, { replace: true });

  return (
    <AppLayout>
      <FigurasContext.Provider value={figuras}>
        <div className="space-y-4 p-4 md:p-6" data-testid="agentes-chat">
          <PageHeader title={agente ? `Chat con ${nombreAgente(agente)}` : "Chat con un agente"} description="Espacio de trabajo: la conversación completa con cada agente, en su propia pantalla." icon={<MessageSquare className="h-5 w-5" />} />
          <div className="flex flex-wrap items-center gap-3">
            <Link to={`/agentes?vista=agente:${activo}`} className="inline-flex min-h-11 items-center rounded-full border border-border/60 px-4 text-sm" data-testid="chat-volver-sala">Volver a la sala</Link>
            <IndicadorEnVivo estado={enVivo} actualizadoEn={Math.max(agentes.dataUpdatedAt, tareas.dataUpdatedAt)} />
          </div>

          <nav aria-label="Agentes abiertos" className="flex flex-wrap items-end gap-1 border-b border-border/60" data-testid="chat-pestanas">
            {abiertos.map((id) => {
              const a = (agentes.data ?? []).find((x) => x.id === id), f = figuras.find((x) => x.id === id);
              const e = f ? estadoVisible(f.estado, esperasDe(id, tareas.data ?? []), esSoloLectura(a?.config)) : null, esActiva = id === activo;
              return (
                <div key={id} className={`flex min-h-12 items-center gap-1 rounded-t-2xl border border-b-0 pl-3 pr-1 ${esActiva ? "border-border bg-background shadow-sm" : "border-border/50 bg-muted/40"}`} data-testid={`pestana-chat-${id}`}>
                  <Link to={urlChat(id, { abiertos })} aria-current={esActiva ? "page" : undefined} className="flex min-h-11 min-w-0 items-center gap-2 text-sm">
                    <span className="max-w-[10rem] truncate font-medium">{a ? nombreAgente(a) : "Agente"}</span>
                    {e && <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground" data-testid={`pestana-estado-${id}`}><span aria-hidden>{e.marca}</span>{e.texto}</span>}
                  </Link>
                  <button type="button" onClick={() => cerrar(id)} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted" aria-label={`Cerrar la pestaña de ${a ? nombreAgente(a) : "este agente"}`} data-testid={`cerrar-pestana-${id}`}><X className="h-4 w-4" aria-hidden /></button>
                </div>
              );
            })}
            {disponibles.length > 0 && abiertos.length < MAX_ABIERTOS && (
              <label className="ml-1 flex min-h-12 items-center gap-2 text-sm">
                <span className="sr-only">Abrir otro agente</span>
                <select className="min-h-11 rounded-full border border-input bg-background px-3 text-sm" value="" data-testid="abrir-otro-agente" aria-label="Abrir otro agente"
                  onChange={(e) => { const id = e.target.value; if (id) navegar(urlChat(id, { abiertos: [...abiertos, id] })); }}>
                  <option value="">Abrir otro agente…</option>
                  {disponibles.map((a) => <option key={a.id} value={a.id}>{nombreAgente(a)}</option>)}
                </select>
              </label>
            )}
          </nav>

          {agentes.isLoading ? <p className="text-sm text-muted-foreground">Leyendo el registro de agentes…</p>
            : !agente ? <p className="zen-glass rounded-2xl p-4 text-sm text-muted-foreground" data-testid="chat-no-existe">No encontramos a ese agente en el registro.</p>
            : agente.kind === "system" ? <p className="zen-glass rounded-2xl p-4 text-sm text-muted-foreground" data-testid="chat-sistema">Este agente de Marketing trabaja por su cuenta; su seguimiento está en <Link className="underline" to="/marketing">Marketing</Link>.</p>
            : <TrabajosAgente key={agente.id} agentId={agente.id} nombre={nombreAgente(agente)} ahora={reloj} agente={agente} convInicial={conv && UUID.test(conv) ? conv.toLowerCase() : null} onConv={cambiarConv} claseAlto="h-[calc(100vh-20rem)] min-h-[24rem]" />}
        </div>
      </FigurasContext.Provider>
    </AppLayout>
  );
}
