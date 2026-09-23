// F1 · el service worker de la pantalla de fichar (ADR-018).
//
// ÁMBITO `/fichar`, Y ESO ES LO IMPORTANTE. El admin no tiene ningún
// service worker hoy, y meterle uno de ámbito `/` sería repetir el fallo
// documentado en v1.2-Lite Lote 3.B y en A4: bundle viejo servido para
// siempre, esta vez al super-admin.
//
// El fichero vive en la RAÍZ (`/fichar-sw.js`) porque así lo sirve el
// `try_files` del admin sin tocar el Caddyfile, y desde ahí se registra
// con un ámbito MÁS ESTRECHO que su directorio — algo que el navegador
// siempre permite, y que evita necesitar la cabecera
// `Service-Worker-Allowed`. Ver `src/fichar/lib/pwa.ts`.
//
// Escrito a mano y no con vite-plugin-pwa: sin manifiesto de precache que
// mantener, sesenta líneas que se leen enteras, y cero dependencias
// nuevas en el admin.
//
// Estrategia:
//   · navegación a /fichar*  → red primero, y si no hay, el shell cacheado.
//     Así un deploy entra en la siguiente carga con red.
//   · /assets/*              → caché primero (van hasheados: son inmutables).
//   · /api/* y /version.json → NUNCA se cachean. Los fichajes no se
//     sirven de caché: para eso está la cola local.

const CACHE = "fichar-v1";
const SHELL = "/fichar";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // El fichaje viaja por la cola local, no por la caché del SW. Servir una
  // respuesta vieja de /api aquí sería enseñar un estado que ya no es.
  if (url.pathname.startsWith("/api/") || url.pathname === "/version.json") {
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SHELL, copy));
          return res;
        })
        .catch(() =>
          caches
            .match(SHELL)
            .then((hit) => hit ?? new Response("Sin conexión", { status: 503 })),
        ),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
