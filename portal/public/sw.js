/*
 * Service worker del portal. SOLO EN LÍNEA (decisión cerrada): no guarda datos
 * ni respuestas en caché. Existe para que el portal sea instalable y para
 * mostrar una pantalla clara cuando no hay conexión. Push llega en la fase de app.
 */
const OFFLINE_HTML = `<!doctype html><html lang="es-MX"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sin conexión · Kawiil</title><body style="font-family:system-ui,sans-serif;background:#0000A1;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center">
<main><h1 style="font-size:1.5rem">Sin conexión</h1><p>El portal de Kawiil funciona solo en línea. Revise su conexión e intente de nuevo.</p>
<button onclick="location.reload()" style="margin-top:12px;padding:12px 20px;border-radius:8px;border:0;background:#fff;color:#0000A1;font-weight:600">Reintentar</button></main></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
