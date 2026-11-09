import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { etiquetaOpcion, nombreAgente, type AgenteRegistro } from "@/lib/agentes/registro";
import { FichaAgente } from "@/components/agentes/FichaAgente";
import { useInstruirAgente } from "@/hooks/useAgenteConstructor";

export function etiquetasAccesos(a: AgenteRegistro | undefined): { etiqueta: string; dominio: string }[] {
  const lista = (a?.config as { credenciales_1password?: unknown } | null | undefined)?.credenciales_1password;
  if (!Array.isArray(lista)) return [];
  return lista.flatMap((c) => (c && typeof c.etiqueta === "string" ? [{ etiqueta: c.etiqueta, dominio: typeof c.dominio === "string" ? c.dominio : "su sitio" }] : []));
}

// Darle una instrucción a un agente: crea una tarea por el despacho que ya existe. No modifica al agente ni guarda datos de expedientes aquí.
export function InstruirAgente({ agentes, onVerSeguimiento }: { agentes: AgenteRegistro[]; onVerSeguimiento?: () => void }) {
  const [agenteId, setAgenteId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [instruccion, setInstruccion] = useState("");
  const [enviado, setEnviado] = useState<string | null>(null);
  const [aprobados, setAprobados] = useState<string[]>([]);
  const instruir = useInstruirAgente();
  const disponibles = agentes.filter((a) => a.status !== "archived" && a.kind !== "system");
  const listo = agenteId && titulo.trim() && instruccion.trim();
  // Accesos de 1Password del agente elegido (solo etiqueta y dominio; la referencia no se muestra ni se envía).
  const accesos = etiquetasAccesos(disponibles.find((a) => a.id === agenteId));
  const enviar = () => {
    if (!listo) return;
    const nombre = nombreAgente(disponibles.find((a) => a.id === agenteId)!);
    const validos = aprobados.filter((e) => accesos.some((a) => a.etiqueta === e));
    instruir.mutate({ agent_id: agenteId, title: titulo.trim(), instructions: instruccion.trim(), accesos_aprobados: validos }, {
      onSuccess: () => { setEnviado(nombre); setTitulo(""); setInstruccion(""); setAprobados([]); },
    });
  };
  return (
    <div className="zen-glass space-y-3 rounded-3xl p-4" data-testid="instruir">
      <p className="text-sm text-muted-foreground">Asigna una función o tarea a un agente. Se envía al servicio de agentes; si está apagado, te lo dirá.</p>
      <label className="block space-y-1 text-sm">Agente
        <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={agenteId} onChange={(e) => { setAgenteId(e.target.value); setEnviado(null); setAprobados([]); }} data-testid="instruir-agente">
          <option value="">Elige un agente…</option>
          {disponibles.map((a) => <option key={a.id} value={a.id}>{etiquetaOpcion(a)}</option>)}
        </select>
      </label>
      <FichaAgente agente={disponibles.find((a) => a.id === agenteId)} />
      <label className="block space-y-1 text-sm">Título
        <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Revisar los documentos nuevos de Vizum" data-testid="instruir-titulo" />
      </label>
      <label className="block space-y-1 text-sm">Instrucción
        <Textarea value={instruccion} onChange={(e) => setInstruccion(e.target.value)} rows={4} placeholder="Qué debe hacer, con qué información y qué debe entregarte." data-testid="instruir-texto" />
      </label>
      {accesos.length > 0 && (
        <fieldset className="space-y-2 rounded-2xl border border-border/60 p-3 text-sm" data-testid="instruir-accesos">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Accesos de 1Password (solo para esta tarea)</legend>
          <p className="text-xs text-muted-foreground">Sin tu autorización el agente no puede iniciar sesión. Solo consulta: no envía formularios ni hace trámites, y nunca ve la contraseña.</p>
          {accesos.map((a) => (
            <label key={a.etiqueta} className="flex items-center gap-2">
              <input type="checkbox" checked={aprobados.includes(a.etiqueta)} data-testid={`instruir-acceso-${a.etiqueta}`}
                onChange={(e) => setAprobados((p) => e.target.checked ? [...p, a.etiqueta] : p.filter((x) => x !== a.etiqueta))} />
              Autorizo usar «{a.etiqueta}» en {a.dominio}
            </label>
          ))}
        </fieldset>
      )}
      {instruir.isError && <p role="alert" className="text-sm text-destructive">{(instruir.error as Error).message}</p>}
      {enviado && (
        <p role="status" className="text-sm" data-testid="instruir-ok">
          Instrucción enviada a {enviado}. Su avance y sus documentos aparecen en Seguimiento.
          {onVerSeguimiento && <> <button type="button" className="underline" data-testid="instruir-ver-seguimiento" onClick={onVerSeguimiento}>Ver seguimiento</button></>}
        </p>
      )}
      <Button onClick={enviar} disabled={!listo || instruir.isPending} data-testid="instruir-enviar">
        {instruir.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Enviar instrucción
      </Button>
    </div>
  );
}
