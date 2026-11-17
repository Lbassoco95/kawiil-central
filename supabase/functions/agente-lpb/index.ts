import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ORG_AGENTES } from "../_shared/agenteConstructor.ts";
import { CAMPOS_PERSONA, MAX_EXPORTAR, aCsv, esUuid, validarListar, validarRevision, type FiltroLpb } from "../_shared/lpb.ts";

/**
 * agente-lpb
 * ----------
 * Lista maestra de Personas Bloqueadas (LPB) de transmisores de dinero y su cola de visto bueno. La mantiene el servicio de agentes; aquí Dirección la consulta y
 * verifica cada persona contra el PDF.
 *
 *   action "resumen"  → {} → { total, vigentes, eliminadas, por_revisar, por_corregir, dudosos, incompletos, revisadas }
 *   action "listar"   → { filtro?, q?, pagina?, limite? } → { personas, total, pagina, limite }
 *   action "persona"  → { id } → { persona, movimientos }
 *   action "revisar"  → { ids[1..50], decision: "aprobar"|"devolver", nota? } → { actualizadas }   (aprobar = verificada contra el PDF; devolver = el dato no coincide)
 *   action "exportar" → { filtro?, q? } → { csv, filas, truncado }   (hasta 2 000 filas)
 *
 * Seguridad: verify_jwt=true; solo admin/manager (is_admin_or_manager). Las tablas lpb_* tienen RLS sin políticas, así que se leen y escriben con service_role,
 * siempre acotadas a la organización de agentes. Lo único que se escribe es la revisión (revisado, por_corregir, quién y cuándo): nunca nombre, RFC ni estado.
 * La búsqueda se limpia a letras y números antes de entrar a un filtro. Un lote de revisión es de máximo 50.
 *
 * Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Consulta = any;
function aplicarFiltro(q: Consulta, filtro: FiltroLpb, texto: string): Consulta {
  switch (filtro) {
    case "por_revisar": q = q.eq("revisado", false).eq("por_corregir", false); break;
    case "por_corregir": q = q.eq("por_corregir", true); break;
    case "dudosos": q = q.eq("rfc_dudoso", true); break;
    case "incompletos": q = q.eq("datos_incompletos", true); break;
    case "vigentes": q = q.eq("estado", "vigente"); break;
    case "eliminadas": q = q.in("estado", ["eliminada", "eliminacion_provisional"]); break;
    case "revisadas": q = q.eq("revisado", true); break;
  }
  if (texto) q = q.or(`nombre_norm.ilike.*${texto}*,rfc.ilike.*${texto.replace(/ /g, "")}*`);
  return q;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing or invalid Authorization header" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const supabaseUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData.user) return json({ error: "Invalid or expired JWT" }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: esAdmin } = await admin.rpc("is_admin_or_manager", { _user_id: userData.user.id });
    if (!esAdmin) return json({ error: "Solo Dirección puede ver la lista de personas bloqueadas." }, 403);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
    const personas = () => admin.from("lpb_personas");

    if (body.action === "resumen") {
      const contar = async (f: (q: Consulta) => Consulta) => {
        const { count, error } = await f(personas().select("id", { count: "exact", head: true }).eq("organization_id", ORG_AGENTES));
        if (error) throw new Error(error.message);
        return count ?? 0;
      };
      const [total, vigentes, eliminadas, porRevisar, porCorregir, dudosos, incompletos, revisadas] = await Promise.all([
        contar((q) => q), contar((q) => q.eq("estado", "vigente")), contar((q) => q.in("estado", ["eliminada", "eliminacion_provisional"])),
        contar((q) => q.eq("revisado", false).eq("por_corregir", false)), contar((q) => q.eq("por_corregir", true)),
        contar((q) => q.eq("rfc_dudoso", true)), contar((q) => q.eq("datos_incompletos", true)), contar((q) => q.eq("revisado", true)),
      ]);
      return json({ total, vigentes, eliminadas, por_revisar: porRevisar, por_corregir: porCorregir, dudosos, incompletos, revisadas });
    }

    if (body.action === "listar") {
      const v = validarListar(body);
      if ("error" in v) return json({ error: v.error }, 400);
      const q = aplicarFiltro(personas().select(CAMPOS_PERSONA, { count: "exact" }).eq("organization_id", ORG_AGENTES), v.filtro, v.q)
        .order("nombre_norm", { ascending: true }).range(v.pagina * v.limite, v.pagina * v.limite + v.limite - 1);
      const { data, count, error } = await q;
      if (error) { console.error("agente-lpb listar", error.message); return json({ error: "No se pudo leer la lista." }, 500); }
      return json({ personas: data ?? [], total: count ?? 0, pagina: v.pagina, limite: v.limite });
    }

    if (body.action === "persona") {
      if (!esUuid(body.id)) return json({ error: "Persona no válida." }, 400);
      const { data: p, error } = await personas().select(CAMPOS_PERSONA).eq("id", body.id).eq("organization_id", ORG_AGENTES).maybeSingle();
      if (error) return json({ error: "No se pudo leer la persona." }, 500);
      if (!p) return json({ error: "No encontramos a esa persona." }, 404);
      const { data: movs } = await admin.from("lpb_movimientos").select("id, tipo, oficio, fecha_oficio, acuerdo, fundamento, archivo, fuente")
        .eq("persona_id", body.id).eq("organization_id", ORG_AGENTES).order("fecha_oficio", { ascending: false, nullsFirst: false }).limit(100);
      return json({ persona: p, movimientos: movs ?? [] });
    }

    if (body.action === "revisar") {
      const v = validarRevision(body);
      if ("error" in v) return json({ error: v.error }, 400);
      const cambios = v.decision === "aprobar"
        ? { revisado: true, por_corregir: false, revision_nota: v.nota || null, revisado_en: new Date().toISOString(), revisado_por: userData.user.id }
        : { revisado: false, por_corregir: true, revision_nota: v.nota, revisado_en: new Date().toISOString(), revisado_por: userData.user.id };
      const { data, error } = await personas().update(cambios).in("id", v.ids).eq("organization_id", ORG_AGENTES).select("id");
      if (error) { console.error("agente-lpb revisar", error.message); return json({ error: "No se pudo guardar la revisión." }, 500); }
      return json({ actualizadas: (data ?? []).length });
    }

    if (body.action === "exportar") {
      const v = validarListar({ ...body, limite: 1 });
      if ("error" in v) return json({ error: v.error }, 400);
      const q = aplicarFiltro(personas().select(CAMPOS_PERSONA).eq("organization_id", ORG_AGENTES), v.filtro, v.q).order("nombre_norm", { ascending: true }).limit(MAX_EXPORTAR + 1);
      const { data, error } = await q;
      if (error) return json({ error: "No se pudo preparar la exportación." }, 500);
      const filas = (data ?? []).slice(0, MAX_EXPORTAR);
      return json({ csv: aCsv(filas), filas: filas.length, truncado: (data ?? []).length > MAX_EXPORTAR });
    }

    return json({ error: "Acción no válida." }, 400);
  } catch (e) {
    console.error("agente-lpb", e instanceof Error ? e.message : e);
    return json({ error: "No se pudo completar la consulta." }, 500);
  }
});
