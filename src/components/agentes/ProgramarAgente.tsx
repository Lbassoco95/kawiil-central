import { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { etiquetaOpcion, nombreAgente, type AgenteRegistro } from "@/lib/agentes/registro";
import { useProgramarAgente } from "@/hooks/useAgenteConstructor";
import { etiquetasAccesos } from "@/components/agentes/InstruirAgente";
import { DIAS_SEMANA, pareceSecreto, AVISO_SECRETO, type Programacion } from "../../../supabase/functions/_shared/agenteConstructor";
import { FichaAgente } from "@/components/agentes/FichaAgente";

// Tareas recurrentes (solo Dirección). Guardar NO ejecuta nada al instante: el planificador de la VM corre la instrucción en
// el horario elegido y solo con los accesos que autorices aquí, sin que haya nadie presente. Puedes pausarla cuando quieras.
const cadenciaDe = (a?: AgenteRegistro) => (a?.config as { cadencia?: string } | null | undefined)?.cadencia;
export const programable = (a: AgenteRegistro) =>
  a.status !== "archived" && a.kind !== "system" && (a.config as { origen?: string } | null)?.origen === "constructor_agentes" && (cadenciaDe(a) === "diaria" || cadenciaDe(a) === "semanal");
export const programacionDe = (a?: AgenteRegistro): Partial<Programacion> =>
  ((a?.config as { programacion?: Partial<Programacion> } | null | undefined)?.programacion) ?? {};

export function resumenProgramacion(a: AgenteRegistro): string {
  const p = programacionDe(a), c = cadenciaDe(a);
  if (p.activa) return c === "semanal" ? `Activa · cada ${DIAS_SEMANA[p.dia_semana ?? 0]} a las ${p.hora}` : `Activa · todos los días a las ${p.hora}`;
  if (p.pausada_motivo) return `Pausada automáticamente: ${p.pausada_motivo}`;
  return "Sin programar";
}

export function ProgramarAgente({ agentes }: { agentes: AgenteRegistro[] }) {
  const lista = agentes.filter(programable);
  const [agenteId, setAgenteId] = useState("");
  const agente = lista.find((a) => a.id === agenteId);
  const [activa, setActiva] = useState(false);
  const [hora, setHora] = useState("08:00");
  const [dia, setDia] = useState(0);
  const [instruccion, setInstruccion] = useState("");
  const [aprobados, setAprobados] = useState<string[]>([]);
  const [guardado, setGuardado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const programar = useProgramarAgente();
  const accesos = etiquetasAccesos(agente);

  useEffect(() => {  // al elegir un agente se cargan sus valores guardados
    const p = programacionDe(agente);
    setActiva(p.activa === true); setHora(p.hora ?? "08:00"); setDia(p.dia_semana ?? 0); setInstruccion(p.instruccion ?? "");
    setAprobados((p.accesos_autorizados ?? []).filter((e) => accesos.some((a) => a.etiqueta === e))); setGuardado(false); setAviso(null); programar.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agenteId]);

  const guardar = () => {
    if (!agente) return;
    if (pareceSecreto(instruccion)) { setAviso(AVISO_SECRETO); return; }
    setAviso(null); setGuardado(false);
    programar.mutate({ agent_id: agente.id, programacion: { activa, hora, dia_semana: cadenciaDe(agente) === "semanal" ? dia : undefined, instruccion, accesos_autorizados: aprobados } },
      { onSuccess: () => setGuardado(true) });
  };

  return (
    <div className="zen-glass space-y-3 rounded-3xl p-4" data-testid="programar">
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarClock className="h-4 w-4" />Haz que un agente ejecute una instrucción solo, cada día o cada semana. Guardar no ejecuta nada en ese momento.</p>
      {lista.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="programar-vacio">Aún no hay agentes con cadencia diaria o semanal creados desde el constructor.</p> : (
        <>
          <label className="block space-y-1 text-sm">Agente
            <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={agenteId} onChange={(e) => setAgenteId(e.target.value)} data-testid="programar-agente">
              <option value="">Elige un agente…</option>
              {lista.map((a) => <option key={a.id} value={a.id}>{etiquetaOpcion(a)} — {resumenProgramacion(a)}</option>)}
            </select>
          </label>
          <FichaAgente agente={agente} />
          {agente && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} data-testid="programar-activa" />Programación activa</label>
              <div className="flex flex-wrap gap-3">
                <label className="space-y-1 text-sm">Hora (México)<Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} data-testid="programar-hora" /></label>
                {cadenciaDe(agente) === "semanal" && (
                  <label className="space-y-1 text-sm">Día
                    <select className="block rounded-md border border-input bg-background px-3 py-2 text-sm" value={dia} onChange={(e) => setDia(Number(e.target.value))} data-testid="programar-dia">
                      {DIAS_SEMANA.map((d, i) => <option key={d} value={i}>{d}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <label className="block space-y-1 text-sm">Instrucción que ejecutará cada vez
                <Textarea value={instruccion} onChange={(e) => setInstruccion(e.target.value)} rows={4} data-testid="programar-instruccion" placeholder="Revisa los documentos nuevos de Vizum y entrégame un informe con vencimientos y faltantes." />
              </label>
              {accesos.length > 0 && (
                <fieldset className="space-y-2 rounded-2xl border border-border/60 p-3 text-sm" data-testid="programar-accesos">
                  <legend className="px-1 text-xs font-medium text-muted-foreground">Accesos de 1Password: autorización permanente</legend>
                  <p className="text-xs text-muted-foreground">Sin nadie presente, el agente podrá iniciar sesión (solo para consultar) con los accesos que marques, cada vez que corra. Quita la marca o pausa la programación para revocarlo. Para SAT, CNBV o bancos, confirma antes que sus términos de uso permitan accesos automatizados.</p>
                  {accesos.map((a) => (
                    <label key={a.etiqueta} className="flex items-center gap-2">
                      <input type="checkbox" checked={aprobados.includes(a.etiqueta)} data-testid={`programar-acceso-${a.etiqueta}`}
                        onChange={(e) => setAprobados((p) => e.target.checked ? [...p, a.etiqueta] : p.filter((x) => x !== a.etiqueta))} />
                      Autorizo «{a.etiqueta}» en {a.dominio}
                    </label>
                  ))}
                </fieldset>
              )}
              {(aviso || programar.isError) && <p role="alert" className="text-sm text-destructive" data-testid="programar-error">{aviso ?? (programar.error as Error).message}</p>}
              {guardado && <p role="status" className="text-sm" data-testid="programar-ok">{activa ? "Programación guardada. Corre desde el siguiente horario, no de inmediato." : "Programación pausada."}</p>}
              <Button onClick={guardar} disabled={programar.isPending} data-testid="programar-guardar">
                {programar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar programación
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
