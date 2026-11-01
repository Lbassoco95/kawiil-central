import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Regla, ReglaHistorial } from "@/hooks/useMarketing";
import { NOTA_UMBRAL_INSTAGRAM, OBSERVACION_UMBRAL_INSTAGRAM } from "./notasUmbral";
import { Pastilla, fechaCorta, Vacio } from "./marketingUi";
import { UmbralesSemaforo } from "./UmbralesSemaforo";
import { cambiosParametros, descripcionVigente, listaParametros } from "./reglasValores";

export function Reglas({ reglas, historial, puedeDecidir }: { reglas: Regla[]; historial: ReglaHistorial[]; puedeDecidir: boolean }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  if (reglas.length === 0) return <Vacio>Aún no hay reglas.</Vacio>;
  return (
    <div className="space-y-3">
      <UmbralesSemaforo reglas={reglas} />
      {reglas.map((r) => {
        const h = historial.filter((x) => x.regla_id === r.id);
        const open = abierta === r.id;
        return (
          <div key={r.id} className="zen-glass rounded-2xl">
            <button type="button" onClick={() => setAbierta(open ? null : r.id)} className="flex w-full items-start gap-3 p-4 text-left">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{r.codigo}</span><span>· versión {r.version}</span>
                  <Pastilla color={r.activa ? "verde" : "gris"}>{r.activa ? "Vigente" : "Inactiva"}</Pastilla>
                </div>
                <p className="mt-1 text-sm font-medium">{r.nombre}</p>
                {r.descripcion && <p className="text-sm text-muted-foreground">{descripcionVigente(r.codigo, r.descripcion, r.parametros)}</p>}
              </div>
              <ChevronDown className={"mt-1 h-4 w-4 shrink-0 transition-transform " + (open ? "rotate-180" : "")} />
            </button>
            {open && (
              <div className="space-y-3 border-t border-border/50 p-4 text-sm">
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Parámetros vigentes</p>
                  <dl className="space-y-1 rounded-xl bg-background/50 p-3 text-xs" data-testid={`parametros-${r.codigo}`}>
                    {listaParametros(r.parametros).length === 0 && <p className="text-muted-foreground">Sin parámetros.</p>}
                    {listaParametros(r.parametros).map((x) => (
                      <div key={x.clave} className="flex justify-between gap-3"><dt className="text-muted-foreground">{x.etiqueta}</dt><dd className="font-medium">{x.valor}</dd></div>
                    ))}
                  </dl>
                </div>
                {r.codigo === "semaforo_instagram" && !(r.descripcion ?? "").toLowerCase().includes("umbral inicial") && (
                  <div className="rounded-xl bg-background/50 p-3 text-xs text-muted-foreground">
                    <p>{NOTA_UMBRAL_INSTAGRAM}</p><p className="mt-1">{OBSERVACION_UMBRAL_INSTAGRAM}</p>
                  </div>
                )}
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Historial ({h.length})</p>
                  {h.map((x) => {
                    const cambios = x.parametros_anteriores ? cambiosParametros(x.parametros_anteriores, x.parametros_nuevos) : [];
                    return (
                      <div key={x.id} className="mb-1.5 text-xs text-muted-foreground" data-testid={`historial-${r.codigo}`}>
                        <p>v{x.version} · {fechaCorta(x.cambiado_at)} · {x.motivo}{!x.activa && " · inactiva"}</p>
                        {!x.parametros_anteriores && <p className="pl-3">Versión inicial.</p>}
                        {cambios.map((c) => <p key={c.etiqueta} className="pl-3">{c.etiqueta}: {c.antes} → {c.despues}</p>)}
                      </div>
                    );
                  })}
                  {h.length === 0 && <p className="text-xs text-muted-foreground">Sin cambios registrados.</p>}
                </div>
                {puedeDecidir && <Button size="sm" variant="outline" disabled title="Aún no está conectado a ninguna acción">Cambiar regla</Button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
