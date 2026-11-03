import { useEffect, useMemo, useState } from "react";
import { Pastilla, Vacio } from "./marketingUi";
import {
  cuandoRelativo, nombreAgente, ordenarAgentes, resumenServicio, senalAgente, SENAL_ETIQUETA, tareasRecientes, tasaExito,
  type AgenteRegistro, type TareaAgente,
} from "./agentesRegistro";

export type EstadoCarga = "cargando" | "error" | "ok";

// Agentes del registro de kawiil-central (solo lectura): estado, latido, tareas y quién los opera. No ejecuta ni despacha nada.
export function AgentesRegistro({ agentes, tareas, estadoAgentes, estadoTareas, ahora }: {
  agentes: AgenteRegistro[]; tareas: TareaAgente[]; estadoAgentes: EstadoCarga; estadoTareas: EstadoCarga; ahora?: Date;
}) {
  const [reloj, setReloj] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setReloj(new Date()), 60_000); return () => clearInterval(t); }, []);
  const now = ahora ?? reloj;
  const [archivados, setArchivados] = useState(false);
  const [agenteId, setAgenteId] = useState("");
  const [soloFallas, setSoloFallas] = useState(false);
  const [dias, setDias] = useState<number | null>(30);

  const visibles = useMemo(() => ordenarAgentes(archivados ? agentes : agentes.filter((a) => a.status !== "archived"), now), [agentes, archivados, now]);
  const servicio = useMemo(() => resumenServicio(agentes, now), [agentes, now]);
  const lista = useMemo(() => tareasRecientes(tareas, agentes, now, { dias, agenteId: agenteId || null, soloFallas }), [tareas, agentes, now, dias, agenteId, soloFallas]);

  if (estadoAgentes === "error") return <Vacio>No pudimos leer el registro de agentes de kawiil-central. Inténtalo de nuevo.</Vacio>;
  if (estadoAgentes === "cargando") return <Vacio>Leyendo el registro de agentes…</Vacio>;

  return (
    <div className="space-y-6" data-testid="agentes-registro">
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

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Agentes del registro</h2>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={archivados} onChange={(e) => setArchivados(e.target.checked)} /> Mostrar archivados</label>
        </div>
        {visibles.length === 0 ? <Vacio>No hay agentes en el registro.</Vacio> : (
          <div className="grid gap-4 md:grid-cols-3">
            {visibles.map((a) => {
              const s = SENAL_ETIQUETA[senalAgente(a, now)], tasa = tasaExito(a);
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
