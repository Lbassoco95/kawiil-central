import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { Caso, FilaBitacora, TrabajoCron } from "@/hooks/useMarketing";
import { RED_LABEL } from "@/hooks/useMarketing";
import { Pastilla, Vacio } from "./marketingUi";
import { cuandoLegible, etiquetaAgente, flujo, lineaDeTiempo, tarjetas, type EstadoAgente } from "./agentesLogica";
import { tipoCaso } from "./PanelDia";

const ESTADO: Record<EstadoAgente, { etiqueta: string; color: string }> = {
  correcta: { etiqueta: "Correcta", color: "verde" }, con_falla: { etiqueta: "Con falla", color: "rojo" },
  no_corrio: { etiqueta: "No corrió", color: "rojo" }, pausado: { etiqueta: "Pausado", color: "gris" }, sin_datos: { etiqueta: "Sin datos", color: "gris" },
};
export type EstadoCarga = "cargando" | "error" | "ok";

// Vista «Agentes» (solo lectura): qué hizo cada agente, cuándo vuelve a correr, si falló y a qué caso se refiere.
// Sale de la bitácora, los casos, las propuestas y las decisiones; el horario real de los trabajos, de mk_agentes_estado() si existe.
export function Agentes({ filas, casos, propuestas, decisiones, trabajos, estadoBitacora, ahora }: {
  filas: FilaBitacora[]; casos: Caso[]; propuestas: { estado: string }[]; decisiones: { decision: string }[];
  trabajos: { disponible: boolean; trabajos: TrabajoCron[] } | undefined; estadoBitacora: EstadoCarga; ahora?: Date;
}) {
  const [reloj, setReloj] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setReloj(new Date()), 60_000); return () => clearInterval(t); }, []);
  const now = ahora ?? reloj;
  const [agente, setAgente] = useState<string>("");
  const [soloFallas, setSoloFallas] = useState(false);
  const [casoNumero, setCasoNumero] = useState<number | null>(null);
  const [dias, setDias] = useState(7);

  const lista = trabajos?.trabajos ?? [];
  const cards = useMemo(() => tarjetas(filas, lista, propuestas.length > 0, now), [filas, lista, propuestas.length, now]);
  const fl = useMemo(() => flujo(casos, propuestas, decisiones, filas), [casos, propuestas, decisiones, filas]);
  const linea = useMemo(() => lineaDeTiempo(filas, casos, now, { dias, agente: agente || null, soloFallas, casoNumero }), [filas, casos, now, dias, agente, soloFallas, casoNumero]);
  const agentesEnBitacora = useMemo(() => [...new Set(filas.map((f) => f.agente))].sort(), [filas]);

  if (estadoBitacora === "error") return <Vacio>No pudimos leer la bitácora de agentes. Revisa tu permiso de Marketing e inténtalo de nuevo.</Vacio>;
  if (estadoBitacora === "cargando") return <Vacio>Leyendo la bitácora de agentes…</Vacio>;

  return (
    <div className="space-y-6" data-testid="vista-agentes">
      {trabajos && !trabajos.disponible && (
        <div className="zen-glass rounded-2xl p-3 text-xs text-muted-foreground" data-testid="agentes-aviso-catalogo">
          Los horarios de esta pantalla son los previstos (catálogo fijo): todavía no se puede leer el estado real de los trabajos programados, así que no se detectaría un trabajo pausado.
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Agentes</h2>
        {cards.length === 0 ? <Vacio>Todavía no hay agentes con actividad.</Vacio> : (
          <div className="grid gap-4 md:grid-cols-3">
            {cards.map((t) => {
              const e = ESTADO[t.estado];
              return (
                <div key={t.def.id} className="zen-glass space-y-2 rounded-2xl p-4" data-testid={`agente-${t.def.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-base font-medium">{t.def.nombre}</p>
                    <Pastilla color={e.color}>{e.etiqueta}</Pastilla>
                  </div>
                  <p className="text-xs text-muted-foreground">{t.def.descripcion}</p>
                  <dl className="space-y-1 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Última corrida</dt><dd>{t.ultima ? cuandoLegible(t.ultima, now) : "—"}{t.fueDePrueba && " (prueba)"}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted-foreground">Resultado</dt><dd className="text-right" data-testid="agente-resultado">{t.resultado ?? "—"}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Próxima</dt><dd>{t.pausado ? "pausado" : t.proxima ? cuandoLegible(t.proxima, now) : "—"}</dd></div>
                  </dl>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section data-testid="agentes-flujo">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Flujo de un caso</h2>
        <div className="zen-glass flex flex-wrap items-stretch gap-2 rounded-2xl p-4 text-sm">
          <Paso titulo="Casos" lineas={[`${fl.casos.abierto} abiertos`, `${fl.casos.en_investigacion} en investigación`, `${fl.casos.en_decision} en decisión`, `${fl.casos.cerrado} cerrados`]} />
          {fl.revisor && (<><Flecha /><Paso titulo="Revisor" lineas={["Investiga y propone"]} /></>)}
          <Flecha />
          <Paso titulo="Propuestas" lineas={fl.propuestas.total === 0 ? ["0"] : [`${fl.propuestas.pendiente} pendientes`, `${fl.propuestas.aprobada} aprobadas`, `${fl.propuestas.rechazada} rechazadas`, `${fl.propuestas.ajuste_solicitado} con ajuste`]} />
          <Flecha />
          <Paso titulo="Decisión de Dirección" lineas={fl.decisiones.total === 0 ? ["0"] : [`${fl.decisiones.aprobada} aprobadas`, `${fl.decisiones.rechazada} rechazadas`, `${fl.decisiones.ajuste_solicitado} ajustes`]} />
        </div>
        {!fl.revisor && <p className="mt-2 text-xs text-muted-foreground">El Revisor todavía no existe: aparecerá aquí cuando tenga su primera corrida o propuesta.</p>}
      </section>

      <section data-testid="agentes-linea">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Línea de tiempo</h2>
          <select aria-label="Filtrar por agente" className="rounded-lg border border-border bg-background px-2 py-1 text-xs" value={agente} onChange={(e) => setAgente(e.target.value)}>
            <option value="">Todos los agentes</option>
            {agentesEnBitacora.map((a) => <option key={a} value={a}>{etiquetaAgente(a)}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={soloFallas} onChange={(e) => setSoloFallas(e.target.checked)} /> Solo fallas</label>
          {casoNumero !== null && (
            <button type="button" className="rounded-full border border-border px-2.5 py-0.5 text-xs" onClick={() => setCasoNumero(null)}>Caso #{casoNumero} ✕</button>
          )}
        </div>
        {linea.length === 0 ? <Vacio>No hay actividad con esos filtros en los últimos {dias} días.</Vacio> : (
          <div className="space-y-4">
            {linea.map((d) => (
              <div key={d.dia}>
                <p className="mb-1 text-xs font-medium capitalize text-muted-foreground">{d.etiqueta}</p>
                <ul className="zen-glass divide-y divide-border/40 rounded-2xl">
                  {d.eventos.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 p-3 text-sm" data-testid={`evento-${e.id}`}>
                      <span className="w-12 shrink-0 text-xs text-muted-foreground">{e.hora}</span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{e.agenteEtiqueta}</span> · {e.accionEtiqueta}{e.prueba && " (prueba)"}
                        <span className="block text-muted-foreground">{e.resultado}</span>
                      </span>
                      {e.falla && <Pastilla color="rojo">Falla</Pastilla>}
                      {e.caso && (
                        <button type="button" className="rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-muted" title="Filtrar la línea de tiempo por este caso" onClick={() => setCasoNumero(e.caso!.numero)}>
                          #{e.caso.numero} {tipoCaso(e.caso.tipo)}{e.caso.red ? ` · ${RED_LABEL[e.caso.red as keyof typeof RED_LABEL] ?? e.caso.red}` : ""}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {dias < 30 && <button type="button" className="mt-3 text-xs underline" onClick={() => setDias(30)}>Ver 30 días</button>}
      </section>
    </div>
  );
}

function Paso({ titulo, lineas }: { titulo: string; lineas: string[] }) {
  return (
    <div className="min-w-[8rem] rounded-xl bg-background/50 p-3">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{titulo}</p>
      {lineas.map((l) => <p key={l} className="text-sm">{l}</p>)}
    </div>
  );
}
const Flecha = () => <ArrowRight aria-hidden className="mt-6 h-4 w-4 shrink-0 text-muted-foreground" />;
