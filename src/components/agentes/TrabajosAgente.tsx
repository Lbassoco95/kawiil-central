import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Plus, Send } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cuandoRelativo, type AgenteRegistro } from "@/lib/agentes/registro";
import { dominiosEscritura } from "../../../supabase/functions/_shared/seguimiento";
import { useInstruirAgente } from "@/hooks/useAgenteConstructor";
import { useTareasSeguimiento } from "@/hooks/useSeguimientoAgentes";
import { HiloAgente } from "@/components/agentes/HiloAgente";
import { AutorizarAccesos, AutorizarEscritura, etiquetasAccesos } from "@/components/agentes/InstruirAgente";
import { ETIQUETA_ESTADO } from "@/components/agentes/SeguimientoAgentes";

// Panel de la Oficina cuando eliges a un agente: sus conversaciones en una lista compacta, el chat abierto (con altura fija y su propio scroll) y,
// plegada, una solicitud nueva (abierta solo si el agente aún no tiene conversaciones). Con entregables y revisiones programadas. Solo Dirección.
export function TrabajosAgente({ agentId, nombre, ahora, agente }: { agentId: string; nombre: string; ahora: Date; agente?: AgenteRegistro }) {
  const q = useTareasSeguimiento("todas", agentId);
  const instruir = useInstruirAgente();
  const qc = useQueryClient();
  const [elegida, setElegida] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  const [aprobados, setAprobados] = useState<string[]>([]);
  const [escribir, setEscribir] = useState<string[]>([]);
  // Autorizaciones de ESTA solicitud (accesos de 1Password y escritura en sitios): solo etiqueta y dominio; nunca la referencia.
  const accesos = etiquetasAccesos(agente);
  const sitiosEscritura = dominiosEscritura(agente?.config);
  useEffect(() => { setElegida(null); setTitulo(""); setTexto(""); setNuevaAbierta(false); setAprobados([]); setEscribir([]); instruir.reset(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agentId]);

  // Solo las solicitudes originales: los seguimientos y las revisiones viven dentro de su conversación.
  const solicitudes = (q.data ?? []).filter((t) => !t.hilo);
  const formularioVisible = nuevaAbierta || (!q.isLoading && !q.isError && solicitudes.length === 0);
  const nueva = () => {
    if (!titulo.trim() || !texto.trim()) return;
    instruir.mutate({ agent_id: agentId, title: titulo.trim(), instructions: texto.trim(),
      accesos_aprobados: aprobados.filter((e) => accesos.some((a) => a.etiqueta === e)), escrituras_aprobadas: escribir.filter((d) => sitiosEscritura.includes(d)) }, {
      onSuccess: (r) => { setTitulo(""); setTexto(""); setAprobados([]); setEscribir([]); setNuevaAbierta(false); void qc.invalidateQueries({ queryKey: ["agentes-seguimiento"] }); if (r?.task_id) setElegida(r.task_id); },
    });
  };
  return (
    <div className="space-y-3" data-testid="trabajos-agente">
      <div className="zen-glass space-y-2 rounded-2xl p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Conversaciones con {nombre}</p>
          <Button type="button" size="sm" variant="outline" aria-expanded={formularioVisible} aria-controls="trabajos-nueva" data-testid="trabajos-nueva-abrir" onClick={() => setNuevaAbierta((v) => !v)}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />Nueva
          </Button>
        </div>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Leyendo sus trabajos…</p>
          : q.isError ? <p role="alert" className="text-sm text-destructive">{(q.error as Error).message}</p>
          : solicitudes.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="trabajos-vacio">Aún no tiene solicitudes. Pídele algo abajo.</p>
          : (
            <ul className={elegida ? "flex gap-1.5 overflow-x-auto pb-1" : "max-h-44 space-y-1 overflow-y-auto pr-1"} aria-label={`Solicitudes de ${nombre}`} data-testid="trabajos-lista">
              {solicitudes.slice(0, 12).map((t) => (
                <li key={t.id} className={elegida ? "shrink-0" : undefined}>
                  <button type="button" aria-pressed={elegida === t.id} data-testid={`trabajo-${t.id}`} onClick={() => setElegida(elegida === t.id ? null : t.id)}
                    title={`${t.titulo || "Solicitud sin título"} · ${ETIQUETA_ESTADO[t.estado]?.texto ?? t.estado}`}
                    className={elegida
                      ? `max-w-[15rem] truncate rounded-full border px-3 py-1 text-xs ${elegida === t.id ? "border-primary/60 bg-primary/10 font-medium" : "border-border/50"}`
                      : `w-full rounded-xl border px-2.5 py-1.5 text-left text-sm ${elegida === t.id ? "border-primary/60 bg-primary/5" : "border-border/50"}`}>
                    {elegida ? (t.titulo || "Solicitud sin título") : (
                      <>
                        <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{t.titulo || "Solicitud sin título"}</span>
                          <span className="rounded-full border border-border/60 px-2 py-0.5 text-xs">{ETIQUETA_ESTADO[t.estado]?.texto ?? t.estado}</span></span>
                        <span className="block text-xs text-muted-foreground">{cuandoRelativo(t.creada, ahora)}{t.entregables > 0 ? ` · ${t.entregables} ${t.entregables === 1 ? "documento" : "documentos"}` : ""}</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
      {elegida && <div className="zen-glass rounded-2xl p-3"><HiloAgente key={elegida} taskId={elegida} ahora={ahora} claseAlto="h-[min(64vh,42rem)] min-h-[22rem] lg:h-[calc(100vh-21rem)]" /></div>}
      <div id="trabajos-nueva" className={`zen-glass space-y-2 rounded-2xl p-4 ${formularioVisible ? "" : "hidden"}`} data-testid="trabajos-nueva">
        <p className="flex items-center gap-1 text-sm font-medium"><ChevronDown className="h-4 w-4" aria-hidden />Nueva solicitud para {nombre}</p>
        <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título (por ejemplo: Revisión de libros corporativos)" data-testid="trabajos-titulo" />
        <Textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Qué debe hacer y qué debe entregarte. Después puedes seguir la conversación aquí mismo." data-testid="trabajos-texto" />
        <AutorizarAccesos accesos={accesos} marcados={aprobados} onCambio={setAprobados} />
        <AutorizarEscritura sitios={sitiosEscritura} marcados={escribir} onCambio={setEscribir} />
        {instruir.isError && <p role="alert" className="text-sm text-destructive">{(instruir.error as Error).message}</p>}
        <Button onClick={nueva} disabled={!titulo.trim() || !texto.trim() || instruir.isPending} data-testid="trabajos-enviar">
          {instruir.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Enviar solicitud
        </Button>
      </div>
    </div>
  );
}
