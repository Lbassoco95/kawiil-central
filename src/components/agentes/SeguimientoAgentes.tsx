import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cuandoRelativo } from "@/lib/agentes/registro";
import { enCurso, useDescargarEntregable, useDetalleSeguimiento, useTareasSeguimiento } from "@/hooks/useSeguimientoAgentes";
import { ETIQUETA_EVENTO, type EntregablePublico, type GrupoEstado } from "../../../supabase/functions/_shared/seguimiento";

// Seguimiento de las tareas que se le mandan a los agentes: qué pidió, cómo va, qué hizo y qué documentos entregó.
// Solo lectura. Todo estado se dice con texto (no solo con color). El contenido viene del servidor como texto plano: nunca se pinta como HTML.

export const ETIQUETA_ESTADO: Record<string, { texto: string; tono: string }> = {
  pending: { texto: "En espera", tono: "border-border/60" }, queued: { texto: "En cola", tono: "border-border/60" },
  in_progress: { texto: "Trabajando", tono: "border-sky-400/60 bg-sky-50/50" }, waiting_approval: { texto: "Espera tu aprobación", tono: "border-amber-400/60 bg-amber-50/50" },
  completed: { texto: "Terminó", tono: "border-emerald-400/60 bg-emerald-50/50" }, error: { texto: "Falló", tono: "border-rose-400/60 bg-rose-50/50" },
  failed: { texto: "Falló", tono: "border-rose-400/60 bg-rose-50/50" }, cancelled: { texto: "Cancelada", tono: "border-border/60 opacity-70" },
};
const FILTROS: { v: GrupoEstado | "todas"; t: string }[] = [
  { v: "todas", t: "Todas" }, { v: "en_curso", t: "En curso" }, { v: "terminadas", t: "Terminadas" }, { v: "con_error", t: "Con error" },
];
export const tamano = (b: number): string => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const ETIQUETA_FORMATO: Record<string, string> = { docx: "Word", xlsx: "Excel", pdf: "PDF" };

function Estado({ estado }: { estado: string }) {
  const e = ETIQUETA_ESTADO[estado] ?? { texto: estado || "—", tono: "border-border/60" };
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${e.tono}`} data-testid="seguimiento-estado">{e.texto}</span>;
}

function Entregables({ taskId, lista }: { taskId: string; lista: EntregablePublico[] }) {
  const descargar = useDescargarEntregable();
  if (lista.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="seguimiento-entregables">
      <p className="text-xs font-medium text-muted-foreground">Documentos entregados</p>
      <ul className="space-y-1.5">
        {lista.map((e, i) => (
          <li key={e.nombre + i} className="flex flex-wrap items-center gap-2 text-sm">
            {e.formato === "xlsx" ? <FileSpreadsheet className="h-4 w-4" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
            <span className="font-medium">{e.nombre}</span>
            <span className="text-xs text-muted-foreground">{ETIQUETA_FORMATO[e.formato] ?? e.formato} · {tamano(e.bytes)}</span>
            <Button size="sm" variant="outline" disabled={descargar.isPending} data-testid={`seguimiento-descargar-${i}`}
              onClick={() => descargar.mutate({ taskId, indice: i })}>
              {descargar.isPending && descargar.variables?.indice === i ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}Descargar
            </Button>
          </li>
        ))}
      </ul>
      {descargar.isError && <p role="alert" className="text-sm text-destructive">{(descargar.error as Error).message}</p>}
      <p className="text-xs text-muted-foreground">Son borradores del agente: revísalos antes de enviarlos. El enlace de descarga dura 5 minutos.</p>
    </div>
  );
}

function Detalle({ taskId, ahora }: { taskId: string; ahora: Date }) {
  const q = useDetalleSeguimiento(taskId);
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Leyendo la tarea…</p>;
  if (q.isError || !q.data) return <p role="alert" className="text-sm text-destructive">{(q.error as Error | null)?.message ?? "No se pudo leer la tarea."}</p>;
  const { tarea: t, eventos, actividad } = q.data;
  const visibles = eventos.filter((e) => e.tipo !== "attachment_processed");
  return (
    <div className="space-y-4" data-testid="seguimiento-detalle">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-base font-medium">{t.titulo || "Tarea sin título"}</p><Estado estado={t.estado} />
        {enCurso(t.estado) && <span className="flex items-center gap-1 text-xs text-muted-foreground"><RefreshCw className="h-3 w-3 animate-spin" aria-hidden />Actualizando</span>}
      </div>
      <p className="text-xs text-muted-foreground">{t.agente} · creada {cuandoRelativo(t.creada, ahora)}{t.fin ? ` · terminó ${cuandoRelativo(t.fin, ahora)}` : ""}</p>
      {t.instrucciones && <div><p className="text-xs font-medium text-muted-foreground">Lo que se le pidió</p><p className="whitespace-pre-wrap text-sm" data-testid="seguimiento-instrucciones">{t.instrucciones}</p></div>}
      {(visibles.length > 0 || actividad.length > 0) && (
        <div data-testid="seguimiento-avance">
          <p className="text-xs font-medium text-muted-foreground">Cómo lo va trabajando</p>
          <ol className="mt-1 space-y-1 text-sm">
            {visibles.map((e) => <li key={`e${e.secuencia}${e.tipo}`}>{ETIQUETA_EVENTO[e.tipo] ?? e.tipo}{e.progreso != null ? ` (${e.progreso}%)` : ""}<span className="text-xs text-muted-foreground"> · {cuandoRelativo(e.cuando, ahora)}</span></li>)}
            {actividad.map((a, i) => <li key={`a${i}`} className={a.nivel === "warning" ? "text-amber-700" : ""}>{a.mensaje || a.accion}<span className="text-xs text-muted-foreground"> · {cuandoRelativo(a.cuando, ahora)}</span></li>)}
          </ol>
        </div>
      )}
      <Entregables taskId={t.id} lista={t.entregables_lista} />
      {t.respuesta && <div><p className="text-xs font-medium text-muted-foreground">Respuesta del agente</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-2xl border border-border/60 bg-background/40 p-3 font-sans text-sm" data-testid="seguimiento-respuesta">{t.respuesta}</pre></div>}
      {t.error && <p role="alert" className="text-sm text-destructive" data-testid="seguimiento-error">No salió como esperábamos: {t.error}</p>}
    </div>
  );
}

export function SeguimientoAgentes({ ahora, seleccionInicial = null }: { ahora: Date; seleccionInicial?: string | null }) {
  const [grupo, setGrupo] = useState<GrupoEstado | "todas">("todas");
  const [elegida, setElegida] = useState<string | null>(seleccionInicial);
  const q = useTareasSeguimiento(grupo);
  return (
    <div className="space-y-3" data-testid="seguimiento">
      <p className="text-sm text-muted-foreground">Las tareas que mandas a los agentes: cómo van, qué hicieron y los documentos que entregan. Se actualiza solo mientras algo está en curso.</p>
      <div className="flex flex-wrap gap-2 text-xs" role="group" aria-label="Filtrar tareas">
        {FILTROS.map((f) => (
          <button key={f.v} type="button" aria-pressed={grupo === f.v} data-testid={`seguimiento-filtro-${f.v}`} onClick={() => { setGrupo(f.v); setElegida(null); }}
            className={`rounded-full border px-3 py-1 ${grupo === f.v ? "border-primary/60 bg-primary/10" : "border-border/60"}`}>{f.t}</button>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="zen-glass max-h-[34rem] space-y-1.5 overflow-auto rounded-3xl p-3" data-testid="seguimiento-lista">
          {q.isLoading ? <p className="text-sm text-muted-foreground">Leyendo las tareas…</p>
            : q.isError ? <p role="alert" className="text-sm text-destructive">{(q.error as Error).message}</p>
            : (q.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground" data-testid="seguimiento-vacio">Aún no hay tareas{grupo !== "todas" ? " en este filtro" : ""}. Manda una desde Instrucciones.</p>
            : (q.data ?? []).map((t) => (
              <button key={t.id} type="button" data-testid={`seguimiento-tarea-${t.id}`} aria-pressed={elegida === t.id} onClick={() => setElegida(elegida === t.id ? null : t.id)}
                className={`w-full rounded-2xl border p-2.5 text-left text-sm ${elegida === t.id ? "border-primary/60 bg-primary/5" : "border-border/50"}`}>
                <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{t.titulo || "Tarea sin título"}</span><Estado estado={t.estado} /></span>
                <span className="block text-xs text-muted-foreground">{t.agente} · {cuandoRelativo(t.creada, ahora)}{t.entregables > 0 ? ` · ${t.entregables} ${t.entregables === 1 ? "documento" : "documentos"}` : ""}</span>
              </button>
            ))}
        </div>
        <div className="zen-glass min-h-[8rem] rounded-3xl p-4">
          {elegida ? <Detalle taskId={elegida} ahora={ahora} /> : <p className="text-sm text-muted-foreground">Elige una tarea para ver cómo va.</p>}
        </div>
      </div>
    </div>
  );
}
