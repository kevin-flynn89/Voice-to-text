
const CACHE_NAME = "voicetotext-share-v2";

const sharedAudioUrl = () =>
  new URL("shared-audio", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter((key) => key.startsWith("voicetotext-share") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const targetUrl = new URL("share-target.html", self.registration.scope);

  if (
    request.method !== "POST" ||
    url.origin !== targetUrl.origin ||
    url.pathname !== targetUrl.pathname
  ) {
    return;
  }

  event.respondWith((async () => {
    try {
      const formData = await request.formData();
      const file = formData.get("audio");

      if (!(file instanceof File) || file.size === 0) {
        return Response.redirect(
          new URL("?share-error=1", self.registration.scope).href,
          303
        );
      }

      const cache = await caches.open(CACHE_NAME);
      const response = new Response(file, {
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-VoiceToText-Filename": encodeURIComponent(file.name || "audio")
        }
      });

      await cache.put(sharedAudioUrl(), response);

      return Response.redirect(
        new URL("?shared=1", self.registration.scope).href,
        303
      );
    } catch (error) {
      return Response.redirect(
        new URL("?share-error=1", self.registration.scope).href,
        303
      );
    }
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      if (event.request.mode === "navigate") {
        const root = new URL("./", self.registration.scope);
        const page = await caches.match(root.href);

        if (page) return page;
      }

      return new Response("Risorsa non disponibile offline", {
        status: 503
      });
    })
  );
});
