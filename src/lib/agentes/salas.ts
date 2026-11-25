// Salas isométricas: cómo se acomodan los agentes dentro de la sala de cada isla (departamento).
// Las posiciones salen del diseño (docs/diseno-oficina-agentes) y están en celdas de la sala, con las claves reales del registro (`agent_registry.name`).
// Un agente que no está en la tabla (uno nuevo del Constructor) se acomoda solo en el primer lugar libre y la sala crece si hace falta: nunca se queda fuera.
export interface DisenoSala { n: number; zonas: Array<[string, string[]]>; posiciones: Record<string, [number, number]> }

export const SALAS: Record<string, DisenoSala> = {
  juridico: { n: 7, zonas: [["Dirección", ["tlahtoani"]], ["Archivo", ["amatl"]], ["Poderes y apoyo", ["tepantli", "tequitl"]]], posiciones: {"tlahtoani": [1.8, 1.8], "amatl": [4.9, 1.8], "tepantli": [1.8, 4.9], "tequitl": [4.9, 4.9]} },
  gestoria: { n: 7, zonas: [["Gestoría", ["yollotl", "coyolli"]], ["Redacción y documentos", ["tlahtolli", "tochtli"]]], posiciones: {"yollotl": [1.8, 1.8], "coyolli": [4.9, 1.8], "tlahtolli": [1.8, 4.9], "tochtli": [4.9, 4.9]} },
  fiscal: { n: 9, zonas: [["Fiscal y contabilidad", ["atl", "balam", "teocuitl"]], ["Conciliación y finanzas", ["ollin", "metztli"]]], posiciones: {"atl": [1.6, 1.6], "balam": [4.5, 1.6], "teocuitl": [7.4, 1.6], "ollin": [1.6, 4.5], "metztli": [4.5, 4.5]} },
  acervo: { n: 9, zonas: [["Consulta", ["legal_socratic_jurist", "legal_archivist", "legal_contradiction_detector"]], ["Vigilancia y estrategia", ["legal_dof_watchdog", "legal_litigation_strategist", "legal_cross_referencer"]]], posiciones: {"legal_socratic_jurist": [1.6, 1.6], "legal_archivist": [4.5, 1.6], "legal_contradiction_detector": [7.4, 1.6], "legal_dof_watchdog": [1.6, 4.5], "legal_litigation_strategist": [4.5, 4.5], "legal_cross_referencer": [7.4, 4.5]} },
  cumplimiento: { n: 6, zonas: [["Listas y KYC", ["nelli", "vizumi_listas_y_kyc_vizum_vizum"]]], posiciones: {"nelli": [1.6, 3.0], "vizumi_listas_y_kyc_vizum_vizum": [4.4, 3.0]} },
  otros: { n: 5, zonas: [["Verificación", ["kawiil_verificador_metricool"]]], posiciones: {"kawiil_verificador_metricool": [2.5, 2.5]} },
  marketing: { n: 9, zonas: [["Dirección", ["marketing_cmo"]], ["Monitoreo", ["marketing_vigilante", "marketing_informe_diario", "marketing_vigia"]], ["Análisis y comunicación", ["marketing_analista", "marketing_investigador", "marketing_comunicacion_interna"]]], posiciones: {"marketing_cmo": [4.5, 1.6], "marketing_vigilante": [1.6, 4.5], "marketing_informe_diario": [4.5, 4.5], "marketing_vigia": [7.4, 4.5], "marketing_analista": [1.6, 7.4], "marketing_investigador": [4.5, 7.4], "marketing_comunicacion_interna": [7.4, 7.4]} },
};

export const PASO = 2.9, ORIGEN = 1.6;   // separación entre escritorios y primer lugar, en celdas
export interface Puesto<T> { item: T; clave: string; u: number; v: number }
export interface ZonaSala { nombre: string; claves: string[]; u0: number; v0: number; u1: number; v1: number }
export interface SalaCalculada<T> { n: number; puestos: Array<Puesto<T>>; zonas: ZonaSala[] }

const lugaresLibres = (n: number): Array<[number, number]> => {
  const l: Array<[number, number]> = [];
  for (let v = ORIGEN; v < n - 1; v += PASO) for (let u = ORIGEN; u < n - 1; u += PASO) l.push([u, v]);
  return l;
};
const cerca = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < PASO - 0.4 && Math.abs(a[1] - b[1]) < PASO - 0.4;

/** Acomoda a los agentes de una isla. `clave` de cada uno = nombre real en el registro. */
export function distribuirSala<T>(deptoClave: string, items: T[], claveDe: (t: T) => string): SalaCalculada<T> {
  const d = SALAS[deptoClave];
  const conocidos = items.filter((t) => d?.posiciones[claveDe(t)]);
  const nuevos = items.filter((t) => !d?.posiciones[claveDe(t)]);
  let n = d?.n ?? 6;
  const ocupados: Array<[number, number]> = conocidos.map((t) => d.posiciones[claveDe(t)]);
  const sitios = (m: number) => lugaresLibres(m).filter((p) => !ocupados.some((o) => cerca(o, p)));
  while (sitios(n).length < nuevos.length) n += 3;   // la sala crece una fila/columna de escritorios
  const libres = sitios(n);
  const puestos: Array<Puesto<T>> = [
    ...conocidos.map((t) => ({ item: t, clave: claveDe(t), u: d.posiciones[claveDe(t)][0], v: d.posiciones[claveDe(t)][1] })),
    ...nuevos.map((t, i) => ({ item: t, clave: claveDe(t), u: libres[i][0], v: libres[i][1] })),
  ];
  const caja = (cs: string[], nombre: string): ZonaSala | null => {
    const ps = puestos.filter((p) => cs.includes(p.clave));
    if (ps.length === 0) return null;
    return { nombre, claves: ps.map((p) => p.clave), u0: Math.min(...ps.map((p) => p.u)) - 1.3, v0: Math.min(...ps.map((p) => p.v)) - 1.3, u1: Math.max(...ps.map((p) => p.u)) + 1.3, v1: Math.max(...ps.map((p) => p.v)) + 1.3 };
  };
  const zonas = (d?.zonas ?? []).map(([nombre, cs]) => caja(cs, nombre)).filter((z): z is ZonaSala => z !== null);
  const nuevaZona = caja(nuevos.map(claveDe), "Equipo nuevo");
  if (nuevaZona) zonas.push(nuevaZona);
  return { n, puestos, zonas };
}

// ── Oficinas de equipo dentro de la sala (R1.b y R1.d) ───────────────────────────────────────────────────────
// Cada oficina ocupa una franja propia debajo de las zonas de la sala: un escritorio por agente y siempre un lugar libre al final. Si no cabe, la
// oficina se ensancha (más columnas) y, si la sala se queda corta, la sala crece; el color y el letrero no cambian.
export interface EscritorioOficina<T> { item: T | null; u: number; v: number }
export interface OficinaColocada<T> { clave: string; u0: number; v0: number; u1: number; v1: number; escritorios: Array<EscritorioOficina<T>> }
export interface SalaConOficinas<T> { n: number; oficinas: Array<OficinaColocada<T>> }

export function distribuirOficinas<T>(sala: SalaCalculada<T>, oficinas: Array<{ clave: string; items: T[] }>): SalaConOficinas<T> {
  if (oficinas.length === 0) return { n: sala.n, oficinas: [] };
  const maxV = sala.puestos.length ? Math.max(...sala.puestos.map((p) => p.v)) : ORIGEN - 3.9;
  const vInicio = maxV + 3.9;   // deja un pasillo entre las zonas de la sala y la primera oficina
  let n = sala.n;
  for (;;) {
    const colsMax = Math.max(1, Math.floor((n - 0.15 - 1.3 - ORIGEN) / PASO) + 1);
    const colocadas: Array<OficinaColocada<T>> = [];
    let v = vInicio;
    for (const o of oficinas) {
      const lugares = o.items.length + 1;   // el último es el lugar libre
      const cols = Math.min(lugares, colsMax), filas = Math.ceil(lugares / cols);
      const escritorios: Array<EscritorioOficina<T>> = Array.from({ length: lugares }, (_, k) => ({ item: o.items[k] ?? null, u: ORIGEN + (k % cols) * PASO, v: v + Math.floor(k / cols) * PASO }));
      colocadas.push({ clave: o.clave, u0: ORIGEN - 1.3, v0: v - 1.3, u1: ORIGEN + (cols - 1) * PASO + 1.3, v1: v + (filas - 1) * PASO + 1.3, escritorios });
      v += filas * PASO + 1.0;
    }
    const fondo = Math.max(...colocadas.map((c) => c.v1));
    if (fondo <= n - 0.15) return { n, oficinas: colocadas };
    n += 3;   // la sala crece una fila/columna de escritorios, como con los agentes nuevos
  }
}
