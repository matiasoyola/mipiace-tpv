// v1.3-UX-Iteración Lote 3 · botón "Sincronizar" del TPV.
//
// Tres pasos defensivos:
//   1. Manda PURGE_RUNTIME al SW para que borre sus caches de runtime
//      (api-catalog, api-tickets, product-images). El SW lo gestiona
//      vía public/sw-message-handler.js inyectado por workbox.
//   2. Borra también desde el cliente cualquier cache que coincida —
//      defensa por si el SW está aún activando o no responde.
//   3. Llama al callback `refresh` que repuebla la fuente de datos
//      (refreshCatalog del catálogo, fetch del historial, etc.).
//
// La función NO recarga la página. La diferencia respecto a
// version-check.ts es que aquí queremos refrescar datos del backend
// sin reiniciar la sesión del cajero (que perdería la PinScreen).

export async function syncNow(refresh: () => Promise<unknown>): Promise<void> {
  await purgeRuntimeCaches();
  await refresh();
}

async function purgeRuntimeCaches(): Promise<void> {
  // (1) SW message — si está activo y soporta el handler.
  try {
    if (
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      navigator.serviceWorker.controller
    ) {
      navigator.serviceWorker.controller.postMessage({ type: "PURGE_RUNTIME" });
    }
  } catch {
    /* sin SW activo o controller; seguimos con purga directa */
  }

  // (2) Borrado directo cliente. El Cache Storage API es accesible
  // desde cualquier contexto secure; iteramos los caches y borramos
  // los de runtime. Conservamos el precache (workbox-precache-*)
  // porque cleanupOutdatedCaches del workbox ya lo gestiona y borrarlo
  // forzaría una redescarga del bundle entero al siguiente request.
  try {
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (n) =>
              n.includes("runtime") ||
              n.startsWith("api-") ||
              n === "product-images",
          )
          .map((n) => caches.delete(n)),
      );
    }
  } catch {
    /* algunos navegadores en privado niegan acceso; no es fatal */
  }
}
