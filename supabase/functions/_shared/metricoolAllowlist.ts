// Lista cerrada de operaciones de LECTURA de Metricool y constructor de URL.
// Sin dependencias: se usa tal cual en Deno (Edge Function) y en Node (prueba).
// Regla: ninguna petición sale a Metricool sin pasar por construirPeticion().
// Marca fija: blogId/userId vienen SOLO del entorno de la función; el llamador no puede cambiarlos.

export const HOST = "app.metricool.com";
export const BASE_PATH = "/api";

export interface Operacion {
  ruta: string; // ruta exacta bajo /api; segmentos {x} son parámetros de ruta validados
  params: readonly string[]; // parámetros de consulta permitidos (además de userId y blogId, que son fijos)
  pathParams?: Record<string, RegExp>;
}

// Rutas aprobadas por Dirección (docs/marketing-metricool-api.md). /admin/simpleProfiles queda FUERA:
// devuelve todas las marcas de la cuenta y la marca ya está fija.
export const OPERACIONES: Record<string, Operacion> = {
  instagram_posts: { ruta: "/v2/analytics/posts/instagram", params: ["from", "to", "timezone"] },
  facebook_posts: { ruta: "/stats/facebook/posts", params: ["start", "end", "timezone"] },
  linkedin_posts: { ruta: "/stats/linkedin/posts", params: ["start", "end", "timezone"] },
  scheduler_posts: { ruta: "/v2/scheduler/posts", params: ["start", "end", "timezone"] },
  scheduler_post: {
    ruta: "/v2/scheduler/posts/{id}", params: [], pathParams: { id: /^\d{1,12}$/ },
  },
  scheduler_post_events: {
    ruta: "/v2/scheduler/posts/{uuid}/events", params: [],
    pathParams: { uuid: /^[0-9a-fA-F-]{8,64}$/ },
  },
  timelines: { ruta: "/v2/analytics/timelines", params: ["network", "metric", "from", "to", "timezone", "subject", "scope"] },
  api_usage_stats: {
    ruta: "/v2/settings/users/{userId}/api-usage-stats", params: ["from", "to", "aggregation", "includeEndpoints"],
  },
};

export const RUTAS_PERMITIDAS: readonly string[] = Object.values(OPERACIONES).map((o) => BASE_PATH + o.ruta);

export class ErrorLista extends Error {}

const VALOR_PARAM = /^[\w:+.\- ,/]{1,100}$/; // sin &, =, ?, #, % ni saltos

export interface Peticion { url: string; method: "GET" }

export function construirPeticion(
  operacion: string,
  entrada: Record<string, string | number | boolean | undefined>,
  marca: { userId: string; blogId: string },
): Peticion {
  const op = Object.hasOwn(OPERACIONES, operacion) ? OPERACIONES[operacion] : undefined;
  if (!op) throw new ErrorLista(`operación fuera de la lista: ${operacion}`);
  if (!/^\d{1,12}$/.test(marca.userId) || !/^\d{1,12}$/.test(marca.blogId)) {
    throw new ErrorLista("METRICOOL_USER_ID / METRICOOL_BLOG_ID inválidos");
  }

  let ruta = op.ruta;
  for (const seg of ruta.match(/\{(\w+)\}/g) ?? []) {
    const nombre = seg.slice(1, -1);
    // {userId} es siempre el fijo; los demás vienen validados por su expresión.
    const valor = nombre === "userId" ? marca.userId : String(entrada[nombre] ?? "");
    const re = nombre === "userId" ? /^\d{1,12}$/ : op.pathParams?.[nombre];
    if (!re || !re.test(valor)) throw new ErrorLista(`parámetro de ruta inválido: ${nombre}`);
    ruta = ruta.replace(seg, valor);
  }

  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(entrada)) {
    if (v === undefined) continue;
    if (op.pathParams && k in op.pathParams) continue;
    if (k === "userId" || k === "blogId") throw new ErrorLista("userId/blogId no se aceptan del llamador");
    if (!op.params.includes(k)) throw new ErrorLista(`parámetro no permitido: ${k}`);
    const s = String(v);
    if (!VALOR_PARAM.test(s) || s.includes("..")) throw new ErrorLista(`valor no permitido en ${k}`);
    q.set(k, s);
  }
  q.set("userId", marca.userId);
  q.set("blogId", marca.blogId);

  const url = `https://${HOST}${BASE_PATH}${ruta}?${q.toString()}`;
  verificarSalida(url, "GET");
  return { url, method: "GET" };
}

// Última barrera: se vuelve a validar la URL ya construida contra la lista cerrada.
export function verificarSalida(url: string, method: string): void {
  if (method !== "GET") throw new ErrorLista(`método no permitido: ${method}`);
  const u = new URL(url);
  if (u.protocol !== "https:" || u.host !== HOST || u.username || u.password) throw new ErrorLista("host no permitido");
  const ok = Object.values(OPERACIONES).some((o) => {
    const patron = new RegExp(
      "^" + (BASE_PATH + o.ruta).replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{(\w+)\}/g, (_m, n: string) => {
        const re = n === "userId" ? /\d{1,12}/ : o.pathParams?.[n];
        return re ? "(?:" + re.source.replace(/^\^|\$$/g, "") + ")" : "(?!)";
      }) + "$",
    );
    return patron.test(u.pathname);
  });
  if (!ok) throw new ErrorLista(`ruta fuera de la lista: ${u.pathname}`);
  if (u.pathname.includes("..") || u.pathname.includes("//")) throw new ErrorLista("ruta no normalizada");
}
