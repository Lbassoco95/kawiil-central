// Textos de las reglas con los valores vigentes (sin «N»). Solo lectura: no inventa valores;
// si falta un parámetro, deja la descripción como está en la base.
type Params = Record<string, unknown>;

const num = (p: Params, k: string): number | null => (typeof p[k] === "number" && Number.isFinite(p[k] as number) ? (p[k] as number) : null);
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function descripcionVigente(codigo: string, descripcion: string | null, p: Params): string {
  const base = descripcion ?? "";
  switch (codigo) {
    case "publicacion": {
      const m = num(p, "minutos_tolerancia");
      return m === null ? base : `A los ${plural(m, "minuto", "minutos")} de la hora programada la pieza debe aparecer publicada en las tres redes; si no, caso.`;
    }
    case "huecos": {
      const d = num(p, "dias_maximos");
      return d === null ? base : `Si una red pasa más de ${plural(d, "día", "días")} sin publicar lo planeado, caso.`;
    }
    case "dato_sospechoso": {
      const h = num(p, "horas_minimas");
      return h === null ? base : `Pieza con cero de alcance o impresiones y más de ${plural(h, "hora", "horas")} desde su publicación: caso de verificación «dato sospechoso, verificar si se publicó». El cero cuenta en el promedio del semáforo.`;
    }
    case "estado_gris": {
      const dentro = num(p, "minutos_dentro_ventana");
      const fuera = num(p, "minutos_fuera_ventana");
      if (dentro === null || fuera === null) return base;
      return `Sin consulta exitosa a Metricool en ${plural(dentro, "minuto", "minutos")} dentro de la ventana de publicación (${fuera} fuera de ella), la red pasa a gris y se abre caso de falla de monitoreo.`;
    }
    case "ventana_publicacion": {
      const dentro = num(p, "minutos_dentro");
      const fuera = num(p, "minutos_fuera");
      if (dentro === null || fuera === null) return base;
      const antes = num(p, "antes_primera_min");
      const despues = num(p, "despues_ultima_min");
      const ventana = antes !== null && despues !== null ? ` La ventana va de ${antes} minutos antes de la primera publicación del día a ${despues} minutos después de la última.` : "";
      return `Cada ${plural(dentro, "minuto", "minutos")} dentro de la ventana de publicación y cada ${fuera === 60 ? "hora" : plural(fuera, "minuto", "minutos")} fuera de ella.${ventana}`;
    }
    default:
      return base;
  }
}

export const ETIQUETA_PARAMETRO: Record<string, string> = {
  minutos_tolerancia: "Tolerancia (minutos)",
  dias_maximos: "Días máximos sin publicar",
  horas_minimas: "Horas mínimas",
  valor: "Valor considerado sospechoso",
  minutos_dentro_ventana: "Gris dentro de la ventana (minutos)",
  minutos_fuera_ventana: "Gris fuera de la ventana (minutos)",
  minutos_dentro: "Frecuencia dentro de la ventana (minutos)",
  minutos_fuera: "Frecuencia fuera de la ventana (minutos)",
  antes_primera_min: "Ventana: minutos antes de la primera publicación",
  despues_ultima_min: "Ventana: minutos después de la última",
  medida: "Medida",
  verde_desde: "Verde desde",
  amarillo_desde: "Amarillo desde",
  dia_semana: "Día de la semana (1 = lunes)",
  zona: "Zona horaria",
  criterio: "Criterio de semana",
  cortes_horas: "Cortes (horas)",
  fechas: "Fechas de revisión",
  semanas_senal: "Semanas en rojo para señalar",
  semanas_caso_revisor: "Semanas en rojo para caso del Revisor",
  caso_solo_con_lectura_definitiva: "Caso solo con lectura definitiva",
};

export function valorLegible(v: unknown): string {
  if (Array.isArray(v)) return v.map(valorLegible).join(", ");
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (v === null || v === undefined) return "—";
  return String(v);
}

export function listaParametros(p: Params | null | undefined): Array<{ clave: string; etiqueta: string; valor: string }> {
  return Object.entries(p ?? {}).map(([clave, v]) => ({ clave, etiqueta: ETIQUETA_PARAMETRO[clave] ?? clave, valor: valorLegible(v) }));
}

// Cambios entre dos versiones de parámetros (para el historial).
export function cambiosParametros(antes: Params | null | undefined, despues: Params | null | undefined) {
  const a = antes ?? {};
  const d = despues ?? {};
  return [...new Set([...Object.keys(a), ...Object.keys(d)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(d[k]))
    .map((k) => ({ etiqueta: ETIQUETA_PARAMETRO[k] ?? k, antes: valorLegible(a[k]), despues: valorLegible(d[k]) }));
}

export interface UmbralSemaforo { codigo: string; red: string; medida: string; verde: number; amarillo: number }

// Umbrales de los tres semáforos, leídos de las reglas vigentes. Rojo = por debajo del amarillo.
export function umbralesSemaforo(reglas: Array<{ codigo: string; parametros: Params; activa: boolean }>): UmbralSemaforo[] {
  const redes: Array<[string, string]> = [["semaforo_instagram", "Instagram"], ["semaforo_facebook", "Facebook"], ["semaforo_linkedin", "LinkedIn"]];
  const salida: UmbralSemaforo[] = [];
  for (const [codigo, red] of redes) {
    const r = reglas.find((x) => x.codigo === codigo && x.activa);
    const verde = r ? num(r.parametros, "verde_desde") : null;
    const amarillo = r ? num(r.parametros, "amarillo_desde") : null;
    if (r && verde !== null && amarillo !== null) {
      salida.push({ codigo, red, medida: String(r.parametros.medida ?? ""), verde, amarillo });
    }
  }
  return salida;
}
