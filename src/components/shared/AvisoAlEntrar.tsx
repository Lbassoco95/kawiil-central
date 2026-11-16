import { useMemo, useState } from "react";
import { Megaphone } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useComunicadosAviso } from "@/hooks/useInternalDespacho";
import { avisosAlEntrar, hoyCDMX, leerVistos, marcarVistos, textoVigencia } from "@/lib/comunicados";

/**
 * Aviso al abrir el sistema: muestra los comunicados publicados con «avisar al entrar» cuya vigencia incluye hoy (por ejemplo, un día no laborable).
 * Aparece una vez por persona al día en este navegador. Todo el texto se pinta como texto. Si no hay avisos, o la base aún no tiene las columnas nuevas, no muestra nada.
 */
export function AvisoAlEntrar() {
  const { data } = useComunicadosAviso();
  const hoy = hoyCDMX();
  const [cerrados, setCerrados] = useState<ReadonlySet<string>>(new Set());
  const pendientes = useMemo(() => avisosAlEntrar(data ?? [], hoy, leerVistos(hoy)).filter((c) => !cerrados.has(c.id)), [data, hoy, cerrados]);
  if (pendientes.length === 0) return null;

  const cerrar = () => {
    const ids = pendientes.map((c) => c.id);
    marcarVistos(ids, hoy);
    setCerrados((antes) => new Set([...antes, ...ids]));
  };
  return (
    <Dialog open onOpenChange={(abierto) => { if (!abierto) cerrar(); }}>
      <DialogContent className="max-w-md" data-testid="aviso-al-entrar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-primary" aria-hidden />{pendientes.length === 1 ? "Aviso para el equipo" : "Avisos para el equipo"}</DialogTitle>
          <DialogDescription className="sr-only">Comunicado interno de Kawiil.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {pendientes.map((c) => (
            <section key={c.id} className="space-y-1" data-testid="aviso-item">
              <h3 className="text-sm font-medium">{c.title}</h3>
              {c.vigente_desde && c.vigente_hasta && <p className="text-xs capitalize text-muted-foreground">{textoVigencia(c.vigente_desde, c.vigente_hasta)}</p>}
              {c.body && <p className="whitespace-pre-wrap text-sm text-foreground/90">{c.body}</p>}
            </section>
          ))}
        </div>
        <DialogFooter><Button onClick={cerrar} data-testid="aviso-entendido">Entendido</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
