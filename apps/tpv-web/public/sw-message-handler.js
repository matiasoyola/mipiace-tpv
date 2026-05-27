// v1.3-UX-Iteración Lote 3 · importScripts en el SW generado por
// VitePWA (vite.config.ts -> workbox.importScripts). Añade un message
// handler para que el cliente pueda purgar caches de runtime sin
// desregistrar el SW completo.
//
// El handler borra todo cache cuyo nombre incluya "runtime", "api-"
// o "product-images" — equivale a la lista de runtimeCaching del
// workbox config. El precache (assets versionados por hash) NO se
// toca: el cleanupOutdatedCaches del workbox ya lo gestiona en cada
// update del SW.
self.addEventListener("message", (ev) => {
  if (!ev.data || ev.data.type !== "PURGE_RUNTIME") return;
  const reply = (ok) => {
    if (ev.source && "postMessage" in ev.source) {
      try {
        ev.source.postMessage({ type: "PURGE_RUNTIME_DONE", ok });
      } catch (_) {
        /* ignore */
      }
    }
  };
  ev.waitUntil(
    self.caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k.includes("runtime") ||
                k.startsWith("api-") ||
                k === "product-images",
            )
            .map((k) => self.caches.delete(k)),
        ),
      )
      .then(() => reply(true))
      .catch(() => reply(false)),
  );
});
