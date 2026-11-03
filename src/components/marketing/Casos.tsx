import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RED_LABEL, type Caso } from "@/hooks/useMarketing";
import { tipoCaso } from "./PanelDia";
import { Pastilla, fechaCorta, Vacio } from "./marketingUi";

export function Casos({ casos, puedeDecidir }: { casos: Caso[]; puedeDecidir: boolean }) {
  const [abierto, setAbierto] = useState<string | null>(casos.find((c) => c.tipo === "investigacion")?.id ?? null);
  if (casos.length === 0) return <Vacio>No hay casos.</Vacio>;
  return (
    <div className="space-y-3">
      {casos.map((c) => {
        const ev = Array.isArray(c.evidencia) ? c.evidencia : [];
        const open = abierto === c.id;
        return (
          <div key={c.id} className="zen-glass rounded-2xl">
            <button type="button" onClick={() => setAbierto(open ? null : c.id)} className="flex w-full items-start gap-3 p-4 text-left">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>#{c.numero}</span><span>{tipoCaso(c.tipo)}</span>{c.red && <span>{RED_LABEL[c.red]}</span>}
                  <span>· {fechaCorta(c.detectado_at)}</span><span>· a cargo: {c.responsable}</span>
                  <Pastilla color={c.estado === "cerrado" ? "verde" : "amarillo"}>{c.estado.replace("_", " ")}</Pastilla>
                  {ev.length > 0 && <span>· {ev.length} elementos de evidencia</span>}
                </div>
                <p className="mt-1 text-sm font-medium">{c.titulo}</p>
              </div>
              <ChevronDown className={"mt-1 h-4 w-4 shrink-0 transition-transform " + (open ? "rotate-180" : "")} />
            </button>
            {open && (
              <div className="space-y-3 border-t border-border/50 p-4 text-sm">
                {c.descripcion && <p className="text-muted-foreground">{c.descripcion}</p>}
                {ev.length > 0 && (
                  <ol className="space-y-2">
                    {ev.map((e, i) => (
                      <li key={i} className="rounded-xl bg-background/50 p-3">
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium">{e.tipo === "hipotesis" ? "Hipótesis" : "Hecho"}</span>
                          {e.estado && <Pastilla color="gris">{e.estado}</Pastilla>}
                        </div>
                        <p>{e.dato}</p>
                        {e.fuente && <p className="mt-1 text-xs text-muted-foreground">Fuente: {e.fuente}</p>}
                      </li>
                    ))}
                  </ol>
                )}
                {puedeDecidir && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="outline" disabled title="Aún no está conectado a ninguna acción">Aprobar</Button>
                    <Button size="sm" variant="outline" disabled title="Aún no está conectado a ninguna acción">Rechazar</Button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
