// Prueba automática: FALLA si una petición puede salir de la lista cerrada.
// Node: node --experimental-strip-types --test supabase/functions/_shared/metricoolAllowlist.test.ts
// Deno: deno test supabase/functions/_shared/metricoolAllowlist.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { construirPeticion, ErrorLista, OPERACIONES, RUTAS_PERMITIDAS, verificarSalida } from "./metricoolAllowlist.ts";

const marca = { userId: "4220058", blogId: "5431581" };
const entradaValida: Record<string, Record<string, string>> = {
  instagram_posts: { from: "2026-07-30T00:00:00", to: "2026-10-30T23:59:59", timezone: "America/Mexico_City" },
  facebook_posts: { start: "20260730", end: "20261030" },
  linkedin_posts: { start: "20260730", end: "20261030" },
  scheduler_posts: { start: "2026-07-30T00:00:00", end: "2026-10-30T23:59:59" },
  scheduler_post: { id: "123456" },
  scheduler_post_events: { uuid: "3f2a9c1e-1111-2222-3333-444455556666" },
  timelines: { network: "instagram", metric: "followers", from: "2026-07-30T00:00:00", to: "2026-10-30T00:00:00", subject: "account" },
  api_usage_stats: { from: "2026-10-01", to: "2026-10-31", aggregation: "day" },
};

test("cada operación de la lista produce solo GET a app.metricool.com con la marca fija", () => {
  for (const op of Object.keys(OPERACIONES)) {
    const p = construirPeticion(op, entradaValida[op], marca);
    const u = new URL(p.url);
    assert.equal(p.method, "GET");
    assert.equal(u.host, "app.metricool.com");
    assert.equal(u.searchParams.get("blogId"), "5431581");
    assert.equal(u.searchParams.get("userId"), "4220058");
  }
});

test("el llamador no puede cambiar de marca (Yoltik u otra)", () => {
  for (const op of Object.keys(OPERACIONES)) {
    assert.throws(() => construirPeticion(op, { ...entradaValida[op], blogId: "6583478" }, marca), ErrorLista);
    assert.throws(() => construirPeticion(op, { ...entradaValida[op], userId: "1" }, marca), ErrorLista);
  }
});

test("operaciones fuera de la lista se rechazan antes de construir nada", () => {
  const prohibidas = [
    "simpleProfiles", "admin_setproperty", "lists_delete", "gmb_review_reply", "post_create", "scheduler_post_delete",
    "../admin/profile", "", "__proto__", "constructor", "toString",
  ];
  for (const op of prohibidas) assert.throws(() => construirPeticion(op, {}, marca), ErrorLista, op);
});

test("rutas que modifican datos (GET que escriben) nunca pasan la barrera de salida", () => {
  const mutantes = [
    "/admin/profile/setproperty", "/admin/update-label-blog", "/admin/delete-profile", "/admin/restore-profile",
    "/admin/simpleProfiles", "/admin/profiles", "/lists/delete", "/lists/posts/deleteall", "/lists/update",
    "/stats/gmb/review/reply", "/stats/gmb/review/reply/remove", "/stats/deletecomment/facebook",
    "/stats/postmessage/facebook", "/stats/twitter/follow", "/stats/facebook/boost/1", "/v2/scheduler/posts/1/approvals",
    "/v2/scheduler/posts/deleted/1", "/v2/scheduler/posts/brand-tags", "/v2/scheduler/library/posts",
  ];
  for (const r of mutantes) {
    assert.throws(() => verificarSalida(`https://app.metricool.com/api${r}?userId=1&blogId=2`, "GET"), ErrorLista, r);
  }
});

test("métodos distintos de GET, otros hosts y rutas no normalizadas se rechazan", () => {
  const buena = "https://app.metricool.com/api/v2/analytics/posts/instagram?x=1";
  for (const m of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "get"]) {
    assert.throws(() => verificarSalida(buena, m), ErrorLista, m);
  }
  const malas = [
    "http://app.metricool.com/api/v2/analytics/posts/instagram",
    "https://evil.example/api/v2/analytics/posts/instagram",
    "https://app.metricool.com.evil.example/api/v2/analytics/posts/instagram",
    "https://user:pw@app.metricool.com/api/v2/analytics/posts/instagram",
    "https://app.metricool.com/api/v2/analytics/posts/instagram/extra",
    "https://app.metricool.com/api/v2/analytics/posts/../../admin/profile/setproperty",
    "https://app.metricool.com/api//v2/analytics/posts/instagram",
    "https://app.metricool.com/v2/analytics/posts/instagram",
  ];
  for (const u of malas) assert.throws(() => verificarSalida(u, "GET"), ErrorLista, u);
});

test("parámetros hostiles se rechazan", () => {
  const h = ["a&blogId=6583478", "x=y", "../x", "a?b", "a#b", "%2e%2e", "a\nb", "a".repeat(101)];
  for (const v of h) assert.throws(() => construirPeticion("instagram_posts", { from: v }, marca), ErrorLista, v);
  assert.throws(() => construirPeticion("instagram_posts", { token: "x" } as never, marca), ErrorLista);
  for (const id of ["1/events", "../x", "1a", "", "12345678901234"]) {
    assert.throws(() => construirPeticion("scheduler_post", { id }, marca), ErrorLista, id);
  }
  assert.throws(() => construirPeticion("scheduler_post_events", { uuid: "../../x" }, marca), ErrorLista);
});

test("marca mal configurada se rechaza", () => {
  assert.throws(() => construirPeticion("instagram_posts", {}, { userId: "", blogId: "1" }), ErrorLista);
  assert.throws(() => construirPeticion("instagram_posts", {}, { userId: "1", blogId: "1/../2" }), ErrorLista);
});

test("la lista de rutas permitidas es exactamente la documentada", () => {
  assert.deepEqual([...RUTAS_PERMITIDAS].sort(), [
    "/api/stats/facebook/posts", "/api/stats/linkedin/posts", "/api/v2/analytics/posts/instagram",
    "/api/v2/analytics/timelines", "/api/v2/scheduler/posts", "/api/v2/scheduler/posts/{id}",
    "/api/v2/scheduler/posts/{uuid}/events", "/api/v2/settings/users/{userId}/api-usage-stats",
  ].sort());
});

import { readFileSync } from "node:fs";
test("el conector tiene un único fetch, pasa por construirPeticion y no usa cron_secret ni llave de servicio como credencial", () => {
  const src = readFileSync(new URL("../../pendientes/marketing-metricool/index.ts", import.meta.url), "utf8");
  assert.equal((src.match(/\bfetch\(/g) ?? []).length, 1);
  assert.ok(src.includes("construirPeticion("));
  assert.ok(!/CRON_SECRET/.test(src.replace(/\/\/.*$/gm, "")));
  assert.ok(!/Authorization/.test(src));
  assert.ok(!/console\.(log|error|warn)\([^)]*token/i.test(src));
  assert.ok(!/method:\s*"(?!GET")/.test(src));
});
