import { RED_LABEL, REDES, type Pieza } from "@/hooks/useMarketing";
import { EstadoRed, fechaCorta, Vacio } from "./marketingUi";

export function Calendario({ piezas }: { piezas: Pieza[] }) {
  if (piezas.length === 0) return <Vacio>Aún no hay piezas cargadas.</Vacio>;
  return (
    <div className="zen-glass overflow-x-auto rounded-2xl">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
            <th className="p-3 font-medium">Fecha</th><th className="p-3 font-medium">Pieza</th>
            <th className="p-3 font-medium">Pilar</th><th className="p-3 font-medium">Formato</th>
            {REDES.map((r) => <th key={r} className="p-3 font-medium">{RED_LABEL[r]}</th>)}
          </tr>
        </thead>
        <tbody>
          {piezas.map((p) => (
            <tr key={p.id} className="border-b border-border/40 last:border-0">
              <td className="whitespace-nowrap p-3 text-muted-foreground">{fechaCorta(p.fecha)}</td>
              <td className="p-3">{p.titulo}</td>
              <td className="p-3 text-muted-foreground">{p.pilar ?? "—"}</td>
              <td className="p-3 text-muted-foreground">{p.formato ?? "sin dato"}</td>
              {REDES.map((red) => (
                <td key={red} className="p-3"><EstadoRed pr={p.mk_pieza_red.find((r) => r.red === red)} fecha={p.fecha} red={red} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
