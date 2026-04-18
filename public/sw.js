/* global self */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Kawiil", body: event.data?.text() || "" };
  }
  const title = data.title || "Kawiil";
  const options = {
    body: data.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: data.tag || `kawiil-${Date.now()}`,
    renotify: true,
    vibrate: [120, 80, 120],
    silent: false,
    // DMs y menciones lo envían con requireInteraction=true → el banner queda visible hasta que el usuario lo atienda.
    requireInteraction: data.requireInteraction === true,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  const origin = self.location.origin;
  const full = url.startsWith("http") ? url : `${origin}${url.startsWith("/") ? url : `/${url}`}`;
  event.waitUntil(self.clients.openWindow(full));
});
