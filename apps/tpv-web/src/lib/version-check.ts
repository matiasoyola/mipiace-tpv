// v1.2-Lite Lote 3.B · invalidación agresiva del Service Worker.
//
// Problema: tras un deploy, el TPV del cajero seguía sirviendo el bundle
// viejo a pesar de `registerType: "autoUpdate"`. El service worker de
// vite-plugin-pwa actualiza en background pero el primer load tras
// deploy aún sirve el cache antiguo, y si el bundle viejo trae bugs
// del esquema IndexedDB (Bumps de VERSION en catalog.ts) o de la API,
// el cajero ve errores hasta que limpia manualmente.
//
// Estrategia: version-check determinista al arrancar.
//   - El build embebe `APP_VERSION` (Vite define `__APP_VERSION__`).
//   - El build emite `/version.json` con el mismo valor.
//   - Al arrancar, fetch a `/version.json` (cache: no-store).
//   - Si `server.version !== APP_VERSION`, limpiamos cache HTTP, IDB
//     del catálogo, desregistramos SW y recargamos. La sessionStorage
//     flag evita loops si el reload no cambia la versión percibida.
//
// IDB que limpiamos: sólo `mipiacetpv-catalog` — es el único IDB del
// TPV y se repuebla solo en el primer login del cajero. localStorage
// (tokens de sesión, dispositivo) se preserva para que el cajero no
// tenga que re-emparejar.

const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__.length > 0
    ? __APP_VERSION__
    : "dev";

// Nombre del IDB que el TPV usa para el catálogo. Cualquier otro store
// que añadamos en el futuro debe sumarse aquí — la limpieza es
// explícita para no nuclearizar IDBs de otras apps en el mismo origen.
const IDB_NAMES_TO_CLEAR = ["mipiacetpv-catalog"];

const CLEANED_FLAG_KEY = "mipiacetpv:version-cleaned-for";

export async function runVersionCheck(): Promise<void> {
  // En dev (vite serve) skipamos: no hay version.json estable y queremos
  // que HMR funcione sin bloquearse.
  if (APP_VERSION === "dev") return;

  let serverVersion: string | null = null;
  try {
    const res = await fetch("/version.json", {
      cache: "no-store",
      credentials: "omit",
    });
    if (!res.ok) return;
    const data: unknown = await res.json();
    if (
      data &&
      typeof data === "object" &&
      "version" in data &&
      typeof (data as { version: unknown }).version === "string"
    ) {
      serverVersion = (data as { version: string }).version;
    }
  } catch {
    // Sin red: nos quedamos con el bundle actual. Si el cajero está
    // offline, no podemos validar — el SW sirve la última versión que
    // pudo cachear y el version-check se reintentará al recuperar red
    // (el navegador re-arrancará la app al volver el foco si el
    // service worker se actualiza).
    return;
  }

  if (serverVersion === null || serverVersion === APP_VERSION) return;

  // La versión cambió. Protegernos de loops: si en esta sesión de tab
  // ya limpiamos para esta versión exacta, no reintentamos.
  const alreadyCleanedFor = sessionStorage.getItem(CLEANED_FLAG_KEY);
  if (alreadyCleanedFor === serverVersion) return;
  sessionStorage.setItem(CLEANED_FLAG_KEY, serverVersion);

  await purgeAndReload();
}

async function purgeAndReload(): Promise<void> {
  // 1. Cache HTTP del service worker (todas las cache stores).
  try {
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch {
    /* el navegador puede negar acceso a caches; continuamos */
  }

  // 2. Catálogo IDB (se repuebla en el primer fetch tras reload).
  try {
    if (typeof indexedDB !== "undefined") {
      await Promise.all(IDB_NAMES_TO_CLEAR.map(deleteIdbDatabase));
    }
  } catch {
    /* no fatal */
  }

  // 3. Desregistrar service workers para forzar re-registro tras
  //    reload (el nuevo SW vendrá del bundle nuevo).
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* no fatal */
  }

  // 4. Reload duro. `location.reload(true)` está deprecado en
  //    estándar; el patrón actual es `location.replace(location.href)`
  //    o `location.reload()` — el navegador ya hará revalidación de
  //    cache ahora que el SW se desregistró.
  window.location.reload();
}

function deleteIdbDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    // Resolvemos siempre — un fallo de borrado no debe bloquear el
    // resto del proceso. El navegador limpiará en cuanto las conexiones
    // abiertas se cierren tras el reload.
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
