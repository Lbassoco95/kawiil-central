import { useEffect, useRef, useState } from "react";
import { GraduationCap, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cuandoRelativo, nombreAgente, type AgenteRegistro, type TareaAgente } from "@/lib/agentes/registro";
import { useEnsenarAgente, useEstadoHabilidad, useGuardarHabilidad } from "@/hooks/useAgenteConstructor";
import { AVISO_SECRETO, pareceSecreto, type MensajeChat } from "../../../supabase/functions/_shared/agenteConstructor";
import type { EstadoHabilidad, Habilidad, HabilidadBorrador } from "../../../supabase/functions/_shared/habilidades";

// «Enseñar»: Dirección le cuenta a un agente cómo se hace una tarea (y/o le señala una que ya hizo) y el asistente arma una
// habilidad. Tú la revisas y decides: guardarla como borrador o aprobarla. Solo las aprobadas las usa el agente, y una
// habilidad NO le da permisos nuevos (dominios, accesos y límites siguen siendo los del agente). El agente nunca las
// crea ni las cambia por su cuenta.
export const ensenable = (a: AgenteRegistro) =>
  a.status !== "archived" && a.kind !== "system" && (a.config as { origen?: string } | null)?.origen === "constructor_agentes";
export const habilidadesDe = (a?: AgenteRegistro): Habilidad[] => {
  const h = (a?.config as { habilidades?: unknown } | null | undefined)?.habilidades;
  return Array.isArray(h) ? (h as Habilidad[]).filter((x) => x && typeof x.id === "string") : [];
};
const ETIQUETA: Record<EstadoHabilidad, string> = { borrador: "Borrador (no se usa)", aprobada: "Aprobada (en uso)", archivada: "Archivada" };

function Lista({ titulo, items, numerada }: { titulo: string; items: string[]; numerada?: boolean }) {
  if (!items.length) return null;
  const Tag = numerada ? "ol" : "ul";
  return <div><p className="text-xs font-medium text-muted-foreground">{titulo}</p><Tag className={`${numerada ? "list-decimal" : "list-disc"} pl-5 text-sm`}>{items.map((x, i) => <li key={i}>{x}</li>)}</Tag></div>;
}

export function TarjetaHabilidad({ h, onGuardar, guardando, error }: { h: HabilidadBorrador; onGuardar: (estado: "borrador" | "aprobada") => void; guardando: boolean; error: string | null }) {
  return (
    <div className="zen-glass space-y-3 rounded-2xl border border-primary/30 p-4" data-testid="ensenar-propuesta">
      <p className="text-base font-semibold">{h.nombre}</p>
      <p className="text-sm"><span className="text-xs font-medium text-muted-foreground">Cuándo usarla: </span>{h.cuando_usarla}</p>
      <Lista titulo="Necesita" items={h.entradas} />
      <Lista titulo="Pasos" items={h.pasos} numerada />
      {h.resultado_esperado && <p className="text-sm"><span className="text-xs font-medium text-muted-foreground">Resultado esperado: </span>{h.resultado_esperado}</p>}
      <Lista titulo="Precauciones" items={h.precauciones} />
      <p className="text-xs text-muted-foreground">Revisa que no incluya datos de un cliente concreto. No agrega permisos: el agente seguirá limitado a sus dominios, accesos y reglas. Si quieres cambios, díselos al asistente.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onGuardar("borrador")} disabled={guardando} data-testid="ensenar-borrador">Guardar como borrador</Button>
        <Button onClick={() => onGuardar("aprobada")} disabled={guardando} data-testid="ensenar-aprobar">
          {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Aprobar y activar
        </Button>
      </div>
    </div>
  );
}

export function EnsenarAgente({ agentes, tareas, ahora = new Date() }: { agentes: AgenteRegistro[]; tareas: TareaAgente[]; ahora?: Date }) {
  const lista = agentes.filter(ensenable);
  const [agenteId, setAgenteId] = useState("");
  const agente = lista.find((a) => a.id === agenteId);
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [texto, setTexto] = useState("");
  const [tareaId, setTareaId] = useState("");
  const [borrador, setBorrador] = useState<HabilidadBorrador | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [guardada, setGuardada] = useState<string | null>(null);
  const chat = useEnsenarAgente();
  const guardar = useGuardarHabilidad();
  const estado = useEstadoHabilidad();
  const fin = useRef<HTMLDivElement>(null);
  useEffect(() => { fin.current?.scrollIntoView?.({ block: "nearest" }); }, [mensajes, borrador]);
  useEffect(() => { setMensajes([]); setBorrador(null); setFallo(null); setGuardada(null); setTareaId(""); guardar.reset(); estado.reset(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agenteId]);

  const recientes = tareas.filter((t) => t.agent_id === agenteId && t.status === "completed").slice(0, 10);
  const enviar = () => {
    const t = texto.trim();
    if (!t || !agente || chat.isPending) return;
    if (pareceSecreto(t)) { setFallo(AVISO_SECRETO); setTexto(""); return; }  // un secreto no sale del navegador
    const siguiente: MensajeChat[] = [...mensajes, { role: "user", content: t }];
    setMensajes(siguiente); setTexto(""); setFallo(null); setGuardada(null);
    chat.mutate({ agent_id: agente.id, mensajes: siguiente, task_id: tareaId || undefined }, {
      onSuccess: (r) => {
        if (r.secreto) { setMensajes(mensajes); setFallo(r.texto); return; }
        setMensajes((m) => [...m, { role: "assistant", content: r.texto }]);
        if (r.habilidad) setBorrador(r.habilidad);
        else if (r.avisos?.length) setFallo(`La habilidad quedó incompleta: ${r.avisos.join(" ")} Pídele al asistente que la corrija.`);
      },
      onError: (e) => setFallo((e as Error).message),
    });
  };
  const guardarBorrador = (est: "borrador" | "aprobada") => {
    if (!agente || !borrador) return;
    guardar.mutate({ agent_id: agente.id, habilidad: borrador, estado: est, task_id: tareaId || undefined }, {
      onSuccess: () => { setGuardada(est === "aprobada" ? `«${borrador.nombre}» quedó aprobada: ${nombreAgente(agente)} la usará desde su próxima tarea.` : `«${borrador.nombre}» quedó como borrador (no se usa hasta que la apruebes).`); setBorrador(null); },
    });
  };
  const habilidades = habilidadesDe(agente);

  return (
    <div className="space-y-3" data-testid="ensenar">
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><GraduationCap className="h-4 w-4" />Cuéntale cómo se hace una tarea, o elige una que ya hizo, y se convierte en una habilidad que tú revisas. El agente no cambia sus habilidades solo.</p>
      {lista.length === 0 ? <p className="zen-glass rounded-2xl p-4 text-sm text-muted-foreground" data-testid="ensenar-vacio">Aún no hay agentes creados desde el constructor.</p> : (
        <>
          <label className="block space-y-1 text-sm">Agente
            <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={agenteId} onChange={(e) => setAgenteId(e.target.value)} data-testid="ensenar-agente">
              <option value="">Elige un agente…</option>
              {lista.map((a) => <option key={a.id} value={a.id}>{nombreAgente(a)} — {habilidadesDe(a).filter((h) => h.estado === "aprobada").length} habilidades en uso</option>)}
            </select>
          </label>
          {agente && (
            <>
              <div className="zen-glass space-y-2 rounded-2xl p-3" data-testid="ensenar-habilidades">
                <p className="text-xs font-medium text-muted-foreground">Habilidades de {nombreAgente(agente)}</p>
                {habilidades.length === 0 ? <p className="text-sm text-muted-foreground">Todavía ninguna.</p> : habilidades.map((h) => (
                  <details key={h.id} className="rounded-xl border border-border/50 p-2 text-sm" data-testid={`habilidad-${h.id}`}>
                    <summary className="cursor-pointer"><strong>{h.nombre}</strong> · v{h.version} · {ETIQUETA[h.estado]}</summary>
                    <p className="mt-2 text-xs text-muted-foreground">{h.cuando_usarla}</p>
                    <ol className="mt-1 list-decimal pl-5 text-xs">{h.pasos.map((p, i) => <li key={i}>{p}</li>)}</ol>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {h.estado !== "aprobada" && h.estado !== "archivada" && <Button size="sm" onClick={() => estado.mutate({ agent_id: agente.id, id: h.id, estado: "aprobada" })} data-testid={`aprobar-${h.id}`}>Aprobar</Button>}
                      {h.estado === "aprobada" && <Button size="sm" variant="outline" onClick={() => estado.mutate({ agent_id: agente.id, id: h.id, estado: "borrador" })} data-testid={`desactivar-${h.id}`}>Desactivar</Button>}
                      {h.estado !== "archivada" && <Button size="sm" variant="outline" onClick={() => estado.mutate({ agent_id: agente.id, id: h.id, estado: "archivada" })} data-testid={`archivar-${h.id}`}>Archivar</Button>}
                      {h.estado === "archivada" && <Button size="sm" variant="outline" onClick={() => estado.mutate({ agent_id: agente.id, id: h.id, estado: "borrador" })}>Restaurar como borrador</Button>}
                    </div>
                  </details>
                ))}
                {estado.isError && <p role="alert" className="text-sm text-destructive">{(estado.error as Error).message}</p>}
              </div>
              <div className="zen-glass space-y-3 rounded-3xl p-4">
                {recientes.length > 0 && (
                  <label className="block space-y-1 text-sm">Ejemplo real (opcional): una tarea que ya hizo
                    <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={tareaId} onChange={(e) => setTareaId(e.target.value)} data-testid="ensenar-tarea">
                      <option value="">Sin ejemplo: te lo cuento yo</option>
                      {recientes.map((t) => <option key={t.id} value={t.id}>{t.task_type} · {cuandoRelativo(t.completed_at ?? t.created_at, ahora)}</option>)}
                    </select>
                  </label>
                )}
                <div className="max-h-[40vh] space-y-3 overflow-y-auto" aria-live="polite">
                  {mensajes.length === 0 && <p className="rounded-2xl bg-muted/50 p-3 text-sm">Cuéntame cómo se hace la tarea paso a paso: cuándo se usa, qué necesita y cómo se ve un buen resultado. Si elegiste un ejemplo, dime qué hizo bien o qué hay que corregir.</p>}
                  {mensajes.map((m, i) => <p key={i} data-testid={`ensenar-msg-${m.role}`} className={`whitespace-pre-wrap rounded-2xl p-3 text-sm ${m.role === "user" ? "ml-8 bg-primary/10" : "mr-8 bg-muted/50"}`}>{m.content}</p>)}
                  {chat.isPending && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Pensando…</p>}
                  <div ref={fin} />
                </div>
                {fallo && <p role="alert" className="text-sm text-destructive" data-testid="ensenar-error">{fallo}</p>}
                <div className="flex items-end gap-2">
                  <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder="Explica el procedimiento…" aria-label="Mensaje para el Maestro de Habilidades"
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }} />
                  <Button onClick={enviar} disabled={chat.isPending || !texto.trim()} aria-label="Enviar" data-testid="ensenar-enviar"><Send className="h-4 w-4" /></Button>
                </div>
              </div>
              {borrador && <TarjetaHabilidad h={borrador} onGuardar={guardarBorrador} guardando={guardar.isPending} error={guardar.isError ? (guardar.error as Error).message : null} />}
              {guardada && <p className="zen-glass rounded-2xl p-3 text-sm" role="status" data-testid="ensenar-guardada">{guardada}</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}
