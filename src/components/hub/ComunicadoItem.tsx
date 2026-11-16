import { Pin, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { etiquetaEstado, textoVigencia, type Comunicado } from "@/lib/comunicados";

interface Props {
  com: Comunicado;
  indice: number;
  /** Administradores/gerentes: la base vuelve a comprobar que publicar, retirar o descartar solo lo haga Dirección. */
  puedeGestionar: boolean;
  ocupado: boolean;
  /** Fecha de creación ya formateada. */
  fecha: string;
  onGestionar: (accion: "publicar" | "archivar" | "descartar") => void;
  onEliminar: () => void;
}

/** Un comunicado en el Hub: estado y vigencia, y las acciones que le corresponden. Todo el texto se pinta como texto. */
export function ComunicadoItem({ com, indice, puedeGestionar, ocupado, fecha, onGestionar, onEliminar }: Props) {
  const estado = com.estado ?? "publicado";
  return (
    <div className="py-3 px-4 page-list-card group animate-fade-in" style={{ animationDelay: `${Math.min(indice, 8) * 40}ms`, animationFillMode: "both" }} data-testid="comunicado-item">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {com.is_pinned && <Pin className="h-3 w-3 text-primary shrink-0" />}
            <h3 className="text-[13px] font-medium text-foreground">{com.title}</h3>
          </div>
          {com.body && <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{com.body}</p>}
          {(estado !== "publicado" || com.origen === "agente" || com.avisar_al_entrar) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2" data-testid="comunicado-estado">
              <Badge variant="outline" className="text-[10px]">{etiquetaEstado(com).texto}</Badge>
              {com.vigente_desde && com.vigente_hasta && (
                <span className="text-[11px] capitalize text-muted-foreground">
                  {com.avisar_al_entrar ? "Aviso al abrir el sistema: " : "Vigente: "}{textoVigencia(com.vigente_desde, com.vigente_hasta)}
                </span>
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-1.5">{fecha}</p>
        </div>
        {puedeGestionar && (
          <div className="flex shrink-0 items-center gap-1">
            {estado === "borrador" ? (
              <>
                <Button size="sm" className="h-7 px-2 text-xs" disabled={ocupado} onClick={() => onGestionar("publicar")}>Publicar</Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={ocupado} onClick={() => onGestionar("descartar")}>Descartar</Button>
              </>
            ) : (
              <>
                {estado === "publicado" && com.avisar_al_entrar && (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={ocupado} onClick={() => onGestionar("archivar")}>Retirar</Button>
                )}
                <button className="p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-destructive transition-colors" aria-label="Eliminar comunicado" onClick={onEliminar}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
