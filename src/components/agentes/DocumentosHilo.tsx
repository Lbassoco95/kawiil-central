import { Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDescargarEntregable } from "@/hooks/useSeguimientoAgentes";
import { tamano } from "@/lib/agentes/etiquetas";
import type { MensajeHilo } from "../../../supabase/functions/_shared/seguimiento";

// Todos los documentos que el agente entregó en esta conversación (de cualquier respuesta), siempre a la mano: si repites una petición
// o la página se recarga, no hay que buscar en qué mensaje quedaron. Sin duplicados por nombre (queda el más reciente).
// Vive en la pestaña «Documentos» del panel «Requerimientos» (R6.7), con las acciones Ver (PDF) y Descargar.
export function documentosDelHilo(mensajes: MensajeHilo[]) {
  const porNombre = new Map<string, { m: MensajeHilo; i: number; e: MensajeHilo["entregables"][number] }>();
  for (const m of mensajes) m.entregables.forEach((e, i) => porNombre.set(e.nombre, { m, i, e }));
  return [...porNombre.values()];
}

export function ListaDocumentos({ mensajes }: { mensajes: MensajeHilo[] }) {
  const descargar = useDescargarEntregable();
  const docs = documentosDelHilo(mensajes);
  if (docs.length === 0) return <p className="text-sm text-muted-foreground" data-testid="documentos-vacio">Aún no hay documentos en esta conversación.</p>;
  return (
    <ul className="max-h-44 space-y-1.5 overflow-y-auto" data-testid="hilo-documentos">
      {docs.map(({ m, i, e }) => (
        <li key={`${m.task_id}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{e.nombre}</span><span className="text-xs text-muted-foreground">{tamano(e.bytes)}</span>
          {e.formato === "pdf" && (
            <Button size="sm" variant="outline" disabled={descargar.isPending} data-testid={`doc-ver-${m.task_id}-${i}`} onClick={() => descargar.mutate({ taskId: m.task_id, indice: i, ver: true })}>
              <Eye className="mr-1 h-3.5 w-3.5" />Ver
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={descargar.isPending} data-testid={`doc-descargar-${m.task_id}-${i}`} onClick={() => descargar.mutate({ taskId: m.task_id, indice: i })}>
            <Download className="mr-1 h-3.5 w-3.5" />Descargar
          </Button>
        </li>
      ))}
      {descargar.isError && <li role="alert" className="text-sm text-destructive">{(descargar.error as Error).message}</li>}
    </ul>
  );
}
