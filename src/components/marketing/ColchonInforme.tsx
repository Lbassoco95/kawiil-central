import { RED_LABEL, REDES, type ColchonLectura, type InformeDiario, type Red } from "@/hooks/useMarketing";
import { COLOR_LABEL, Pastilla, fechaCorta, Vacio } from "./marketingUi";

const META_DIAS = 14;

// Última lectura de cada red (las lecturas llegan ordenadas de la más reciente a la más antigua).
function ultimaLectura(lecturas: ColchonLectura[], red: Red): ColchonLectura | undefined {
  return lecturas.find((l) => l.red === red);
}

export function ColchonPanel({ lecturas }: { lecturas: ColchonLectura[] }) {
  const alguna = REDES.map((r) => ultimaLectura(lecturas, r)).find(Boolean);
  return (
    <section data-testid="colchon-panel">
      <h2 className="mb-1 text-sm font-medium text-muted-foreground">Colchón de programación · días con piezas programadas en Metricool</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Días desde hoy hasta la última pieza programada de cada red. Meta: {META_DIAS} días o más. Verde desde 14, amarillo de 7 a 13, rojo por debajo de 7.
      </p>
      {!alguna ? (
        <Vacio>Aún no hay lecturas del colchón.</Vacio>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {REDES.map((red) => {
              const l = ultimaLectura(lecturas, red);
              return (
                <div key={red} className="zen-glass rounded-2xl p-4" data-testid={`colchon-${red}`}>
                  <p className="text-base font-medium">{RED_LABEL[red]}</p>
                  {l ? (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pastilla color={l.color}>{COLOR_LABEL[l.color]}</Pastilla>
                        <span className="text-2xl font-semibold">{l.dias}{l.tope ? "+" : ""}</span>
                        <span className="text-sm text-muted-foreground">{l.dias === 1 ? "día" : "días"}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {l.ultima_programada ? `Última pieza programada: ${fechaCorta(l.ultima_programada)}` : "Sin piezas programadas"} · {l.programadas} programadas
                      </p>
                    </div>
                  ) : <p className="mt-2 text-sm text-muted-foreground">Sin lectura</p>}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Lectura del {fechaCorta(alguna.fecha)}.{alguna.simulada && " Lectura de prueba con fecha fija, no la del día."}
          </p>
        </>
      )}
    </section>
  );
}

export function InformeDia({ informe }: { informe: InformeDiario | null }) {
  if (!informe) return <section data-testid="informe-dia"><h2 className="mb-3 text-sm font-medium text-muted-foreground">Informe de faltantes</h2><Vacio>Aún no hay informe.</Vacio></section>;
  const c = informe.contenido;
  const fila = (x: { red: Red; fecha: string; hora: string }) => `${RED_LABEL[x.red]} · ${fechaCorta(x.fecha)} ${x.hora}`;
  return (
    <section data-testid="informe-dia" className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">
        Informe de faltantes · {fechaCorta(informe.fecha)}{informe.simulada && " (prueba con fecha fija)"}
      </h2>
      <div className="zen-glass space-y-4 rounded-2xl p-4 text-sm">
        <div>
          <p className="mb-1 font-medium">Qué necesita Dirección</p>
          {c.necesita_direccion.length === 0 ? <p className="text-muted-foreground">Nada por cerrar.</p> : (
            <ul className="list-disc space-y-1 pl-5" data-testid="informe-necesita">{c.necesita_direccion.map((t, i) => <li key={i}>{t}</li>)}</ul>
          )}
        </div>
        <div>
          <p className="mb-1 font-medium">Piezas del Calendario Maestro de los próximos {c.ventana_dias} días sin programar ({c.faltantes.length})</p>
          {c.piezas_calendario_en_ventana === 0
            ? <p className="text-muted-foreground">El calendario no tiene piezas cargadas en esos días.</p>
            : c.faltantes.length === 0 ? <p className="text-muted-foreground">Todas las piezas del calendario están programadas.</p>
            : <ul className="space-y-1" data-testid="informe-faltantes">{c.faltantes.map((f, i) => <li key={i}>{fila(f)} · {f.pilar ?? "sin pilar"} · {f.formato ?? "sin formato"}</li>)}</ul>}
        </div>
        <div>
          <p className="mb-1 font-medium">Piezas programadas con error ({c.con_error.length})</p>
          {c.con_error.length === 0 ? <p className="text-muted-foreground">Ninguna.</p> : <ul className="space-y-1">{c.con_error.map((x, i) => <li key={i}>{fila(x)} · {x.estado}</li>)}</ul>}
        </div>
        {c.desconocidos.length > 0 && (
          <div>
            <p className="mb-1 font-medium">Piezas con estado que el módulo no reconoce ({c.desconocidos.length})</p>
            <ul className="space-y-1">{c.desconocidos.map((x, i) => <li key={i}>{fila(x)} · {x.estado}</li>)}</ul>
          </div>
        )}
      </div>
    </section>
  );
}
