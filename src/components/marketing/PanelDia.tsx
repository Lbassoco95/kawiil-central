import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RED_LABEL, REDES, type Calibracion, type Caso, type Cobertura, type ColchonLectura, type InformeDiario, type Pieza, type Red } from "@/hooks/useMarketing";
import { ColchonPanel, InformeDia } from "./ColchonInforme";
import { EstadoRed, MOTIVO_GRIS, Pastilla, COLOR_LABEL, esProvisional, fechaCorta, Vacio } from "./marketingUi";

const TIPO_CASO: Record<string, string> = {
  investigacion: "Investigación", dato_sospechoso: "Dato sospechoso", publicacion: "Publicación", error: "Error",
  hueco: "Hueco", conexion: "Conexión", semaforo_rojo: "Semáforo rojo", semaforo_rojo_2_semanas: "Rojo 2 semanas",
  falla_monitoreo: "Falla de monitoreo", colchon: "Colchón bajo", otro: "Otro",
};
export const tipoCaso = (t: string) => TIPO_CASO[t] ?? t;

export function PanelDia({ calibracion, piezas, casos, cobertura, colchon, informe }: {
  calibracion: Calibracion[]; piezas: Pieza[]; casos: Caso[]; cobertura: Cobertura[]; colchon: ColchonLectura[]; informe: InformeDiario | null;
}) {
  const ultima = (red: Red) => calibracion.filter((c) => c.red === red).sort((a, b) => b.semana_inicio.localeCompare(a.semana_inicio))[0];
  const abiertos = casos.filter((c) => c.estado !== "cerrado");
  const recientes = piezas.slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="zen-glass rounded-2xl p-4 text-sm text-muted-foreground">
        El colchón y el informe se leen de Metricool (solo lectura). El estado semanal de cada red viene del Calendario Maestro
        (corte del 31 de octubre de 2026): es la última semana calculada, no el de hoy.
      </div>

      <ColchonPanel lecturas={colchon} />
      <InformeDia informe={informe} />

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Estado de cada red · última semana calculada</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {REDES.map((red) => {
            const c = ultima(red);
            const color = c?.color_calculado ?? "gris";
            return (
              <Card key={red} className="zen-glass rounded-2xl">
                <CardHeader className="pb-2"><CardTitle className="text-base">{RED_LABEL[red]}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {c ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Pastilla color={color}>{COLOR_LABEL[color]}</Pastilla>
                        {esProvisional(c) && <Pastilla color="amarillo">Lectura provisional</Pastilla>}
                      </div>
                      <p className="text-sm">Semana del {fechaCorta(c.semana_inicio)}</p>
                      {color === "gris" ? (
                        <p className="text-sm text-muted-foreground">{MOTIVO_GRIS[c.motivo_gris ?? ""] ?? "Sin causa registrada"}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Promedio {c.promedio_calculado !== null ? Number(c.promedio_calculado).toFixed(1) : "—"} · {c.piezas_calculadas ?? 0} piezas
                        </p>
                      )}
                    </>
                  ) : <p className="text-sm text-muted-foreground">Sin lectura todavía</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Piezas recientes</h2>
          <div className="space-y-2">
            {recientes.length === 0 && <Vacio>Aún no hay piezas.</Vacio>}
            {recientes.map((p) => (
              <div key={p.id} className="zen-glass rounded-2xl p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{p.titulo}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{fechaCorta(p.fecha)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {REDES.map((red) => (
                    <span key={red} className="flex items-center gap-1 text-xs text-muted-foreground">
                      {RED_LABEL[red].slice(0, 2)}
                      <EstadoRed pr={p.mk_pieza_red.find((r) => r.red === red)} fecha={p.fecha} red={red} />
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Casos abiertos ({abiertos.length})</h2>
          <div className="space-y-2">
            {abiertos.length === 0 && <Vacio>No hay casos abiertos.</Vacio>}
            {abiertos.map((c) => (
              <div key={c.id} className="zen-glass rounded-2xl p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>#{c.numero}</span><span>{tipoCaso(c.tipo)}</span>
                  {c.red && <span>{RED_LABEL[c.red]}</span>}<span>· a cargo: {c.responsable}</span>
                </div>
                <p className="mt-1 text-sm">{c.titulo}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="zen-glass rounded-2xl p-4 text-sm">
        <h2 className="mb-2 font-medium">Lo que todavía se ve incompleto</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {cobertura.filter((c) => c.red === "instagram").map((c) => (
            <li key={c.red + c.desde}>Instagram: el archivo cubre del {fechaCorta(c.desde)} al {fechaCorta(c.hasta)}; antes de esa fecha las piezas aparecen como «sin dato del archivo».</li>
          ))}
          <li>Facebook y LinkedIn no traen cifra semanal en el archivo: su semáforo es solo el calculado.</li>
          <li>Todas las horas de publicación son estimadas (11:00) y no se infirió el propósito de ninguna pieza.</li>
        </ul>
      </section>
    </div>
  );
}
