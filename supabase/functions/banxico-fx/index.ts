// Tipo de cambio oficial de Banxico (SIE API) para el widget del topbar.
//
// Serie principal: SF60653 — "Tipo de cambio pesos por dólar E.U.A., para solventar
// obligaciones denominadas en moneda extranjera pagaderas en la República Mexicana"
// (el que se publica en el DOF y es el que aplica fiscalmente).
// Serie de referencia: SF43718 — Tipo de cambio FIX.
//
// El token de Banxico vive solo en el servidor (secret BANXICO_TOKEN) y nunca se
// expone al cliente. Se consigue gratis en:
//   https://www.banxico.org.mx/SieAPIRest/service/v1/token

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SIE_BASE = "https://www.banxico.org.mx/SieAPIRest/service/v1/series";

/** Series que consultamos. `key` es la llave con la que responde esta función. */
const SERIES = [
  { key: "obligaciones", id: "SF60653", label: "Para solventar obligaciones" },
  { key: "fix", id: "SF43718", label: "FIX" },
] as const;

type Punto = { fecha: string; valor: number };

/** "dd/MM/yyyy" (formato de Banxico) → "yyyy-MM-dd" para poder ordenar y formatear. */
function isoFromBanxico(fecha: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Normaliza los datos de una serie: descarta "N/E", ordena por fecha ascendente. */
function puntos(datos: Array<{ fecha?: string; dato?: string }> | undefined): Punto[] {
  return (datos ?? [])
    .map((d) => {
      const iso = isoFromBanxico(String(d.fecha ?? ""));
      const valor = Number(String(d.dato ?? "").replace(/,/g, ""));
      if (!iso || !Number.isFinite(valor) || valor <= 0) return null;
      return { fecha: iso, valor };
    })
    .filter((p): p is Punto => p !== null)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const token = Deno.env.get("BANXICO_TOKEN")?.trim();
  if (!token) {
    console.error("BANXICO_TOKEN no está configurada en el entorno.");
    return json(
      {
        error: "banxico_not_configured",
        message:
          "Falta configurar el token de Banxico en el servidor (secret BANXICO_TOKEN).",
      },
      500,
    );
  }

  try {
    // Ventana de 20 días naturales: cubre puentes y fines de semana largos y nos
    // deja al menos dos publicaciones para calcular la variación del día.
    const hoy = new Date();
    const desde = new Date(hoy.getTime() - 20 * 24 * 60 * 60 * 1000);
    const ids = SERIES.map((s) => s.id).join(",");
    const url = `${SIE_BASE}/${ids}/datos/${ymd(desde)}/${ymd(hoy)}`;

    const res = await fetch(url, {
      headers: { "Bmx-Token": token, Accept: "application/json" },
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.error("Banxico SIE respondió", res.status, detail);
      const message =
        res.status === 401 || res.status === 403
          ? "Banxico rechazó el token (revisa BANXICO_TOKEN)."
          : "Banxico no respondió correctamente.";
      return json({ error: "banxico_error", status: res.status, message, detail }, 502);
    }

    const data = await res.json();
    const series: Array<{ idSerie?: string; titulo?: string; datos?: Array<{ fecha?: string; dato?: string }> }> =
      data?.bmx?.series ?? [];

    const out: Record<string, unknown> = {};
    for (const def of SERIES) {
      const serie = series.find((s) => s.idSerie === def.id);
      const ps = puntos(serie?.datos);
      const ultimo = ps.at(-1);
      if (!ultimo) continue;
      const previo = ps.at(-2) ?? null;
      out[def.key] = {
        idSerie: def.id,
        label: def.label,
        titulo: serie?.titulo ?? null,
        valor: ultimo.valor,
        fecha: ultimo.fecha,
        valorPrevio: previo?.valor ?? null,
        fechaPrevia: previo?.fecha ?? null,
        cambio: previo ? Number((ultimo.valor - previo.valor).toFixed(4)) : null,
        cambioPct: previo
          ? Number((((ultimo.valor - previo.valor) / previo.valor) * 100).toFixed(3))
          : null,
      };
    }

    if (!Object.keys(out).length) {
      return json(
        { error: "banxico_sin_datos", message: "Banxico no devolvió datos para las series solicitadas." },
        502,
      );
    }

    return json({ ...out, consultadoEn: new Date().toISOString() });
  } catch (error) {
    console.error("Error in banxico-fx:", (error as Error).message);
    return json({ error: "banxico_fetch_failed", message: (error as Error).message }, 500);
  }
});
