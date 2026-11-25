import { Link } from "react-router-dom";
import { cuandoRelativo } from "@/lib/agentes/registro";
import { ETIQUETA_ESTADO } from "@/lib/agentes/etiquetas";
import { urlChat } from "@/lib/agentes/chat";
import { useTareasSeguimiento } from "@/hooks/useSeguimientoAgentes";

// Pestaña «Conversaciones» del escritorio del agente en la sala (R2.b): solo el resumen de la última conversación y el botón «Abrir el chat».
// NO tiene cuadro para escribir: para escribirle al agente se abre su chat (pantalla aparte, `/agentes/chat/<id>`).
export function ResumenConversacion({ agentId, nombre, ahora }: { agentId: string; nombre: string; ahora: Date }) {
  const q = useTareasSeguimiento("todas", agentId);
  const raices = (q.data ?? []).filter((t) => !t.hilo).sort((a, b) => b.creada.localeCompare(a.creada));
  const ultima = raices[0];
  return (
    <div className="zen-glass space-y-3 rounded-2xl p-3" data-testid="resumen-conversacion">
      <p className="text-sm font-medium">Última conversación con {nombre}</p>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Leyendo su última conversación…</p>
        : q.isError ? <p role="alert" className="text-sm text-destructive">{(q.error as Error).message}</p>
        : !ultima ? <p className="text-sm text-muted-foreground" data-testid="resumen-vacio">Aún no hay conversaciones con {nombre}.</p>
        : (
          <div className="space-y-1" data-testid="resumen-ultima">
            <p className="text-sm font-medium">{ultima.titulo || "Solicitud sin título"}</p>
            <p className="text-xs text-muted-foreground">
              <span className="rounded-full border border-border/60 px-2 py-0.5">{ETIQUETA_ESTADO[ultima.estado]?.texto ?? ultima.estado}</span>
              {" · "}{cuandoRelativo(ultima.creada, ahora)}{ultima.entregables > 0 ? ` · ${ultima.entregables} ${ultima.entregables === 1 ? "documento" : "documentos"}` : ""}
            </p>
            {ultima.resumen && <p className="line-clamp-3 text-sm text-muted-foreground">{ultima.resumen}</p>}
          </div>
        )}
      <div className="flex flex-wrap gap-2">
        <Link to={urlChat(agentId, { conv: raices[0]?.id })} className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground" data-testid="abrir-chat">Abrir el chat</Link>
        <a href={urlChat(agentId, { conv: raices[0]?.id })} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-border/60 px-4 text-sm" data-testid="abrir-pestana">Abrir en pestaña</a>
      </div>
    </div>
  );
}
