import { RED_LABEL, REDES, type Calibracion, type Regla } from "@/hooks/useMarketing";
import { NOTA_UMBRAL_INSTAGRAM, OBSERVACION_UMBRAL_INSTAGRAM } from "./notasUmbral";
import { UmbralesSemaforo } from "./UmbralesSemaforo";
import { COLOR_LABEL, MOTIVO_GRIS, Pastilla, esProvisional, fechaCorta, Vacio } from "./marketingUi";

export function Semaforo({ calibracion, reglas }: { calibracion: Calibracion[]; reglas: Regla[] }) {
  const semanas = [...new Set(calibracion.map((c) => c.semana_inicio))].sort().reverse();
  if (semanas.length === 0) return <Vacio>Aún no hay lecturas semanales.</Vacio>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Semana de lunes a domingo, hora de Ciudad de México. Promedio simple por pieza publicada. «Provisional» significa que aún hay piezas con menos de 7 días.
        Los números son los calculados con las cifras del Calendario Maestro; «archivo» es la cifra semanal del propio archivo (solo Instagram la trae).
      </p>
      <UmbralesSemaforo reglas={reglas} />
      <div className="zen-glass rounded-2xl p-4 text-sm text-muted-foreground">
        <p><span className="font-medium text-foreground">Instagram.</span> {NOTA_UMBRAL_INSTAGRAM}</p>
        <p className="mt-2">{OBSERVACION_UMBRAL_INSTAGRAM}</p>
      </div>
      <div className="zen-glass overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
              <th className="p-3 font-medium">Semana</th>
              {REDES.map((r) => <th key={r} className="p-3 font-medium">{RED_LABEL[r]}</th>)}
            </tr>
          </thead>
          <tbody>
            {semanas.map((s) => (
              <tr key={s} className="border-b border-border/40 align-top last:border-0">
                <td className="whitespace-nowrap p-3 text-muted-foreground">{fechaCorta(s)}</td>
                {REDES.map((red) => {
                  const c = calibracion.find((x) => x.semana_inicio === s && x.red === red);
                  if (!c) return <td key={red} className="p-3 text-muted-foreground">—</td>;
                  const color = c.color_calculado ?? "gris";
                  return (
                    <td key={red} className="space-y-1 p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Pastilla color={color}>{COLOR_LABEL[color]}</Pastilla>
                        {esProvisional(c) && <Pastilla color="amarillo">Provisional</Pastilla>}
                      </div>
                      {color === "gris" ? (
                        <p className="text-xs text-muted-foreground">{MOTIVO_GRIS[c.motivo_gris ?? ""] ?? ""}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {Number(c.promedio_calculado).toFixed(1)} en {c.piezas_calculadas} piezas
                          {c.promedio_calendario !== null && ` · archivo ${Number(c.promedio_calendario).toFixed(1)}`}
                        </p>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
