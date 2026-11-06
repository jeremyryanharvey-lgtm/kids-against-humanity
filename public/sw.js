


const CACHE = "kam-shell-v7";
const CACHE_TIME = "kam-cache-time";
const MAX_AGE = 8 * 60 * 60 * 1000;

const FILES = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icon.svg"
];

async function clearExpiredCache() {
  const timestamp = await caches.open(CACHE_TIME);
  const saved = await timestamp.match("/last-updated");

  if (!saved) return;

  const lastUpdated = Number(await saved.text());

  if (Date.now() - lastUpdated >= MAX_AGE) {
    await caches.delete(CACHE);
  }
}

async function refreshCache() {
  const cache = await caches.open(CACHE);

  await Promise.all(
    FILES.map(async file => {
      try {
        const response = await fetch(file, { cache: "no-store" });

        if (response.ok) {
          await cache.put(file, response);
        }
      } catch (error) {
        // Continue if an individual file cannot be downloaded.
      }
    })
  );

  const timestamp = await caches.open(CACHE_TIME);

  await timestamp.put(
    "/last-updated",
    new Response(String(Date.now()))
  );
}

self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      await refreshCache();
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter(key => key !== CACHE && key !== CACHE_TIME)
          .map(key => caches.delete(key))
      );

      await clearExpiredCache();
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", event => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin ||
    new URL(event.request.url).pathname.startsWith("/api/")
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      await clearExpiredCache();

      try {
        const response = await fetch(event.request);

        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, response.clone());

          const timestamp = await caches.open(CACHE_TIME);
          await timestamp.put(
            "/last-updated",
            new Response(String(Date.now()))
          );
        }

        return response;
      } catch (error) {
        const cached = await caches.match(event.request);

        if (cached) return cached;

        return new Response(
          "You need an internet connection to play.",
          {
            status: 503,
            headers: { "Content-Type": "text/plain" }
          }
        );
      }
    })()
  );
});
