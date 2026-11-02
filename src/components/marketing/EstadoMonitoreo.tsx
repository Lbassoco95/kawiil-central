import { useEffect, useState } from "react";
import type { ColchonLectura, CorridaVigilante } from "@/hooks/useMarketing";
import { Pastilla, fechaCorta } from "./marketingUi";
import { corridaConFalla, sinLecturaDeHoy } from "./monitoreo";

export type EstadoBitacora = "cargando" | "error" | "ok";

function horaCorta(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Mexico_City" });
}

// Aviso de salud del monitoreo: si pasadas las 7:30 no hay lectura real del día, lo dice; y muestra la última corrida del Vigilante.
export function EstadoMonitoreo({ lecturas, ultimaCorrida, estadoBitacora, ahora }: {
  lecturas: ColchonLectura[]; ultimaCorrida: CorridaVigilante | null; estadoBitacora: EstadoBitacora; ahora?: Date;
}) {
  const [reloj, setReloj] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setReloj(new Date()), 60_000); return () => clearInterval(t); }, []);
  const { aviso, ultima } = sinLecturaDeHoy(lecturas, ahora ?? reloj);
  const falla = ultimaCorrida ? corridaConFalla(ultimaCorrida) : false;
  return (
    <section data-testid="estado-monitoreo" className="space-y-2">
      {aviso && (
        <div role="alert" data-testid="aviso-sin-lectura" className="rounded-2xl border border-amber-200 bg-amber-100/80 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
          <p className="font-medium">
            Sin lectura de hoy: {ultima ? `la última es del ${fechaCorta(ultima)}` : "todavía no hay ninguna lectura real"}.
          </p>
          <p className="text-xs">El colchón y el informe que ve abajo pueden estar desactualizados. Revise el caso «Falla de monitoreo» en la pestaña Casos.</p>
        </div>
      )}
      <div className="zen-glass flex flex-wrap items-center gap-2 rounded-2xl p-3 text-sm" data-testid="ultima-corrida">
        <span className="font-medium">Última corrida del Vigilante:</span>
        {estadoBitacora === "cargando" ? <span className="text-muted-foreground">leyendo…</span>
          : estadoBitacora === "error" ? <span className="text-muted-foreground">no se pudo leer la bitácora de agentes</span>
          : !ultimaCorrida ? <span className="text-muted-foreground">todavía no hay corridas</span>
          : (
            <>
              <span>{horaCorta(ultimaCorrida.registrado_at)}</span>
              <Pastilla color={falla ? "rojo" : "verde"}>{falla ? "Con falla" : "Correcta"}</Pastilla>
              <span className="text-muted-foreground">{ultimaCorrida.resultado}{ultimaCorrida.detalle?.simulada ? " (prueba con fecha fija)" : ""}</span>
            </>
          )}
      </div>
    </section>
  );
}
