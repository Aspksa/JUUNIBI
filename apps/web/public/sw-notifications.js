/* Push handler only. Registration and subscriptions require an authenticated backend
 * with VAPID keys; do not silently request permission or register a broken endpoint.
 */
self.addEventListener("push", (event) => {
  const payload = (() => {
    try { return event.data?.json() ?? {}; } catch { return {}; }
  })();
  const title = typeof payload.title === "string" ? payload.title : "Amayune · Дела";
  const body = typeof payload.body === "string" ? payload.body : "Новое напоминание";
  const id = typeof payload.id === "string" ? payload.id : "";
  event.waitUntil(self.registration.showNotification(title, {
    body, tag: id || undefined, data: { id }, icon: "/icons/icon-192.png"
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(w => new URL(w.url).origin === self.location.origin);
    if (existing) { await existing.focus(); existing.postMessage({ type: "amayune:notification-open", id: event.notification.data?.id }); }
    else await self.clients.openWindow("/#tasks");
  })());
});
