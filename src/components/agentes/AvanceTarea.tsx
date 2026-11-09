import { RefreshCw } from "lucide-react";
import { cuandoRelativo } from "@/lib/agentes/registro";
import { enCurso, useDetalleSeguimiento } from "@/hooks/useSeguimientoAgentes";
import { ETIQUETA_EVENTO } from "../../../supabase/functions/_shared/seguimiento";

// «Cómo lo va trabajando»: el avance técnico de UNA tarea (eventos y acciones: qué consultó, qué leyó). Solo lectura, todo como texto.
export function AvanceTarea({ taskId, ahora }: { taskId: string; ahora: Date }) {
  const q = useDetalleSeguimiento(taskId);
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Leyendo el avance…</p>;
  if (q.isError || !q.data) return <p role="alert" className="text-sm text-destructive">{(q.error as Error | null)?.message ?? "No se pudo leer el avance."}</p>;
  const { tarea: t, eventos, actividad } = q.data;
  const visibles = eventos.filter((e) => e.tipo !== "attachment_processed");
  if (visibles.length === 0 && actividad.length === 0) return <p className="text-sm text-muted-foreground">Todavía no hay avance registrado.</p>;
  return (
    <div data-testid="seguimiento-avance">
      {enCurso(t.estado) && <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"><RefreshCw className="h-3 w-3 animate-spin" aria-hidden />Actualizando</p>}
      <ol className="space-y-1 text-sm">
        {visibles.map((e) => <li key={`e${e.secuencia}${e.tipo}`}>{ETIQUETA_EVENTO[e.tipo] ?? e.tipo}{e.progreso != null ? ` (${e.progreso}%)` : ""}<span className="text-xs text-muted-foreground"> · {cuandoRelativo(e.cuando, ahora)}</span></li>)}
        {actividad.map((a, i) => <li key={`a${i}`} className={a.nivel === "warning" ? "text-amber-700" : ""}>{a.mensaje || a.accion}<span className="text-xs text-muted-foreground"> · {cuandoRelativo(a.cuando, ahora)}</span></li>)}
      </ol>
    </div>
  );
}
