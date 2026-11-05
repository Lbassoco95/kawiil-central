import { useEffect, useMemo, useState } from "react";
import { Pastilla, Vacio } from "./marketingUi";
import {
  agentesLentos, cuandoRelativo, cumplimiento, agentesDelModulo, esAgenteDeMarketing, esAgenteLegal, saludLegal, ultimoErrorPorAgente, esSistema, nombreAgente, ordenarAgentes, resumenServicio, senalAgente, SENAL_ETIQUETA, tareasRecientes, tasaExito, ultimaTareaDe,
  type AgenteRegistro, type ErrorTarea, type TareaAgente, type TareaMarketing,
} from "@/lib/agentes/registro";

export type EstadoCarga = "cargando" | "error" | "ok";

// Agentes del registro de kawiil-central (solo lectura): estado, latido, tareas y quién los opera. No ejecuta ni despacha nada.
// `soloMarketing`: la pestaña de Marketing muestra SOLO sus 3 agentes de sistema (marketing_*). Los demás agentes del registro
// (los de Cerebro / kawiil-agents) no se mezclan aquí: tienen su propio módulo.
export function AgentesRegistro({ agentes: todos, tareas: todasLasTareas, estadoAgentes, estadoTareas, ahora, tareasMarketing = [], errores = [], soloMarketing = false, sinMarketing = false }: {
  agentes: AgenteRegistro[]; tareas: TareaAgente[]; estadoAgentes: EstadoCarga; estadoTareas: EstadoCarga; ahora?: Date; tareasMarketing?: TareaMarketing[]; errores?: ErrorTarea[]; soloMarketing?: boolean; sinMarketing?: boolean;
}) {
  // `sinMarketing`: módulo Agentes (/agentes), que excluye a los agentes de Marketing.
  const agentes = useMemo(() => (soloMarketing ? todos.filter(esAgenteDeMarketing) : sinMarketing ? agentesDelModulo(todos) : todos), [todos, soloMarketing, sinMarketing]);
  const tareas = useMemo(() => {
    if (!soloMarketing && !sinMarketing) return todasLasTareas;
    const ids = new Set(agentes.map((a) => a.id));
    return todasLasTareas.filter((t) => t.agent_id !== null && ids.has(t.agent_id));
  }, [todasLasTareas, agentes, soloMarketing, sinMarketing]);
  const [reloj, setReloj] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setReloj(new Date()), 60_000); return () => clearInterval(t); }, []);
  const now = ahora ?? reloj;
  const [archivados, setArchivados] = useState(false);
  const [agenteId, setAgenteId] = useState("");
  const [soloFallas, setSoloFallas] = useState(false);
  const [dias, setDias] = useState<number | null>(30);

  const visibles = useMemo(() => ordenarAgentes(archivados ? agentes : agentes.filter((a) => a.status !== "archived"), now), [agentes, archivados, now]);
  const servicio = useMemo(() => resumenServicio(agentes, now), [agentes, now]);
  const salud = useMemo(() => saludLegal(agentes, now), [agentes, now]);
  const lentos = useMemo(() => agentesLentos(agentes, tareas), [agentes, tareas]);
  const ultimosErrores = useMemo(() => ultimoErrorPorAgente(errores), [errores]);
  const lista = useMemo(() => tareasRecientes(tareas, agentes, now, { dias, agenteId: agenteId || null, soloFallas }), [tareas, agentes, now, dias, agenteId, soloFallas]);

  if (estadoAgentes === "error") return <Vacio>No pudimos leer el registro de agentes de kawiil-central. Inténtalo de nuevo.</Vacio>;
  if (estadoAgentes === "cargando") return <Vacio>Leyendo el registro de agentes…</Vacio>;

  return (
    <div className="space-y-6" data-testid="agentes-registro">
      {sinMarketing && salud.estado === "alerta" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm" data-testid="alerta-legal">
          <Pastilla color="rojo">Revisión legal detenida</Pastilla>
          <span>
            {salud.sinVida} de {salud.total} agentes legales sin vida: nadie está revisando el DOF ni la Suprema Corte.{" "}
            <span className="text-muted-foreground">{salud.sinVidaNombres.map((x) => `${x.nombre} (${SENAL_ETIQUETA[x.senal].etiqueta.toLowerCase()})`).join(", ")}.</span>
          </span>
        </div>
      )}
      {lentos.length > 0 && (
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-amber-300/60 bg-amber-100/50 p-4 text-sm dark:border-amber-700/50 dark:bg-amber-900/20" data-testid="alerta-lentitud">
          <Pastilla color="amarillo">Respuestas lentas</Pastilla>
          <div className="min-w-0 flex-1 space-y-1">
            <p>
              {lentos.length === 1 ? "Un agente tarda" : `${lentos.length} agentes tardan`} mucho en contestar: lo normal son segundos y aquí pasan de minutos. Cerca de los 10 minutos la tarea se agota por tiempo.
            </p>
            <ul className="text-xs text-muted-foreground">
              {lentos.map((l) => (
                <li key={l.id} data-testid={`lento-${l.id}`}>
                  <span className="font-medium text-foreground">{l.nombre}</span>: {l.mediana} por tarea en promedio (sus últimas {l.tareas} terminadas){l.nivel === "muy_lento" ? ", en el límite de espera" : ""}.
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Suele deberse a la conexión del servicio con el modelo, no a la tarea. Conviene revisarlo en el servicio kawiil-agents.</p>
          </div>
        </div>
      )}
      {!soloMarketing && (
      <div className="zen-glass flex flex-wrap items-center gap-3 rounded-2xl p-4 text-sm" data-testid="registro-servicio">
        <Pastilla color={servicio.estado === "en_linea" ? "verde" : servicio.estado === "sin_senal" ? "rojo" : "gris"}>
          {servicio.estado === "en_linea" ? "Servicio en línea" : servicio.estado === "sin_senal" ? "Servicio sin señal" : "Sin datos del servicio"}
        </Pastilla>
        <span>
          El servicio <span className="font-medium">kawiil-agents</span> escribe estos agentes. Último latido de cualquiera: {cuandoRelativo(servicio.ultimoLatido, now)}.
        </span>
        <span className="text-muted-foreground">
          {servicio.activos} activos · {servicio.enLinea} en línea{servicio.atascados > 0 && ` · ${servicio.atascados} atascados`}{servicio.sinSenal > 0 && ` · ${servicio.sinSenal} sin señal`}
        </span>
      </div>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{soloMarketing ? "Agentes de Marketing en el registro" : "Agentes del registro"}</h2>
          {!soloMarketing && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={archivados} onChange={(e) => setArchivados(e.target.checked)} /> Mostrar archivados</label>}
        </div>
        {visibles.length === 0 ? <Vacio>No hay agentes en el registro.</Vacio> : (
          <div className="grid gap-4 md:grid-cols-3">
            {visibles.map((a) => {
              const s = SENAL_ETIQUETA[senalAgente(a, now)], tasa = tasaExito(a);
              const cum = esSistema(a) ? cumplimiento(a, ultimaTareaDe(a, tareasMarketing), now) : null;
              const objetivo = esSistema(a) && typeof a.config?.objetivo === "string" ? (a.config.objetivo as string) : null;
              return (
                <div key={a.id} className="zen-glass space-y-2 rounded-2xl p-4" data-testid={`registro-${a.name}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-base font-medium capitalize">{nombreAgente(a)}</p>
                    <Pastilla color={s.color}>{s.etiqueta}</Pastilla>
                  </div>
                  <p className="line-clamp-2 min-h-[2rem] text-xs text-muted-foreground">{a.description || a.role || "Sin descripción"}</p>
                  <dl className="space-y-1 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Estado</dt><dd>{a.status}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Último latido</dt><dd>{cuandoRelativo(a.last_heartbeat, now)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Última tarea</dt><dd>{cuandoRelativo(a.last_task_at, now)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Tareas</dt><dd data-testid="registro-tareas">{a.tasks_completed ?? 0} bien · {a.tasks_failed ?? 0} con error{tasa !== null && ` (${tasa} %)`}</dd></div>
                  </dl>
                  {esAgenteLegal(a) && ultimosErrores.get(a.id) && (
                    <p className="border-t border-border/40 pt-2 text-xs" data-testid={`ultimo-error-${a.name}`}>
                      <span className="text-muted-foreground">Último error: </span>{ultimosErrores.get(a.id)!.etiqueta} ({cuandoRelativo(ultimosErrores.get(a.id)!.cuando, now)}) · {ultimosErrores.get(a.id)!.repeticiones} {ultimosErrores.get(a.id)!.repeticiones === 1 ? "vez" : "veces"}
                    </p>
                  )}
                  {objetivo && (
                    <div className="space-y-1 border-t border-border/40 pt-2 text-xs" data-testid={`objetivo-${a.name}`}>
                      <p><span className="text-muted-foreground">Objetivo: </span>{objetivo}</p>
                      {cum && cum.estado !== "sin_datos" && (
                        <p className="flex items-start gap-2"><Pastilla color={cum.estado === "cumple" ? "verde" : "rojo"}>{cum.estado === "cumple" ? "Cumple" : "No cumple"}</Pastilla><span>{cum.texto}</span></p>
                      )}
                      {cum && cum.estado === "sin_datos" && <p className="text-muted-foreground">{cum.texto}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section data-testid="registro-tareas-lista">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Tareas recientes</h2>
          <select aria-label="Filtrar tareas por agente" className="rounded-lg border border-border bg-background px-2 py-1 text-xs" value={agenteId} onChange={(e) => setAgenteId(e.target.value)}>
            <option value="">Todos los agentes</option>
            {ordenarAgentes(agentes, now).map((a) => <option key={a.id} value={a.id}>{nombreAgente(a)}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={soloFallas} onChange={(e) => setSoloFallas(e.target.checked)} /> Solo con error</label>
        </div>
        {estadoTareas === "error" ? <Vacio>No pudimos leer las tareas de los agentes.</Vacio>
          : estadoTareas === "cargando" ? <Vacio>Leyendo tareas…</Vacio>
          : lista.length === 0 ? <Vacio>No hay tareas {dias === null ? "" : `en los últimos ${dias} días `}con esos filtros.</Vacio> : (
            <ul className="zen-glass divide-y divide-border/40 rounded-2xl">
              {lista.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm" data-testid={`tarea-${t.id}`}>
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">{cuandoRelativo(t.creada, now)}</span>
                  <span className="min-w-0 flex-1"><span className="font-medium capitalize">{t.agente}</span> · {t.tipo}{t.duracion && <span className="text-muted-foreground"> · {t.duracion}</span>}</span>
                  <Pastilla color={t.falla ? "rojo" : t.estado === "completed" ? "verde" : "gris"}>{t.etiqueta}</Pastilla>
                </li>
              ))}
            </ul>
          )}
        {dias !== null && <button type="button" className="mt-3 text-xs underline" onClick={() => setDias(null)}>Ver todo el historial</button>}
        <p className="mt-3 text-xs text-muted-foreground">Por privacidad no se muestran títulos, instrucciones ni resultados de las tareas, solo agente, tipo, estado y duración.</p>
      </section>
    </div>
  );
}
