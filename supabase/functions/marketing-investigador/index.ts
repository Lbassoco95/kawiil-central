// Investigador web de Marketing (propuesta §14.3). Versión 2: lee las fuentes aprobadas (modo por omisión) y BUSCA fuentes nuevas (modo «descubrir»).
// - Lee SOLO los sitios escritos por Dirección en mk_fuente_web (lista cerrada, https, GET). No inicia sesión, no envía formularios, respeta robots.txt.
// - Por omisión es VISTA PREVIA: lee y compara, pero no llama al modelo ni escribe nada. Escribir exige `escribir: true`.
// - Escribe únicamente en mk_hallazgo_web (hallazgos), mk_fuente_web (última lectura, huella y resumen anterior) y deja una corrida en el registro
//   de agentes (mk_registrar_corrida). Nunca guarda el texto completo de una página: solo un resumen corto y la fuente con fecha.
// - modo «descubrir»: usa la búsqueda web para encontrar competidores y noticias, verifica cada candidato (https, robots.txt, GET) y los guarda como PROPUESTAS
//   inactivas en mk_fuente_web (estado «propuesta», activa = false). NUNCA activa una fuente: eso lo decide una persona. Vista previa por omisión (no escribe).
// - Autenticación propia: x-marketing-secret = MARKETING_CONNECTOR_SECRET (igual que el colchón y la carga). Sin JWT de usuario.
// - Secretos por nombre: ANTHROPIC_API_KEY (ya existe). Opcional: MARKETING_AGENTE_MODELO. Solo panel: sin correo, Slack ni WhatsApp.
// - La lógica vive en _shared/investigador.ts (con la red, el modelo y la base inyectados y probada); aquí solo se conecta.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { MODELO_POR_DEFECTO } from "../_shared/analista.ts";
import { llmAnthropic } from "../_shared/analista_servidor.ts";
import { correrInvestigacion, type AlmacenInv, type FuenteWeb, type Resumir } from "../_shared/investigador.ts";
import { descubrirFuentes, type AlmacenDescubrir } from "../_shared/investigador_descubrir.ts";
import { buscarConModelo } from "../_shared/investigador_servidor.ts";

function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);
  const secreto = Deno.env.get("MARKETING_CONNECTOR_SECRET") ?? "";
  if (!secreto || !igual(secreto, req.headers.get("x-marketing-secret") ?? "")) return json({ error: "no autorizado" }, 401);

  let cuerpo: { escribir?: unknown; fuente_id?: unknown; modo?: unknown } = {};
  try { cuerpo = await req.json(); } catch { /* sin cuerpo: vista previa */ }
  const escribir = cuerpo.escribir === true;
  const descubrir = cuerpo.modo === "descubrir";
  const soloFuente = typeof cuerpo.fuente_id === "string" && /^[0-9a-f-]{36}$/i.test(cuerpo.fuente_id) ? cuerpo.fuente_id : null;

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: orgs } = await db.from("organizations").select("id").limit(2);
  if (!orgs || orgs.length !== 1) return json({ error: "organización ambigua" }, 500);
  const org = orgs[0].id as string;
  const ok = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };

  const registrar = async (titulo: string, estado: "completed" | "error", resumen: string, resultado: Record<string, unknown>, inicio: Date) => {
    // Un fallo al registrar no rompe la corrida (como en el colchón).
    try { ok(await db.rpc("mk_registrar_corrida", { p_agente: "marketing_investigador", p_estado: estado, p_titulo: titulo, p_resumen: resumen, p_resultado: resultado, p_inicio: inicio.toISOString() })); }
    catch (e) { console.error("marketing-investigador: no se pudo registrar la corrida", (e as Error).message); }
  };

  if (descubrir) {
    // Siempre con el modelo (la búsqueda es el trabajo), incluso en vista previa; lo que cambia es que la vista previa no guarda nada.
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "falta ANTHROPIC_API_KEY" }, 500);
    const buscar = buscarConModelo(apiKey, Deno.env.get("MARKETING_AGENTE_MODELO") || MODELO_POR_DEFECTO, { herramienta: Deno.env.get("MARKETING_BUSQUEDA_HERRAMIENTA") || undefined });
    const almacenD: AlmacenDescubrir = {
      async fuentesConocidas() {
        const filas = ok(await db.from("mk_fuente_web").select("url").eq("organization_id", org).limit(2000)) ?? [];
        return filas.map((f: { url: string }) => f.url);
      },
      async guardarCandidata(c) {
        // Siempre «propuesta» e inactiva; si la dirección ya existe no se toca (ignoreDuplicates). El agente nunca escribe estado «activa».
        const filas = ok(await db.from("mk_fuente_web").upsert({
          organization_id: org, tipo: c.tipo, formato: c.formato, nombre: c.nombre, url: c.url, motivo: c.motivo, verificada_at: c.verificada_at,
          estado: "propuesta", origen: "agente", activa: false,
        }, { onConflict: "organization_id,url", ignoreDuplicates: true }).select("id")) ?? [];
        return filas.length > 0;
      },
      registrarCorrida: (estado, resumen, resultado, inicio) => registrar("Búsqueda de fuentes", estado, resumen, resultado, inicio),
    };
    try {
      return json(await descubrirFuentes({ escribir, fetchFn: (url, init) => fetch(url, init), buscar, almacen: almacenD }));
    } catch (e) {
      console.error("marketing-investigador (descubrir):", (e as Error).message);
      return json({ error: "no se pudo completar la búsqueda de fuentes" }, 500);
    }
  }

  let consulta = db.from("mk_fuente_web").select("id, tipo, formato, nombre, url, temas, ultima_huella, ultimo_resumen").eq("organization_id", org).eq("estado", "activa").eq("activa", true).order("created_at");
  if (soloFuente) consulta = consulta.eq("id", soloFuente);
  const fuentes = (ok(await consulta) ?? []) as FuenteWeb[];

  // El modelo solo se arma cuando se va a escribir (la vista previa no gasta tokens).
  let resumir: Resumir = async () => { throw new Error("vista previa: sin modelo"); };
  if (escribir) {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "falta ANTHROPIC_API_KEY" }, 500);
    const llm = llmAnthropic(apiKey, Deno.env.get("MARKETING_AGENTE_MODELO") || MODELO_POR_DEFECTO);
    resumir = async (system, usuario) => {
      const r = await llm({ system, mensajes: [{ role: "user", content: usuario }], herramientas: [] });
      const texto = (r.contenido as Array<{ type: string; text?: string }>).filter((b) => b.type === "text").map((b) => b.text ?? "").join(" ");
      return { texto, tokens: r.uso };
    };
  }

  const almacen: AlmacenInv = {
    async huellasConocidas(fuente_id) {
      const filas = ok(await db.from("mk_hallazgo_web").select("huella").eq("organization_id", org).eq("fuente_id", fuente_id).limit(2000)) ?? [];
      return new Set(filas.map((f: { huella: string }) => f.huella));
    },
    async guardarHallazgo(h) {
      // upsert ignorando duplicados: repetir la corrida no duplica hallazgos (único por fuente y huella).
      ok(await db.from("mk_hallazgo_web").upsert({ organization_id: org, ...h }, { onConflict: "fuente_id,huella", ignoreDuplicates: true }));
    },
    async actualizarFuente(id, x) {
      ok(await db.from("mk_fuente_web").update(x).eq("id", id).eq("organization_id", org));
    },
    registrarCorrida: (estado, resumen, resultado, inicio) => registrar("Lectura de páginas y noticias", estado, resumen, resultado, inicio),
  };

  try {
    const reporte = await correrInvestigacion({ fuentes, escribir, fetchFn: (url, init) => fetch(url, init), resumir, almacen });
    return json(reporte);
  } catch (e) {
    console.error("marketing-investigador:", (e as Error).message);
    return json({ error: "no se pudo completar la lectura" }, 500);
  }
});
