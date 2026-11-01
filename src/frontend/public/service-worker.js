const CACHE_NAME = "daqqa-public-assets-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("daqqa-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function safeNotificationPath(value) {
  if (typeof value !== "string") return "/dashboard";
  try {
    const target = new URL(value, self.location.origin);
    if (target.origin !== self.location.origin) return "/dashboard";
    if (target.pathname === "/dashboard") return "/dashboard";
    if (/^\/bookings\/[0-9a-f-]{36}$/i.test(target.pathname)) {
      return target.pathname;
    }
  } catch {
    // Fall through to the safe default.
  }
  return "/dashboard";
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === "string" ? payload.title : "Daqqa t’Id update";
  const body = typeof payload.body === "string" ? payload.body : "There is an update about your bookings.";
  const url = safeNotificationPath(payload.url);
  const tag = typeof payload.tag === "string" ? payload.tag : "daqqa-update";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    data: { url },
    icon: "/assets/icon.svg",
    badge: "/assets/icon.svg",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(safeNotificationPath(event.notification.data?.url), self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    const matching = windows.find((client) => client.url === targetUrl);
    if (matching) return matching.focus();
    const appWindow = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (appWindow) {
      await appWindow.navigate(targetUrl);
      return appWindow.focus();
    }
    return self.clients.openWindow(targetUrl);
  }));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const network = fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            void cache.put(request, response.clone());
          }
          return response;
        });
        return network.catch(() => Response.error());
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(OFFLINE_URL)) || Response.error();
      }),
    );
  }
});
