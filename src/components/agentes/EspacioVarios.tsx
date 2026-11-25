import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Send } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { HiloAgente } from "@/components/agentes/HiloAgente";
import { esperasDe } from "@/lib/agentes/actividad";
import { estadoVisible, esPausado, esSoloLectura, urlChat } from "@/lib/agentes/chat";
import { tituloDe } from "@/lib/agentes/enrutar";
import { nombreAgente, type AgenteRegistro, type TareaAgente } from "@/lib/agentes/registro";
import type { FiguraOficina } from "@/lib/agentes/oficina";
import { useInstruirAgente } from "@/hooks/useAgenteConstructor";
import { useTareasSeguimiento, type RespuestaHilo } from "@/hooks/useSeguimientoAgentes";

// Vista «Varios a la vez» (R3): los chats de los agentes elegidos lado a lado, cada uno con su estado y «Abrir en pestaña», y UN solo cuadro para escribir a los
// agentes marcados (o a uno solo, marcando solo ese). Cada mensaje va como una tarea aparte a cada agente: escribirle a uno no interrumpe lo que otro está haciendo.
// El cuadro único NO lleva accesos de 1Password ni permiso de escribir en sitios (eso se autoriza tarea por tarea en el chat de cada agente).
// Cuántos se ven a la vez es una decisión pendiente de Dirección (provisional: dos, ver MAX_A_LA_VEZ).
interface Destino { agente: AgenteRegistro; conv: string | null }

function Panel({ agente, figura, esperas, abiertos, marcado, onMarcar, onConv, ahora }: {
  agente: AgenteRegistro; figura?: FiguraOficina; esperas: number; abiertos: string[]; marcado: boolean; onMarcar: () => void; onConv: (id: string, conv: string | null) => void; ahora: Date;
}) {
  const q = useTareasSeguimiento("todas", agente.id);
  const raices = (q.data ?? []).filter((t) => !t.hilo).sort((a, b) => b.creada.localeCompare(a.creada));
  const [elegida, setElegida] = useState<string | null>(null);
  const conv = elegida && raices.some((r) => r.id === elegida) ? elegida : raices[0]?.id ?? null;
  useEffect(() => { onConv(agente.id, conv); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agente.id, conv]);
  const e = figura ? estadoVisible(figura.estado, esperas, esSoloLectura(agente.config), esPausado(agente.config)) : null;
  return (
    <section className="zen-glass min-w-0 space-y-2 rounded-3xl p-3" aria-label={`Chat con ${nombreAgente(agente)}`} data-testid={`varios-panel-${agente.id}`}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{nombreAgente(agente)}</h3>
        {e && <span className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-xs" data-testid={`varios-estado-${agente.id}`}><span aria-hidden>{e.marca}</span>{e.texto}</span>}
        <label className="ml-auto inline-flex min-h-11 items-center gap-2 text-xs">
          <input type="checkbox" checked={marcado} onChange={onMarcar} className="h-4 w-4" data-testid={`varios-marcar-${agente.id}`} />Escribirle
        </label>
        <a href={urlChat(agente.id, { conv })} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-border/60 px-3 text-xs" data-testid={`varios-pestana-${agente.id}`}>Abrir en pestaña</a>
        <Link to={urlChat(agente.id, { conv, abiertos })} className="inline-flex min-h-11 items-center rounded-full border border-border/60 px-3 text-xs">Abrir el chat</Link>
      </header>
      {raices.length > 1 && (
        <select className="min-h-11 w-full rounded-md border border-input bg-background px-2 text-xs" aria-label={`Conversación de ${nombreAgente(agente)}`} value={conv ?? ""} onChange={(ev) => setElegida(ev.target.value)} data-testid={`varios-conv-${agente.id}`}>
          {raices.slice(0, 12).map((r) => <option key={r.id} value={r.id}>{r.titulo || "Solicitud sin título"}</option>)}
        </select>
      )}
      {q.isLoading ? <p className="text-sm text-muted-foreground">Leyendo sus conversaciones…</p>
        : conv ? <HiloAgente key={conv} taskId={conv} ahora={ahora} sinCuadro claseAlto="h-[min(60vh,34rem)] min-h-[18rem]" />
        : <p className="text-sm text-muted-foreground" data-testid={`varios-vacio-${agente.id}`}>Aún no hay conversación con {nombreAgente(agente)}. Escribe abajo, con él marcado, para empezar una.</p>}
    </section>
  );
}

function CuadroUnico({ destinos }: { destinos: Destino[] }) {
  const instruir = useInstruirAgente();
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Array<{ id: string; nombre: string; ok: boolean; mensaje: string }>>([]);
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    const t = texto.trim();
    if (!t || destinos.length === 0 || enviando) return;
    setEnviando(true);
    const res = await Promise.all(destinos.map(async ({ agente, conv }) => {
      const nombre = nombreAgente(agente);
      // Si el agente está trabajando en esa conversación, no se le encima otra tarea: la persona espera a que termine (igual que en su chat).
      if (conv && qc.getQueryData<RespuestaHilo>(["agentes-seguimiento", "hilo", conv])?.en_curso) return { id: agente.id, nombre, ok: false, mensaje: "Está trabajando en esa conversación; espera a que termine." };
      try {
        await instruir.mutateAsync(conv ? { agent_id: agente.id, title: `Seguimiento: ${t.slice(0, 60)}`, instructions: t, hilo_id: conv } : { agent_id: agente.id, title: tituloDe(t), instructions: t });
        return { id: agente.id, nombre, ok: true, mensaje: "Enviado." };
      } catch (e) { return { id: agente.id, nombre, ok: false, mensaje: (e as Error).message }; }
    }));
    setResultados(res); setEnviando(false);
    if (res.some((r) => r.ok)) { setTexto(""); void qc.invalidateQueries({ queryKey: ["agentes-seguimiento"] }); }
  };
  return (
    <section className="zen-glass space-y-2 rounded-3xl p-3" aria-label="Escribir a los agentes marcados" data-testid="varios-cuadro">
      <label htmlFor="varios-texto" className="block text-sm font-medium">Escribir a: {destinos.length === 0 ? "ningún agente marcado" : destinos.map((d) => nombreAgente(d.agente)).join(", ")}</label>
      <Textarea id="varios-texto" rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} data-testid="varios-texto" disabled={destinos.length === 0}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void enviar(); } }}
        placeholder={destinos.length === 0 ? "Marca a quién le escribes (casilla «Escribirle»)." : "Un solo mensaje para los agentes marcados. Marca solo uno para escribirle a uno."} />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void enviar()} disabled={!texto.trim() || destinos.length === 0 || enviando} data-testid="varios-enviar">
          {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{destinos.length > 1 ? `Enviar a ${destinos.length} agentes` : "Enviar"}
        </Button>
        <span className="text-xs text-muted-foreground">Ctrl + Enter para enviar. Sin accesos de 1Password ni permiso de escribir en sitios: eso se autoriza en el chat de cada agente.</span>
      </div>
      {resultados.length > 0 && (
        <ul className="space-y-0.5 text-sm" aria-label="Resultado del envío" data-testid="varios-resultados">
          {resultados.map((r) => <li key={r.id} role={r.ok ? undefined : "alert"} className={r.ok ? "" : "text-destructive"}>{r.nombre}: {r.mensaje}</li>)}
        </ul>
      )}
    </section>
  );
}

export function EspacioVarios({ agentes, visibles, figuras, tareas, abiertos, ahora }: { agentes: AgenteRegistro[]; visibles: string[]; figuras: FiguraOficina[]; tareas: TareaAgente[]; abiertos: string[]; ahora: Date }) {
  const [marcados, setMarcados] = useState<string[]>([]);
  const [convs, setConvs] = useState<Record<string, string | null>>({});
  // Al cambiar los agentes que se ven, se marcan todos por defecto (se puede desmarcar): lo común es escribirles a los que se están viendo.
  const firma = visibles.join(",");
  useEffect(() => { setMarcados(visibles); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [firma]);
  const lista = visibles.map((id) => agentes.find((a) => a.id === id)).filter((a): a is AgenteRegistro => !!a && a.kind !== "system");
  const destinos: Destino[] = lista.filter((a) => marcados.includes(a.id)).map((a) => ({ agente: a, conv: convs[a.id] ?? null }));
  return (
    <div className="space-y-3" data-testid="espacio-varios">
      <div className="grid gap-3 md:grid-cols-2">
        {lista.map((a) => (
          <Panel key={a.id} agente={a} figura={figuras.find((f) => f.id === a.id)} esperas={esperasDe(a.id, tareas)} abiertos={abiertos} ahora={ahora}
            marcado={marcados.includes(a.id)} onMarcar={() => setMarcados((m) => (m.includes(a.id) ? m.filter((x) => x !== a.id) : [...m, a.id]))}
            onConv={(id, conv) => setConvs((c) => (c[id] === conv ? c : { ...c, [id]: conv }))} />
        ))}
      </div>
      {lista.length === 0 && <p className="zen-glass rounded-2xl p-4 text-sm text-muted-foreground" data-testid="varios-sin-agentes">Abre al menos un agente para verlo aquí.</p>}
      <CuadroUnico destinos={destinos} />
    </div>
  );
}
