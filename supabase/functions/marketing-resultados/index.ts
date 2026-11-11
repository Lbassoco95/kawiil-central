// Resultados de Metricool para Marketing — SIMULACRO (Entrega 2, paso 2). Versión 1. SOLO LECTURA: no escribe ningún dato.
// - Lee Metricool únicamente a través del conector marketing-metricool (lista cerrada, marca fija, solo GET). No conoce el token.
// - Lee de la base las piezas publicadas y los valores del Calendario Maestro (fuente calendario_maestro) y las reglas del semáforo.
// - Devuelve el reporte de contraste por red y semana (piezas del archivo vs. de la API, promedios, colores, diferencias) y NO guarda nada:
//   lo único que queda registrado es lo que ya registra el conector (mk_api_log, una fila por llamada a Metricool).
// - Autenticación propia: cabecera x-marketing-secret = MARKETING_CONNECTOR_SECRET (igual que el conector y el colchón).
// - La lógica vive en _shared/resultados.ts (con la base y el conector inyectados y probada); aquí solo se conecta con Supabase.
// Cargar los datos (escritura en mk_resultado y mk_pieza_red) es un paso posterior que Dirección debe aprobar tras revisar este reporte.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { correrSimulacro, REDES, type AlmacenSimulacro, type PiezaArchivo, type ReglaColor, type Red } from "../_shared/resultados.ts";

function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const PERIODO_POR_DEFECTO = { desde: "2026-07-30", hasta: "2026-10-30" }; // piezas históricas (docs/marketing-entrega2-resultados.md §9)

Deno.serve(async (req) => {
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);
  const secreto = Deno.env.get("MARKETING_CONNECTOR_SECRET") ?? "";
  if (!secreto || !igual(secreto, req.headers.get("x-marketing-secret") ?? "")) return json({ error: "no autorizado" }, 401);

  let cuerpo: { desde?: unknown; hasta?: unknown } = {};
  try { cuerpo = await req.json(); } catch { /* sin cuerpo: periodo por defecto */ }
  const desde = typeof cuerpo.desde === "string" ? cuerpo.desde : PERIODO_POR_DEFECTO.desde;
  const hasta = typeof cuerpo.hasta === "string" ? cuerpo.hasta : PERIODO_POR_DEFECTO.hasta;

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: orgs } = await db.from("organizations").select("id").limit(2);
  if (!orgs || orgs.length !== 1) return json({ error: "organización ambigua" }, 500);
  const org = orgs[0].id as string;

  const ok = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };
  // Lee en páginas de 1000: PostgREST corta ahí y un periodo largo se quedaría callado sin avisar.
  const todas = async <T>(pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> => {
    const salida: T[] = [];
    for (let i = 0; i < 10; i++) {
      const lote = ok(await pagina(i * 1000, i * 1000 + 999)) ?? [];
      salida.push(...lote);
      if (lote.length < 1000) return salida;
    }
    throw new Error("demasiadas filas para el simulacro");
  };

  const almacen: AlmacenSimulacro = {
    async piezasArchivo(d, h) {
      const filas = await todas<{ id: string; pieza_id: string; red: string; publicada_at: string }>((a, b) =>
        db.from("mk_pieza_red").select("id, pieza_id, red, publicada_at").eq("organization_id", org).not("publicada_at", "is", null)
          .gte("publicada_at", `${d}T00:00:00-06:00`).lte("publicada_at", `${h}T23:59:59-06:00`).order("publicada_at").range(a, b));
      if (filas.length === 0) return [];
      const piezas = await todas<{ id: string; codigo: string }>((a, b) => db.from("mk_pieza").select("id, codigo").eq("organization_id", org).order("id").range(a, b));
      const resultados = await todas<{ pieza_red_id: string; valor: number | null }>((a, b) =>
        db.from("mk_resultado").select("pieza_red_id, valor").eq("organization_id", org).eq("fuente", "calendario_maestro").eq("corte", "acumulado").order("pieza_red_id").range(a, b));
      const codigo = new Map(piezas.map((p) => [p.id, p.codigo]));
      const valor = new Map(resultados.map((r) => [r.pieza_red_id, r.valor === null ? null : Number(r.valor)]));
      return filas.filter((f) => (REDES as readonly string[]).includes(f.red)).map((f): PiezaArchivo => ({
        pieza_red_id: f.id, codigo: codigo.get(f.pieza_id) ?? "(sin código)", red: f.red as Red, publicada_at: f.publicada_at, valor: valor.get(f.id) ?? null,
      }));
    },
    async reglas() {
      const filas = ok(await db.from("mk_regla").select("codigo, parametros").eq("organization_id", org).eq("activa", true).in("codigo", REDES.map((r) => `semaforo_${r}`))) ?? [];
      const salida: Partial<Record<Red, ReglaColor>> = {};
      for (const f of filas as Array<{ codigo: string; parametros: { verde_desde?: number; amarillo_desde?: number } }>) {
        const red = f.codigo.replace("semaforo_", "") as Red;
        if (typeof f.parametros?.verde_desde === "number" && typeof f.parametros?.amarillo_desde === "number") salida[red] = { verde_desde: f.parametros.verde_desde, amarillo_desde: f.parametros.amarillo_desde };
      }
      return salida;
    },
  };

  const leerMetricool = async (_red: Red, operacion: string, entrada: Record<string, string>) => {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/marketing-metricool`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-marketing-secret": secreto },
      body: JSON.stringify({ operacion, entrada }), signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    const respuesta = r ? await r.json().catch(() => null) : null;
    if (!r || !r.ok || !respuesta?.ok) return { ok: false as const, motivo: String(respuesta?.error ?? respuesta?.motivo ?? (r ? `HTTP ${r.status}` : "sin respuesta del conector")).slice(0, 200) };
    return { ok: true as const, datos: respuesta.datos };
  };

  try {
    return json(await correrSimulacro({ desde, hasta, almacen, leerMetricool }));
  } catch (e) {
    const motivo = e instanceof Error ? e.message : "error";
    console.error("marketing-resultados: simulacro fallido", motivo);
    return json({ ok: false, error: motivo === "periodo inválido" ? motivo : "No se pudo armar el reporte." }, motivo === "periodo inválido" ? 400 : 500);
  }
});
