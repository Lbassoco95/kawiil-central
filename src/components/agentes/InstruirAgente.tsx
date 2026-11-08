import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { nombreAgente, type AgenteRegistro } from "@/lib/agentes/registro";
import { useInstruirAgente } from "@/hooks/useAgenteConstructor";

// Darle una instrucción a un agente: crea una tarea por el despacho que ya existe. No modifica al agente ni guarda datos de expedientes aquí.
export function InstruirAgente({ agentes }: { agentes: AgenteRegistro[] }) {
  const [agenteId, setAgenteId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [instruccion, setInstruccion] = useState("");
  const [enviado, setEnviado] = useState<string | null>(null);
  const instruir = useInstruirAgente();
  const disponibles = agentes.filter((a) => a.status !== "archived" && a.kind !== "system");
  const listo = agenteId && titulo.trim() && instruccion.trim();
  const enviar = () => {
    if (!listo) return;
    const nombre = nombreAgente(disponibles.find((a) => a.id === agenteId)!);
    instruir.mutate({ agent_id: agenteId, title: titulo.trim(), instructions: instruccion.trim() }, {
      onSuccess: () => { setEnviado(nombre); setTitulo(""); setInstruccion(""); },
    });
  };
  return (
    <div className="zen-glass space-y-3 rounded-3xl p-4" data-testid="instruir">
      <p className="text-sm text-muted-foreground">Asigna una función o tarea a un agente. Se envía al servicio de agentes; si está apagado, te lo dirá.</p>
      <label className="block space-y-1 text-sm">Agente
        <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={agenteId} onChange={(e) => { setAgenteId(e.target.value); setEnviado(null); }} data-testid="instruir-agente">
          <option value="">Elige un agente…</option>
          {disponibles.map((a) => <option key={a.id} value={a.id}>{nombreAgente(a)}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm">Título
        <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Revisar los documentos nuevos de Vizum" data-testid="instruir-titulo" />
      </label>
      <label className="block space-y-1 text-sm">Instrucción
        <Textarea value={instruccion} onChange={(e) => setInstruccion(e.target.value)} rows={4} placeholder="Qué debe hacer, con qué información y qué debe entregarte." data-testid="instruir-texto" />
      </label>
      {instruir.isError && <p role="alert" className="text-sm text-destructive">{(instruir.error as Error).message}</p>}
      {enviado && <p role="status" className="text-sm" data-testid="instruir-ok">Instrucción enviada a {enviado}. Su avance aparece en Oficina y Tablas.</p>}
      <Button onClick={enviar} disabled={!listo || instruir.isPending} data-testid="instruir-enviar">
        {instruir.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Enviar instrucción
      </Button>
    </div>
  );
}
