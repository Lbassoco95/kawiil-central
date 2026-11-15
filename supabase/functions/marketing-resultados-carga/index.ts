// Carga de resultados de Metricool a la base de Marketing (Entrega 2, paso 5). Versión 1.
// - Lee Metricool únicamente a través del conector marketing-metricool (lista cerrada, solo GET). No conoce el token.
// - Por omisión es VISTA PREVIA: no escribe nada. Escribir exige `escribir: true` y una lista explícita de redes (solo Instagram y Facebook están aprobadas).
// - Escribe únicamente en mk_resultado (fuente metricool, corte acumulado), mk_pieza_red (solo piezas anteriores al calendario de Instagram sin fila),
//   mk_cobertura_fuente y mk_bitacora (con los ids creados, para revertir). Nunca guarda texto de publicaciones, enlaces, hashtags ni nombres.
// - Autenticación propia: x-marketing-secret = MARKETING_CONNECTOR_SECRET (igual que el conector, el colchón y el simulacro). Sin JWT de usuario.
// - La lógica vive en _shared/resultados_carga.ts (con la base y el conector inyectados y probada); aquí solo se conecta con Supabase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { REDES, type PiezaArchivo, type Red } from "../_shared/resultados.ts";
import { correrCarga, FUENTE, CORTE, type AlmacenCarga, type PiezaSinFila } from "../_shared/resultados_carga.ts";

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

  let cuerpo: { desde?: unknown; hasta?: unknown; redes?: unknown; escribir?: unknown } = {};
  try { cuerpo = await req.json(); } catch { return json({ error: "solicitud no válida" }, 400); }
  const desde = typeof cuerpo.desde === "string" ? cuerpo.desde : PERIODO_POR_DEFECTO.desde;
  const hasta = typeof cuerpo.hasta === "string" ? cuerpo.hasta : PERIODO_POR_DEFECTO.hasta;
  const escribir = cuerpo.escribir === true;

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
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
    throw new Error("demasiadas filas");
  };

  const almacen: AlmacenCarga = {
    async reglas() { return {}; }, // la carga no calcula colores (eso es el recálculo del semáforo, paso aparte)
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
    // Piezas del calendario ANTERIORES a la primera publicación registrada en esa red, sin fila en ella y publicadas en otra red.
    async piezasSinFila(red, d, h) {
      const primera = ok(await db.from("mk_pieza_red").select("publicada_at").eq("organization_id", org).eq("red", red).not("publicada_at", "is", null).order("publicada_at").limit(1)) ?? [];
      if (primera.length === 0) return [];
      const tope = new Date(primera[0].publicada_at as string).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
      const piezas = await todas<{ id: string; codigo: string; fecha: string }>((a, b) =>
        db.from("mk_pieza").select("id, codigo, fecha").eq("organization_id", org).gte("fecha", d).lte("fecha", h).lt("fecha", tope).order("id").range(a, b));
      if (piezas.length === 0) return [];
      const redes = await todas<{ pieza_id: string; red: string; publicada_at: string | null }>((a, b) =>
        db.from("mk_pieza_red").select("pieza_id, red, publicada_at").eq("organization_id", org).in("pieza_id", piezas.map((p) => p.id)).order("id").range(a, b));
      const salida: PiezaSinFila[] = [];
      for (const p of piezas) {
        const suyas = redes.filter((r) => r.pieza_id === p.id);
        if (suyas.some((r) => r.red === red)) continue;
        const ref = suyas.filter((r) => r.publicada_at).sort((x, y) => (x.publicada_at! < y.publicada_at! ? -1 : 1))[0];
        if (ref) salida.push({ pieza_id: p.id, codigo: p.codigo, red_referencia: ref.red, referencia_at: ref.publicada_at! });
      }
      return salida;
    },
    async asegurarPiezaRed(x) {
      const ya = ok(await db.from("mk_pieza_red").select("id").eq("pieza_id", x.pieza_id).eq("red", x.red).limit(1)) ?? [];
      if (ya.length > 0) return { id: ya[0].id as string, creada: false };
      const fila = ok(await db.from("mk_pieza_red").insert({
        organization_id: org, pieza_id: x.pieza_id, red: x.red, estado: "publicada", publicada_at: x.publicada_at, metricool_id: x.metricool_id,
      }).select("id").single());
      return { id: (fila as { id: string }).id, creada: true };
    },
    async guardarResultado(f) {
      ok(await db.from("mk_resultado").upsert({ organization_id: org, ...f, fuente: FUENTE, corte: CORTE }, { onConflict: "pieza_red_id,corte,fuente" }));
    },
    async guardarCobertura(x) {
      ok(await db.from("mk_cobertura_fuente").upsert({ organization_id: org, red: x.red, fuente: FUENTE, desde: x.desde, hasta: x.hasta, nota: x.nota }, { onConflict: "organization_id,red,fuente" }));
    },
    async bitacora(resultado, detalle) {
      ok(await db.from("mk_bitacora").insert({ organization_id: org, agente: "sistema", accion: "carga_resultados", resultado: resultado.slice(0, 300), detalle }));
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
    return json(await correrCarga({ desde, hasta, redes: cuerpo.redes, escribir, almacen, leerMetricool }));
  } catch (e) {
    const motivo = e instanceof Error ? e.message : "error";
    console.error("marketing-resultados-carga: falló", motivo);
    const claro = motivo === "periodo inválido" || motivo === "redes inválidas";
    return json({ ok: false, error: claro ? motivo : "No se pudo completar la carga. Revisa el registro de la función." }, claro ? 400 : 500);
  }
});
