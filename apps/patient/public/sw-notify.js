/*
 * Notification handling for the web app, loaded into the service worker.
 *
 * A dose reminder is a real system notification with two buttons: "Taken" and
 * "Later". Tapping a button, or the notification itself, hands the choice to the
 * open app (or opens it), which does the work: this file never talks to the
 * server, so the person's sign-in stays in the app.
 */
self.addEventListener("notificationclick", (event) => {
  const { key, date } = event.notification.data || {};
  const action = event.action; // "taken", "later", or "" for a tap on the body
  event.notification.close();

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const message = action ? { type: "dose-action", action, key, date } : { type: "open-schedule" };
      if (windows.length > 0) {
        windows[0].postMessage(message);
        if ("focus" in windows[0]) await windows[0].focus();
        return;
      }
      const query = action ? `?dose=${action}&key=${encodeURIComponent(key || "")}&date=${encodeURIComponent(date || "")}` : "";
      await self.clients.openWindow(`/dose${query}`);
    })(),
  );
});
