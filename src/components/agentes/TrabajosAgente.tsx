import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cuandoRelativo } from "@/lib/agentes/registro";
import { useInstruirAgente } from "@/hooks/useAgenteConstructor";
import { useTareasSeguimiento } from "@/hooks/useSeguimientoAgentes";
import { HiloAgente } from "@/components/agentes/HiloAgente";
import { ETIQUETA_ESTADO } from "@/components/agentes/SeguimientoAgentes";

// Panel de la Oficina cuando eliges a un agente: sus solicitudes (cada una es una conversación), una solicitud nueva, y la conversación
// abierta con sus entregables y revisiones programadas. Solo Dirección.
export function TrabajosAgente({ agentId, nombre, ahora }: { agentId: string; nombre: string; ahora: Date }) {
  const q = useTareasSeguimiento("todas", agentId);
  const instruir = useInstruirAgente();
  const qc = useQueryClient();
  const [elegida, setElegida] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  useEffect(() => { setElegida(null); setTitulo(""); setTexto(""); instruir.reset(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agentId]);

  // Solo las solicitudes originales: los seguimientos y las revisiones viven dentro de su conversación.
  const solicitudes = (q.data ?? []).filter((t) => !t.hilo);
  const nueva = () => {
    if (!titulo.trim() || !texto.trim()) return;
    instruir.mutate({ agent_id: agentId, title: titulo.trim(), instructions: texto.trim() }, {
      onSuccess: (r) => { setTitulo(""); setTexto(""); void qc.invalidateQueries({ queryKey: ["agentes-seguimiento"] }); if (r?.task_id) setElegida(r.task_id); },
    });
  };
  return (
    <div className="space-y-3" data-testid="trabajos-agente">
      <div className="zen-glass space-y-2 rounded-2xl p-4">
        <p className="text-sm font-medium">Trabajos de {nombre}</p>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Leyendo sus trabajos…</p>
          : q.isError ? <p role="alert" className="text-sm text-destructive">{(q.error as Error).message}</p>
          : solicitudes.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="trabajos-vacio">Aún no tiene solicitudes. Pídele algo abajo.</p>
          : (
            <ul className="space-y-1.5" aria-label={`Solicitudes de ${nombre}`}>
              {solicitudes.slice(0, 12).map((t) => (
                <li key={t.id}>
                  <button type="button" aria-pressed={elegida === t.id} data-testid={`trabajo-${t.id}`} onClick={() => setElegida(elegida === t.id ? null : t.id)}
                    className={`w-full rounded-xl border p-2 text-left text-sm ${elegida === t.id ? "border-primary/60 bg-primary/5" : "border-border/50"}`}>
                    <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{t.titulo || "Solicitud sin título"}</span>
                      <span className="rounded-full border border-border/60 px-2 py-0.5 text-xs">{ETIQUETA_ESTADO[t.estado]?.texto ?? t.estado}</span></span>
                    <span className="block text-xs text-muted-foreground">{cuandoRelativo(t.creada, ahora)}{t.entregables > 0 ? ` · ${t.entregables} ${t.entregables === 1 ? "documento" : "documentos"}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
      {elegida && <div className="zen-glass rounded-2xl p-4"><HiloAgente taskId={elegida} ahora={ahora} /></div>}
      <div className="zen-glass space-y-2 rounded-2xl p-4">
        <p className="text-sm font-medium">Nueva solicitud para {nombre}</p>
        <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título (por ejemplo: Revisión de libros corporativos)" data-testid="trabajos-titulo" />
        <Textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Qué debe hacer y qué debe entregarte. Después puedes seguir la conversación aquí mismo." data-testid="trabajos-texto" />
        {instruir.isError && <p role="alert" className="text-sm text-destructive">{(instruir.error as Error).message}</p>}
        <Button onClick={nueva} disabled={!titulo.trim() || !texto.trim() || instruir.isPending} data-testid="trabajos-enviar">
          {instruir.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Enviar solicitud
        </Button>
      </div>
    </div>
  );
}
