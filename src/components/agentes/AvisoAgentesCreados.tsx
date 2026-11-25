import { useState } from "react";
import { Link } from "react-router-dom";
import { creacionDe } from "@/lib/agentes/equipos";
import { esPausado, esSoloLectura } from "@/lib/agentes/chat";
import { usePermisosAgente } from "@/hooks/useAgenteConstructor";
import { estaHabilitado } from "../../../supabase/functions/_shared/agentePermisos";
import { nombreAgente, type AgenteRegistro } from "@/lib/agentes/registro";
import { urlChat } from "@/lib/agentes/chat";

// Aviso en pantalla cuando un agente crea a otro (R1.e.4): quién lo creó, para qué, cuándo y con qué permisos. Solo en pantalla: sin correo ni mensajes.
// Decisión de Dirección (25 nov): todo agente creado por otro agente empieza en Solo lectura y una persona lo habilita. El aviso lo dice y ofrece:
// ver la oficina, revisar permisos, habilitarlo (con confirmación), pausarlo / reanudarlo y abrir su chat. Habilitar y pausar escriben solo `config.habilitado` / `config.pausado`.
export const DIAS_AVISO = 14;
const CLAVE = "agentes-aviso-creados-vistos";
const leerVistos = (): string[] => { try { const v = JSON.parse(localStorage.getItem(CLAVE) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
const guardarVistos = (v: string[]) => { try { localStorage.setItem(CLAVE, JSON.stringify(v.slice(-100))); } catch { /* sin almacenamiento: el aviso vuelve al recargar */ } };
const cuando = (iso: string) => new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function agentesCreadosPorAgentes(agentes: AgenteRegistro[], ahora: Date) {
  const desde = ahora.getTime() - DIAS_AVISO * 86_400_000;
  return agentes.flatMap((a) => {
    const c = creacionDe(a), creador = agentes.find((x) => x.id === c?.creadorId);
    if (a.status === "archived" || !c || c.tipo !== "agente" || !c.cuando || new Date(c.cuando).getTime() < desde || !creador) return [];
    return [{ agente: a, creador, creacion: c }];
  }).sort((x, y) => (y.creacion.cuando ?? "").localeCompare(x.creacion.cuando ?? "")).slice(0, 5);
}

export function AvisoAgentesCreados({ agentes, ahora, onVerOficina, onRevisarPermisos }: { agentes: AgenteRegistro[]; ahora: Date; onVerOficina: (jefeId: string) => void; onRevisarPermisos: (agenteId: string) => void }) {
  const [vistos, setVistos] = useState<string[]>(leerVistos);
  const permisos = usePermisosAgente();
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const lista = agentesCreadosPorAgentes(agentes, ahora).filter((x) => !vistos.includes(x.agente.id));
  if (lista.length === 0) return null;
  const marcar = (id: string) => { const n = [...vistos, id]; setVistos(n); guardarVistos(n); };
  return (
    <section aria-label="Agentes creados por otros agentes" className="space-y-2" data-testid="aviso-creados">
      {lista.map(({ agente, creador, creacion }) => {
        const lectura = esSoloLectura(agente.config), habilitado = estaHabilitado(agente.config), pausado = esPausado(agente.config);
        return (
          <div key={agente.id} role="status" className="zen-glass flex flex-wrap items-center gap-3 rounded-3xl border-2 border-violet-400/60 p-4" data-testid={`aviso-creado-${agente.id}`}>
            <div className="min-w-0 flex-1 basis-72 space-y-0.5">
              <p className="text-sm font-semibold">{nombreAgente(creador)} creó a {nombreAgente(agente)}</p>
              <p className="text-sm">Para qué: <span className="text-muted-foreground">{creacion.para ?? "no lo dijo"}</span></p>
              <p className="text-xs text-muted-foreground">Oficina de {nombreAgente(creador)} · {creacion.cuando ? cuando(creacion.cuando) : ""}</p>
              <p className="text-xs font-medium" data-testid={`aviso-permisos-texto-${agente.id}`}>
                {lectura ? "◇ Empieza en Solo lectura: no puede escribir ni usar accesos hasta que lo habilites." : habilitado ? "Permisos habilitados por una persona." : "Permisos: los que tiene configurados."}
                {pausado && " · ⏸ Pausado: no recibe tareas."}
              </p>
              {permisos.isError && <p role="alert" className="text-xs text-destructive">{(permisos.error as Error).message}</p>}
              {confirmando === agente.id && (
                <p className="text-xs" data-testid={`aviso-confirmar-${agente.id}`}>
                  Dejará de estar en Solo lectura y podrá usar los permisos que tenga configurados.{" "}
                  <button type="button" className="font-medium underline" disabled={permisos.isPending} data-testid={`aviso-habilitar-si-${agente.id}`}
                    onClick={() => permisos.mutate({ agent_id: agente.id, accion: "habilitar" }, { onSuccess: () => setConfirmando(null) })}>Sí, habilitarlo</button>{" · "}
                  <button type="button" className="underline" onClick={() => setConfirmando(null)}>Cancelar</button>
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onVerOficina(creador.id)} className="min-h-11 rounded-full border border-border/60 bg-background/70 px-4 text-sm font-medium" data-testid={`aviso-ver-${agente.id}`}>Ver en la oficina</button>
              <button type="button" onClick={() => onRevisarPermisos(agente.id)} className="min-h-11 rounded-full border border-border/60 bg-background/70 px-4 text-sm font-medium" data-testid={`aviso-permisos-${agente.id}`}>Revisar permisos</button>
              {lectura && <button type="button" onClick={() => setConfirmando(agente.id)} className="min-h-11 rounded-full border border-border/60 bg-background/70 px-4 text-sm font-medium" data-testid={`aviso-habilitar-${agente.id}`}>Habilitarlo</button>}
              <Link to={urlChat(agente.id)} className="inline-flex min-h-11 items-center rounded-full border border-border/60 bg-background/70 px-4 text-sm font-medium" data-testid={`aviso-chat-${agente.id}`}>Abrir el chat</Link>
              <button type="button" disabled={permisos.isPending} onClick={() => permisos.mutate({ agent_id: agente.id, accion: pausado ? "reanudar" : "pausar" })} className="min-h-11 rounded-full border border-border/60 bg-background/70 px-4 text-sm font-medium" data-testid={`aviso-pausar-${agente.id}`}>{pausado ? "Reanudarlo" : "Pausarlo"}</button>
              <button type="button" onClick={() => marcar(agente.id)} className="min-h-11 rounded-full px-3 text-sm underline" data-testid={`aviso-visto-${agente.id}`}>Entendido</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
