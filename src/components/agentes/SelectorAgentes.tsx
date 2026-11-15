import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EscritorioAgente, EstilosOficina } from "@/components/agentes/escritorio";
import { useFiguraDe } from "@/components/agentes/BandaEquipo";
import { ESTADO_OFICINA, figurasOficina } from "@/lib/agentes/oficina";
import { nombreAgente, rolCorto, type AgenteRegistro } from "@/lib/agentes/registro";

// Selector de agente de las pestañas con formulario (Instrucciones, Documentos, Enseñar, Programar): el mismo esquema visual de la Oficina —cada agente
// con su dibujo, su nombre y su estado— en lugar de un menú desplegable. Sin elegir, muestra todos; al elegir uno se pliega a una sola fila
// (con «Cambiar») para no empujar el formulario hacia abajo. Es un grupo de opciones accesible: cada agente es un botón `radio`.
// El estado sale del contexto de la página (estado real con sus tareas); fuera de ella se calcula con lo que trae el registro.

function Opcion({ a, activo, detalle, testid, onElegir, extra }: { a: AgenteRegistro; activo: boolean; detalle?: string; testid: string; onElegir: () => void; extra?: React.ReactNode }) {
  const delContexto = useFiguraDe(a.id);
  const propia = useMemo(() => figurasOficina([a], [], new Date())[0], [a]);
  const f = delContexto ?? propia;
  const info = f ? ESTADO_OFICINA[f.estado] : null;
  const subtitulo = detalle ?? rolCorto(a);
  return (
    <div className="flex items-center gap-2">
      <button type="button" role="radio" aria-checked={activo} onClick={onElegir} data-testid={`${testid}-${a.id}`}
        aria-label={`${nombreAgente(a)}${info ? `: ${info.etiqueta}` : ""}${subtitulo ? `. ${subtitulo}` : ""}`}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-2xl border p-1.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/60 ${activo ? "border-primary/60 bg-primary/10 shadow-sm" : "border-border/50 bg-background/40 hover:bg-background/70"}`}>
        {f ? <EscritorioAgente f={f} compacto mini activo={activo} /> : <span className="h-[60px] w-[76px] shrink-0 rounded-2xl border border-border/50" aria-hidden />}
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{nombreAgente(a)}</span>
          {subtitulo && <span className="block truncate text-[11px] text-muted-foreground" data-testid={`${testid}-${a.id}-detalle`}>{subtitulo}</span>}
          {info && <span className="block text-[11px]">{info.etiqueta}</span>}
        </span>
      </button>
      {extra}
    </div>
  );
}

export function SelectorAgentes({ agentes, valor, onCambio, testid, etiqueta = "Agente", detalle }: {
  agentes: AgenteRegistro[]; valor: string; onCambio: (id: string) => void; testid: string; etiqueta?: string; detalle?: (a: AgenteRegistro) => string | undefined;
}) {
  const [abierto, setAbierto] = useState(!valor);
  const [busca, setBusca] = useState("");
  const elegido = agentes.find((a) => a.id === valor);
  const plegado = !!elegido && !abierto;
  const q = busca.trim().toLowerCase();
  const visibles = useMemo(
    () => (q ? agentes.filter((a) => `${nombreAgente(a)} ${rolCorto(a)} ${detalle?.(a) ?? ""}`.toLowerCase().includes(q)) : agentes),
    [agentes, q, detalle],
  );
  const elegir = (id: string) => { onCambio(id); setAbierto(false); setBusca(""); };

  return (
    <div className="space-y-1.5" data-testid={testid}>
      <EstilosOficina />
      <p className="text-sm" id={`${testid}-etiqueta`}>{etiqueta}</p>
      <div role="radiogroup" aria-labelledby={`${testid}-etiqueta`} className="space-y-2">
        {plegado ? (
          <Opcion a={elegido!} activo detalle={detalle?.(elegido!)} testid={testid} onElegir={() => setAbierto(true)}
            extra={<button type="button" className="shrink-0 rounded-full border border-border/60 px-3 py-1 text-xs" data-testid={`${testid}-cambiar`} onClick={() => setAbierto(true)}>Cambiar</button>} />
        ) : (
          <>
            {agentes.length > 8 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar agente…" aria-label="Buscar agente" className="pl-8" data-testid={`${testid}-buscar`} />
              </div>
            )}
            <div className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-2 overflow-y-auto pr-1" data-testid={`${testid}-lista`}>
              {visibles.map((a) => <Opcion key={a.id} a={a} activo={a.id === valor} detalle={detalle?.(a)} testid={testid} onElegir={() => elegir(a.id)} />)}
            </div>
            {visibles.length === 0 && <p className="text-xs text-muted-foreground" data-testid={`${testid}-sin-resultados`}>Ningún agente coincide con «{busca.trim()}».</p>}
            {elegido && <button type="button" className="text-xs underline" onClick={() => setAbierto(false)} data-testid={`${testid}-plegar`}>Dejar a {nombreAgente(elegido)}</button>}
          </>
        )}
      </div>
    </div>
  );
}
