// Customer queue: shows the "It's your turn" alert even when the ticket page is closed or the phone is locked.
// Registered by the ticket page (/q/t/<id>) only when the customer taps to turn alerts on.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = data.title || "It's your turn! · حان دورك!";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/app-icon-192.png",
      badge: "/app-icon-192.png",
      tag: data.tag || "queue-call",
      renotify: true,
      silent: false,
      vibrate: [400, 150, 400, 150, 400],
      requireInteraction: true,
      data: { url: data.url || "/q/find" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/q/find";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url.includes(url) && "focus" in c) return c.focus();
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
