import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MessageSquare, X } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { TrabajosAgente } from "@/components/agentes/TrabajosAgente";
import { FigurasContext } from "@/components/agentes/BandaEquipo";
import { IndicadorEnVivo } from "@/components/agentes/IndicadorEnVivo";
import { PanelEnCurso } from "@/components/agentes/PanelEnCurso";
import { AclaracionEstado } from "@/components/agentes/AclaracionEstado";
import { SeccionAgente } from "@/components/agentes/PanelAgente";
import { PanelRequerimientos } from "@/components/agentes/PanelRequerimientos";
import { useEsMovil } from "@/hooks/useEsMovil";
import { pendientesDeTi } from "@/lib/agentes/pendientes";
import { leerPestanaEscritorio, PESTANAS_ESCRITORIO_VALORES, type PestanaEscritorio } from "@/lib/agentes/vistas";
import { useHilo, useTareasSeguimiento } from "@/hooks/useSeguimientoAgentes";
import { EspacioVarios } from "@/components/agentes/EspacioVarios";
import { alternarVisible, leerModo, leerVer, MAX_A_LA_VEZ, visiblesAlaVez } from "@/lib/agentes/espacio";
import { esperasDe } from "@/lib/agentes/actividad";
import { estadoVisible, esPausado, esSoloLectura, leerAbiertos, MAX_ABIERTOS, urlChat } from "@/lib/agentes/chat";
import { figurasOficina } from "@/lib/agentes/oficina";
import { agentesDelModulo, nombreAgente } from "@/lib/agentes/registro";
import { useAgentesRegistro, useTareasAgentes } from "@/hooks/useAgentesRegistro";
import { useAgentesEnVivo } from "@/hooks/useAgentesEnVivo";

// Espacio de trabajo: el chat de cada agente en su propia pantalla (R2 y R2.b). Dirección propia por agente (`/agentes/chat/<id>?conv=<conversación>`),
// así que se puede abrir en una pestaña del navegador, recargar o compartir. Dentro, cada agente abierto tiene su pestaña con nombre, estado (palabra y marca)
// y botón para cerrarla, más «Abrir otro agente». Dos vistas (R3): «Una conversación» y «Varios a la vez» (`?modo=varios&ver=<ids>`; no aplica en el celular).
// Arriba de las dos va la lista «En curso» (R4).
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
  // R7: en el celular el chat ocupa toda la pantalla, «Varios a la vez» no aplica y los requerimientos van en su propia pantalla.
  const movil = useEsMovil(), ancho = !movil;
  const seccion = leerPestanaEscritorio(params.get("seccion")), verReq = movil && params.get("req") === "1";
  const cambiarSeccion = (v: PestanaEscritorio) => setParams((p) => { const n = new URLSearchParams(p); if (v === "conversaciones") n.delete("seccion"); else n.set("seccion", v); return n; }, { replace: true });
  const abrirReq = (v: boolean) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set("req", "1"); else n.delete("req"); return n; }, { replace: true });
  const modo = ancho ? leerModo(params.get("modo")) : "una";
  const ver = useMemo(() => visiblesAlaVez(abiertos, leerVer(params.get("ver")), activo), [abiertos, params, activo]);
  const opcionesUrl = { abiertos, ...(modo === "varios" ? { modo: "varios" as const, ver } : {}) };
  const agente = (agentes.data ?? []).find((a) => a.id === activo);
  const disponibles = reales.filter((a) => a.status !== "archived" && !abiertos.includes(a.id) && a.kind !== "system");

  const cerrar = (id: string) => {
    const resto = abiertos.filter((x) => x !== id);
    if (id !== activo) { setParams((p) => { const n = new URLSearchParams(p); if (resto.length > 1) n.set("a", resto.join(",")); else n.delete("a"); return n; }, { replace: true }); return; }
    if (resto.length === 0) { navegar(`/agentes?vista=agente:${id}`); return; }
    navegar(urlChat(resto[0], { abiertos: resto, ...(modo === "varios" ? { modo: "varios" as const } : {}) }));
  };
  const cambiarModo = (m: "una" | "varios") => setParams((p) => { const n = new URLSearchParams(p); if (m === "varios") { n.set("modo", "varios"); n.set("ver", ver.join(",")); } else { n.delete("modo"); n.delete("ver"); } return n; }, { replace: true });
  const alternarVer = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("ver", alternarVisible(ver, id).join(",")); return n; }, { replace: true });
  const cambiarConv = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set("conv", id); else n.delete("conv"); return n; }, { replace: true });

  const f = figuras.find((x) => x.id === activo);
  const NombreCorto = agente ? nombreAgente(agente) : "Agente";
  const sinChat = !agente || agente.kind === "system";

  return (
    <AppLayout>
      <FigurasContext.Provider value={figuras}>
        <div className={movil ? "fixed inset-0 z-50 space-y-3 overflow-y-auto bg-background p-3" : "space-y-4 p-4 md:p-6"} data-testid="agentes-chat" data-movil={movil ? "true" : "false"}>
          {!movil && <PageHeader title={agente ? `Chat con ${NombreCorto}` : "Chat con un agente"} description="Espacio de trabajo: la conversación completa con cada agente, en su propia pantalla." icon={<MessageSquare className="h-5 w-5" />} />}
          <div className="flex flex-wrap items-center gap-3">
            <Link to={`/agentes?vista=agente:${activo}`} className="inline-flex min-h-11 items-center rounded-full border border-border/60 px-4 text-sm" data-testid="chat-volver-sala">{movil ? "‹ Sala" : "Volver a la sala"}</Link>
            {movil && <h1 className="min-w-0 flex-1 truncate text-base font-medium" data-testid="chat-titulo-movil">{NombreCorto}</h1>}
            {movil && !sinChat && !verReq && <BotonRequerimientos onClick={() => abrirReq(true)} />}
            {!movil && <IndicadorEnVivo estado={enVivo} actualizadoEn={Math.max(agentes.dataUpdatedAt, tareas.dataUpdatedAt)} />}
            {ancho && (
              <div role="group" aria-label="Vista del espacio de trabajo" className="ml-auto inline-flex rounded-full border border-border/60 p-0.5">
                {([["una", "Una conversación"], ["varios", "Varios a la vez"]] as const).map(([v, t]) => (
                  <button key={v} type="button" aria-pressed={modo === v} onClick={() => cambiarModo(v)} data-testid={`modo-${v}`}
                    className={`min-h-11 rounded-full px-4 text-sm ${modo === v ? "bg-primary/10 font-medium" : ""}`}>{t}</button>
                ))}
              </div>
            )}
          </div>

          {verReq ? (
            <PantallaRequerimientos conv={conv && UUID.test(conv) ? conv.toLowerCase() : null} ahora={reloj} onVolver={() => abrirReq(false)} />
          ) : (
            <>
              <PanelEnCurso abiertos={abiertos} ahora={reloj} plegable={movil} />

              <nav aria-label="Agentes abiertos" className={`flex items-end gap-1 border-b border-border/60 ${movil ? "flex-nowrap overflow-x-auto" : "flex-wrap"}`} data-testid="chat-pestanas">
                {abiertos.map((id) => {
                  const a = (agentes.data ?? []).find((x) => x.id === id), fg = figuras.find((x) => x.id === id);
                  const e = fg ? estadoVisible(fg.estado, esperasDe(id, tareas.data ?? []), esSoloLectura(a?.config), esPausado(a?.config)) : null, esActiva = id === activo;
                  return (
                    <div key={id} className={`flex min-h-12 shrink-0 items-center gap-1 rounded-t-2xl border border-b-0 pl-3 pr-1 ${esActiva ? "border-border bg-background shadow-sm" : "border-border/50 bg-muted/40"}`} data-testid={`pestana-chat-${id}`}>
                      <Link to={urlChat(id, { ...opcionesUrl, conv: id === activo ? conv : null })} aria-current={esActiva ? "page" : undefined} className="flex min-h-11 min-w-0 items-center gap-2 text-sm">
                        <span className="max-w-[10rem] truncate font-medium">{a ? nombreAgente(a) : "Agente"}</span>
                        {e && <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground" data-testid={`pestana-estado-${id}`}><span aria-hidden>{e.marca}</span>{e.texto}</span>}
                      </Link>
                      <button type="button" onClick={() => cerrar(id)} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted" aria-label={`Cerrar la pestaña de ${a ? nombreAgente(a) : "este agente"}`} data-testid={`cerrar-pestana-${id}`}><X className="h-4 w-4" aria-hidden /></button>
                    </div>
                  );
                })}
                {disponibles.length > 0 && abiertos.length < MAX_ABIERTOS && (
                  <label className="ml-1 flex min-h-12 shrink-0 items-center gap-2 text-sm">
                    <span className="sr-only">Abrir otro agente</span>
                    <select className="min-h-11 rounded-full border border-input bg-background px-3 text-sm" value="" data-testid="abrir-otro-agente" aria-label="Abrir otro agente"
                      onChange={(e) => { const id = e.target.value; if (id) navegar(urlChat(id, { abiertos: [...abiertos, id], ...(modo === "varios" ? { modo: "varios" as const } : {}) })); }}>
                      <option value="">Abrir otro agente…</option>
                      {disponibles.map((a) => <option key={a.id} value={a.id}>{nombreAgente(a)}</option>)}
                    </select>
                  </label>
                )}
              </nav>

              {movil && !sinChat && (
                <div role="tablist" aria-label="Secciones del agente" className="flex flex-nowrap gap-1 overflow-x-auto pb-1" data-testid="chat-secciones">
                  {PESTANAS_ESCRITORIO_VALORES.map((v) => (
                    <button key={v} type="button" role="tab" aria-selected={seccion === v} onClick={() => cambiarSeccion(v)} data-testid={`seccion-${v}`}
                      className={`min-h-11 shrink-0 rounded-full border px-4 text-sm ${seccion === v ? "border-primary/60 bg-primary/10 font-medium" : "border-border/60"}`}>{ETIQUETA_SECCION[v]}</button>
                  ))}
                </div>
              )}
              {agente && (esSoloLectura(agente.config) || esPausado(agente.config)) && (
                <div className="flex flex-wrap gap-x-4" data-testid="chat-aclaraciones">
                  {esPausado(agente.config) && <AclaracionEstado estado="pausado" id={agente.id} />}
                  {esSoloLectura(agente.config) && <AclaracionEstado estado="solo_lectura" id={agente.id} />}
                </div>
              )}
              {modo === "varios" && (
                <div role="group" aria-label="Agentes que se ven a la vez" className="flex flex-wrap items-center gap-2 text-sm" data-testid="varios-elegir">
                  <span className="text-muted-foreground">Se ven hasta {MAX_A_LA_VEZ} a la vez:</span>
                  {abiertos.map((id) => { const a = (agentes.data ?? []).find((x) => x.id === id); return (
                    <button key={id} type="button" aria-pressed={ver.includes(id)} onClick={() => alternarVer(id)} data-testid={`varios-ver-${id}`}
                      className={`min-h-11 rounded-full border px-3 text-xs ${ver.includes(id) ? "border-primary/60 bg-primary/10 font-medium" : "border-border/60"}`}>{ver.includes(id) ? "✓ " : ""}{a ? nombreAgente(a) : "Agente"}</button>
                  ); })}
                </div>
              )}
              {agentes.isLoading ? <p className="text-sm text-muted-foreground">Leyendo el registro de agentes…</p>
                : modo === "varios" ? <EspacioVarios agentes={agentes.data ?? []} visibles={ver} figuras={figuras} tareas={tareas.data ?? []} abiertos={abiertos} ahora={reloj} />
                : !agente ? <p className="zen-glass rounded-2xl p-4 text-sm text-muted-foreground" data-testid="chat-no-existe">No encontramos a ese agente en el registro.</p>
                : agente.kind === "system" ? <p className="zen-glass rounded-2xl p-4 text-sm text-muted-foreground" data-testid="chat-sistema">Este agente de Marketing trabaja por su cuenta; su seguimiento está en <Link className="underline" to="/marketing">Marketing</Link>.</p>
                : movil && seccion !== "conversaciones" && f ? <SeccionAgente seccion={seccion} agente={agente} f={f} tareas={tareas.data ?? []} ahora={reloj} />
                : <TrabajosAgente key={agente.id} agentId={agente.id} nombre={nombreAgente(agente)} ahora={reloj} agente={agente} convInicial={conv && UUID.test(conv) ? conv.toLowerCase() : null} onConv={cambiarConv}
                    claseAlto={movil ? "h-[calc(100dvh-32rem)] min-h-[16rem]" : "h-[calc(100vh-20rem)] min-h-[24rem]"} />}
            </>
          )}
        </div>
      </FigurasContext.Provider>
    </AppLayout>
  );
}

const ETIQUETA_SECCION: Record<PestanaEscritorio, string> = { conversaciones: "Conversaciones", perfil: "Perfil", aprendizaje: "Aprendizaje", rutinas: "Rutinas", documentos: "Documentos" };

// Botón «Requerimientos» del chat en el celular, con su total (los pendientes de ti de todos los agentes).
function BotonRequerimientos({ onClick }: { onClick: () => void }) {
  const q = useTareasSeguimiento("todas");
  const n = pendientesDeTi(q.data ?? []).length;
  return <button type="button" onClick={onClick} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-border/60 px-4 text-sm font-medium" data-testid="boton-requerimientos">Requerimientos<span className="rounded-full bg-primary/10 px-2 text-xs" data-testid="boton-requerimientos-total">{n}</span></button>;
}

// Los requerimientos en su propia pantalla (celular): Pendientes de ti, De la autoridad y Documentos de la conversación abierta.
function PantallaRequerimientos({ conv, ahora, onVolver }: { conv: string | null; ahora: Date; onVolver: () => void }) {
  const h = useHilo(conv);
  return (
    <section className="space-y-3" aria-label="Requerimientos" data-testid="pantalla-requerimientos">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onVolver} className="inline-flex min-h-11 items-center rounded-full border border-border/60 px-4 text-sm" data-testid="requerimientos-volver">‹ Volver al chat</button>
        <h2 className="text-base font-medium">Requerimientos</h2>
      </div>
      <div className="zen-glass rounded-3xl p-1"><PanelRequerimientos mensajes={h.data?.mensajes ?? []} ahora={ahora} pantalla /></div>
    </section>
  );
}
