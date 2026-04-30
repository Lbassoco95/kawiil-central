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
    icon: "/icon-192.png",
    badge: "/icon-32.png",
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

self.addEventListener("message", (event) => {
  try {
    const d = event.data;
    if (!d || typeof d !== "object") return;
    if (d.type !== "CLOSE_SLACK_CHANNEL_PUSH") return;
    const channelId = typeof d.channelId === "string" ? d.channelId.trim() : "";
    if (!channelId) return;
    const prefix = `slack-${channelId}-`;
    event.waitUntil(
      self.registration.getNotifications().then((list) => {
        for (const n of list) {
          const tag = typeof n.tag === "string" ? n.tag : "";
          if (tag.startsWith(prefix)) {
            try {
              n.close();
            } catch {
              /* noop */
            }
          }
        }
      }),
    );
  } catch {
    /* noop */
  }
});
