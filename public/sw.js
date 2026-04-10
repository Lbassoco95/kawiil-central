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
