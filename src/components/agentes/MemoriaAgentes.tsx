import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { SelectorAgentes } from "@/components/agentes/SelectorAgentes";
import { cuandoRelativo, nombreAgente, type AgenteRegistro } from "@/lib/agentes/registro";
import { useCambiarMemoria, useMemoriasAgentes } from "@/hooks/useMemoriaAgentes";
import { resumirMemorias, type MemoriaPublica } from "../../../supabase/functions/_shared/memoria";

// Memoria de los agentes (solo Dirección): qué recuerda cada uno, qué tan importante es, cuánto se ha usado y cuándo vence, para irlos entrenando y
// revisando. NUNCA se muestra el texto de una memoria (puede traer datos de clientes): ni se descarga del servidor. La única acción es apagar o encender
// una memoria (reversible); no se borra ni se edita nada.
// «vence en 3 días»: cuandoRelativo solo habla del pasado (con una fecha futura diría «ahora»).
function cuandoVence(iso: string, ahora: Date): string {
  const ms = Date.parse(iso) - ahora.getTime();
  if (ms <= 0) return `venció ${cuandoRelativo(iso, ahora)}`;
  const h = ms / 3_600_000;
  if (h < 1) return "vence en menos de 1 h";
  if (h < 24) return `vence en ${Math.round(h)} h`;
  const d = Math.round(h / 24);
  return `vence en ${d} ${d === 1 ? "día" : "días"}`;
}
const TIPO: Record<string, string> = { decision: "Decisión", fact: "Dato", pattern: "Patrón", otro: "Otro" };

function Fila({ m, ahora, ocupado, onCambiar }: { m: MemoriaPublica; ahora: Date; ocupado: boolean; onCambiar: (activa: boolean) => void }) {
  return (
    <li className={`flex items-center justify-between gap-3 rounded-2xl border p-2.5 text-sm ${m.activa ? "border-border/50 bg-background/40" : "border-border/40 bg-muted/40 text-muted-foreground"}`} data-testid={`memoria-${m.id}`} data-activa={m.activa}>
      <span className="min-w-0">
        <span className="block truncate font-medium">{TIPO[m.tipo] ?? "Otro"} · {m.categoria ?? "sin categoría"}</span>
        <span className="block text-xs text-muted-foreground">
          Importancia {m.importancia}/10 · usada {m.usos} {m.usos === 1 ? "vez" : "veces"}{m.ultimo_uso ? ` · última ${cuandoRelativo(m.ultimo_uso, ahora)}` : ""}
          {m.vence ? ` · ${cuandoVence(m.vence, ahora)}` : ""}{!m.activa ? " · apagada" : ""}
        </span>
      </span>
      <button type="button" disabled={ocupado} onClick={() => onCambiar(!m.activa)} aria-pressed={m.activa} data-testid={`memoria-cambiar-${m.id}`}
        aria-label={`${m.activa ? "Apagar" : "Encender"} la memoria ${TIPO[m.tipo] ?? "Otro"}${m.categoria ? ` ${m.categoria}` : ""}`}
        className="shrink-0 rounded-full border border-border/60 px-3 py-1 text-xs disabled:opacity-50">{m.activa ? "Apagar" : "Encender"}</button>
    </li>
  );
}

export function MemoriaAgentes({ agentes, ahora }: { agentes: AgenteRegistro[]; ahora: Date }) {
  const memorias = useMemoriasAgentes();
  const cambiar = useCambiarMemoria();
  const [agenteId, setAgenteId] = useState("");
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const lista = useMemo(() => agentes.filter((a) => a.status !== "archived"), [agentes]);
  const porAgente = useMemo(() => {
    const m = new Map<string, MemoriaPublica[]>();
    for (const x of memorias.data ?? []) (m.get(x.agent_id) ?? m.set(x.agent_id, []).get(x.agent_id)!).push(x);
    return m;
  }, [memorias.data]);
  const total = useMemo(() => resumirMemorias(memorias.data ?? [], ahora), [memorias.data, ahora]);
  const detalle = (a: AgenteRegistro) => { const r = resumirMemorias(porAgente.get(a.id) ?? [], ahora); return r.total === 0 ? "Sin memorias" : `${r.activas} activas${r.apagadas ? ` · ${r.apagadas} apagadas` : ""}`; };
  const elegido = lista.find((a) => a.id === agenteId);
  const suyas = porAgente.get(agenteId) ?? [];

  const cambiarMemoria = (id: string, activa: boolean) => {
    setTrabajando(id);
    cambiar.mutate({ id, activa }, { onSettled: () => setTrabajando(null) });
  };

  return (
    <div className="space-y-3" data-testid="memoria">
      <div className="zen-glass space-y-1 rounded-3xl p-4 text-sm">
        <p>Qué recuerda cada agente, para irlos entrenando y revisando. <strong>Nunca se muestra el texto</strong> de una memoria (puede traer datos de clientes): solo su tipo, importancia, uso y vencimiento.</p>
        <p className="text-xs text-muted-foreground">Puedes apagar una memoria que esté mal y volver a encenderla; no se borra ni se edita nada.</p>
      </div>
      {memorias.isLoading ? <p className="text-sm text-muted-foreground" role="status">Leyendo la memoria de los agentes…</p>
        : memorias.isError ? <p role="alert" className="zen-glass rounded-2xl p-3 text-sm text-destructive" data-testid="memoria-error">{(memorias.error as Error).message}</p> : (
          <>
            <ul className="flex flex-wrap gap-2 text-xs text-muted-foreground" aria-label="Resumen de memorias" data-testid="memoria-resumen">
              <li className="rounded-full border border-border/50 px-2.5 py-0.5">Memorias: {total.total}</li>
              <li className="rounded-full border border-border/50 px-2.5 py-0.5">Activas: {total.activas}</li>
              {total.apagadas > 0 && <li className="rounded-full border border-border/50 px-2.5 py-0.5">Apagadas: {total.apagadas}</li>}
              {total.vencidas > 0 && <li className="rounded-full border border-border/50 px-2.5 py-0.5">Vencidas: {total.vencidas}</li>}
            </ul>
            <div className="zen-glass rounded-3xl p-4">
              <SelectorAgentes agentes={lista} valor={agenteId} onCambio={setAgenteId} testid="mem-sel" etiqueta="Agente" detalle={detalle} />
            </div>
            {elegido && (
              <section className="zen-glass space-y-2 rounded-3xl p-4" aria-label={`Memoria de ${nombreAgente(elegido)}`} data-testid="memoria-panel">
                <h2 className="text-base font-medium">Memoria de {nombreAgente(elegido)}</h2>
                {suyas.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="memoria-vacia">Este agente aún no tiene memorias.</p> : (
                  <ul className="space-y-1.5" data-testid="memoria-lista">
                    {suyas.map((m) => <Fila key={m.id} m={m} ahora={ahora} ocupado={trabajando === m.id} onCambiar={(a) => cambiarMemoria(m.id, a)} />)}
                  </ul>
                )}
                {cambiar.isError && <p role="alert" className="text-sm text-destructive" data-testid="memoria-fallo">{(cambiar.error as Error).message}</p>}
                {trabajando && <p className="flex items-center gap-1 text-xs text-muted-foreground" role="status"><Loader2 className="h-3 w-3 animate-spin" />Guardando…</p>}
              </section>
            )}
          </>
        )}
    </div>
  );
}
