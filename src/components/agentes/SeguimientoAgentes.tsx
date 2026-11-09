import { useState } from "react";
import { cuandoRelativo } from "@/lib/agentes/registro";
import { useTareasSeguimiento } from "@/hooks/useSeguimientoAgentes";
import { ETIQUETA_ESTADO, tamano } from "@/lib/agentes/etiquetas";
import { HiloAgente } from "@/components/agentes/HiloAgente";
import type { GrupoEstado } from "../../../supabase/functions/_shared/seguimiento";

// Se re-exportan para quien ya los importaba de aquí.
export { ETIQUETA_ESTADO, tamano };

// Seguimiento: la lista de solicitudes que se le han hecho a los agentes y, al elegir una, su CONVERSACIÓN (lo que se pidió, lo que respondió y entregó,
// seguimientos con memoria y revisiones programadas). Todo estado se dice con texto (no solo con color); el contenido se pinta de forma segura.

const FILTROS: { v: GrupoEstado | "todas"; t: string }[] = [
  { v: "todas", t: "Todas" }, { v: "en_curso", t: "En curso" }, { v: "terminadas", t: "Terminadas" }, { v: "con_error", t: "Con error" },
];

function Estado({ estado }: { estado: string }) {
  const e = ETIQUETA_ESTADO[estado] ?? { texto: estado || "—", tono: "border-border/60" };
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${e.tono}`} data-testid="seguimiento-estado">{e.texto}</span>;
}

export function SeguimientoAgentes({ ahora, seleccionInicial = null }: { ahora: Date; seleccionInicial?: string | null }) {
  const [grupo, setGrupo] = useState<GrupoEstado | "todas">("todas");
  const [elegida, setElegida] = useState<string | null>(seleccionInicial);
  const q = useTareasSeguimiento(grupo);
  // Solo las solicitudes originales: los seguimientos y las revisiones viven dentro de su conversación.
  const solicitudes = (q.data ?? []).filter((t) => !t.hilo);
  return (
    <div className="space-y-3" data-testid="seguimiento">
      <p className="text-sm text-muted-foreground">Tus solicitudes a los agentes. Elige una para ver la conversación: lo que respondió, sus documentos, seguir hablando con el agente y programar revisiones. Se actualiza solo mientras algo está en curso.</p>
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
            : solicitudes.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="seguimiento-vacio">Aún no hay tareas{grupo !== "todas" ? " en este filtro" : ""}. Manda una desde Instrucciones.</p>
            : solicitudes.map((t) => (
              <button key={t.id} type="button" data-testid={`seguimiento-tarea-${t.id}`} aria-pressed={elegida === t.id} onClick={() => setElegida(elegida === t.id ? null : t.id)}
                className={`w-full rounded-2xl border p-2.5 text-left text-sm ${elegida === t.id ? "border-primary/60 bg-primary/5" : "border-border/50"}`}>
                <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{t.titulo || "Tarea sin título"}</span><Estado estado={t.estado} /></span>
                <span className="block text-xs text-muted-foreground">{t.agente} · {cuandoRelativo(t.creada, ahora)}{t.entregables > 0 ? ` · ${t.entregables} ${t.entregables === 1 ? "documento" : "documentos"}` : ""}</span>
              </button>
            ))}
        </div>
        <div className="zen-glass min-h-[8rem] rounded-3xl p-4">
          {elegida ? <HiloAgente key={elegida} taskId={elegida} ahora={ahora} /> : <p className="text-sm text-muted-foreground">Elige una solicitud para ver la conversación.</p>}
        </div>
      </div>
    </div>
  );
}
