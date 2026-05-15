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
  // Adicional al abrir la URL, avisamos a las pestañas existentes para que invaliden caches Slack
  // y refresquen badges de inmediato (la URL que abrimos puede estar en otra pestaña ya viva).
  event.waitUntil(
    (async () => {
      try {
        const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const c of all) {
          try {
            c.postMessage({ type: "KAWIIL_INVALIDATE_SLACK_UNREAD", url: full });
          } catch {
            /* noop */
          }
        }
        // Si ya hay una ventana abierta del mismo origen, enfócala en lugar de abrir otra.
        const sameOrigin = all.find((c) => c.url && c.url.startsWith(origin));
        if (sameOrigin && "focus" in sameOrigin) {
          try {
            await sameOrigin.focus();
            if ("navigate" in sameOrigin && typeof sameOrigin.navigate === "function") {
              try {
                await sameOrigin.navigate(full);
                return;
              } catch {
                /* algunos navegadores no permiten navigate cross-document; cae al openWindow */
              }
            }
            return;
          } catch {
            /* abre una nueva como fallback */
          }
        }
        await self.clients.openWindow(full);
      } catch {
        await self.clients.openWindow(full);
      }
    })(),
  );
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
