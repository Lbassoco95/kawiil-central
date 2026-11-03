import { umbralesSemaforo } from "./reglasValores";
import { Pastilla } from "./marketingUi";
import type { Regla } from "@/hooks/useMarketing";

// Umbrales vigentes de los tres semáforos, tomados de las reglas (no escritos a mano).
export function UmbralesSemaforo({ reglas }: { reglas: Regla[] }) {
  const u = umbralesSemaforo(reglas);
  if (u.length === 0) return null;
  return (
    <div className="zen-glass rounded-2xl p-4" data-testid="umbrales-semaforo">
      <p className="mb-3 text-sm font-medium">Umbrales vigentes (promedio por pieza de la semana, a 7 días)</p>
      <div className="grid gap-3 md:grid-cols-3">
        {u.map((x) => (
          <div key={x.codigo} className="space-y-1.5 rounded-xl bg-background/50 p-3 text-sm" data-testid={`umbral-${x.codigo}`}>
            <p className="font-medium">{x.red} <span className="text-xs font-normal text-muted-foreground">({x.medida})</span></p>
            <p><Pastilla color="verde">Verde</Pastilla> <span className="ml-1">desde {x.verde}</span></p>
            <p><Pastilla color="amarillo">Amarillo</Pastilla> <span className="ml-1">de {x.amarillo} a menos de {x.verde}</span></p>
            <p><Pastilla color="rojo">Rojo</Pastilla> <span className="ml-1">por debajo de {x.amarillo}</span></p>
          </div>
        ))}
      </div>
    </div>
  );
}
