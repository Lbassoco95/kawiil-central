import { useMemo, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useFiguraDe } from "@/components/agentes/BandaEquipo";
import { ESTADO_OFICINA } from "@/lib/agentes/oficina";
import { sugerirAgentes, tituloDe } from "@/lib/agentes/enrutar";
import { etiquetaOpcion, nombreAgente, rolCorto, type AgenteRegistro } from "@/lib/agentes/registro";
import { useInstruirAgente } from "@/hooks/useAgenteConstructor";

// Barra única de tareas: la persona escribe qué necesita y la barra sugiere quién lo hace (coincidencia de palabras, sin modelo). Nada se envía hasta que
// la persona elige agente y pulsa «Enviar»: crea la misma tarea que «Instrucciones» (dispatch-to-agent). Sin accesos de 1Password ni escritura en
// sitios: eso solo se autoriza en «Instrucciones», tarea por tarea.

function Opcion({ a, motivo, activo, onElegir }: { a: AgenteRegistro; motivo?: string; activo: boolean; onElegir: () => void }) {
  const f = useFiguraDe(a.id), info = f ? ESTADO_OFICINA[f.estado] : null;
  return (
    <button type="button" role="radio" aria-checked={activo} onClick={onElegir} data-testid={`barra-opcion-${a.id}`}
      className={`min-w-0 rounded-2xl border px-3 py-1.5 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/60 ${activo ? "border-primary/60 bg-primary/10 shadow-sm" : "border-border/50 bg-background/40 hover:bg-background/70"}`}>
      <span className="block truncate font-medium">{nombreAgente(a)}{info && <span className="font-normal text-muted-foreground"> · {info.etiqueta}</span>}</span>
      <span className="block truncate text-[11px] text-muted-foreground">{motivo ?? rolCorto(a)}</span>
    </button>
  );
}

export function BarraTareas({ agentes, onVerSeguimiento }: { agentes: AgenteRegistro[]; onVerSeguimiento?: (taskId?: string) => void }) {
  const [texto, setTexto] = useState("");
  const [elegido, setElegido] = useState("");
  const [otro, setOtro] = useState(false);
  const [enviado, setEnviado] = useState<{ nombre: string; tareaId?: string } | null>(null);
  const instruir = useInstruirAgente();
  const disponibles = useMemo(() => agentes.filter((a) => a.status !== "archived" && a.kind !== "system"), [agentes]);
  const sugeridos = useMemo(() => sugerirAgentes(texto, disponibles), [texto, disponibles]);
  const agente = disponibles.find((a) => a.id === elegido);
  const sugerido = sugeridos.find((s) => s.agente.id === elegido);
  const listo = !!agente && texto.trim().length > 0;

  const enviar = () => {
    if (!listo || !agente) return;
    const nombre = nombreAgente(agente);
    instruir.mutate({ agent_id: agente.id, title: tituloDe(texto), instructions: texto.trim() }, {
      onSuccess: (r) => { setEnviado({ nombre, tareaId: r?.task_id }); setTexto(""); setElegido(""); setOtro(false); },
    });
  };
  const cambiaTexto = (v: string) => { setTexto(v); setEnviado(null); if (elegido && !otro && !sugerirAgentes(v, disponibles).some((s) => s.agente.id === elegido)) setElegido(""); };

  return (
    <section className="zen-glass space-y-2 rounded-3xl p-3" aria-label="Pedir una tarea" data-testid="barra-tareas">
      <label className="block text-sm font-medium" htmlFor="barra-texto">¿Qué necesitas?</label>
      <Textarea id="barra-texto" value={texto} onChange={(e) => cambiaTexto(e.target.value)} rows={2} data-testid="barra-texto"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enviar(); } }}
        placeholder="Escribe la tarea con tus palabras y te sugiero qué agente la hace. Ej.: «Revisa si hay cambios del SAT sobre nómina»" />
      {texto.trim() && (
        <div className="space-y-1.5" data-testid="barra-sugerencias">
          {sugeridos.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground">Sugeridos para esto (elige uno):</p>
              <div role="radiogroup" aria-label="Agente sugerido" className="grid gap-2 sm:grid-cols-3">
                {sugeridos.map((s) => <Opcion key={s.agente.id} a={s.agente} motivo={s.motivo} activo={s.agente.id === elegido} onElegir={() => { setElegido(s.agente.id); setOtro(false); }} />)}
              </div>
            </>
          ) : <p className="text-xs text-muted-foreground" data-testid="barra-sin-sugerencia">No encontré un agente que encaje con lo que escribiste. Elige uno de la lista.</p>}
          <button type="button" className="text-xs underline" onClick={() => setOtro((v) => !v)} data-testid="barra-otro-abrir">{otro ? "Ocultar la lista" : "Elegir otro agente"}</button>
          {otro && (
            <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" aria-label="Elegir otro agente" value={elegido} onChange={(e) => setElegido(e.target.value)} data-testid="barra-otro">
              <option value="">Elige un agente…</option>
              {disponibles.map((a) => <option key={a.id} value={a.id}>{etiquetaOpcion(a)}</option>)}
            </select>
          )}
        </div>
      )}
      {instruir.isError && <p role="alert" className="text-sm text-destructive">{(instruir.error as Error).message}</p>}
      {enviado && (
        <p role="status" className="text-sm" data-testid="barra-ok">
          Tarea enviada a {enviado.nombre}. Su respuesta aparece en Seguimiento.
          {onVerSeguimiento && <> <button type="button" className="underline" data-testid="barra-ver-seguimiento" onClick={() => onVerSeguimiento(enviado.tareaId)}>Abrir la conversación</button></>}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={enviar} disabled={!listo || instruir.isPending} data-testid="barra-enviar">
          {instruir.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          {agente ? `Enviar a ${nombreAgente(agente)}` : "Enviar"}
        </Button>
        <span className="text-xs text-muted-foreground">Ctrl + Enter para enviar. Sin accesos de 1Password ni permiso de escribir en sitios: para eso usa «Instrucciones».</span>
      </div>
      {sugerido && <span className="sr-only">Motivo: {sugerido.motivo}</span>}
    </section>
  );
}
