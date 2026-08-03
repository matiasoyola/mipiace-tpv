# A2 · Frente 3 · Auditoría del flujo offline

Estado: **auditoría de código completada; validación en hardware real
PENDIENTE de integración** (ver §4). Este bloque **NO reimplementa** nada
del sistema offline — lo construyó **v1.10** (`v1-10-offline-un-terminal`).
El Frente 3 se reduce a auditar lo que es *independiente de v1.10* (catálogo
cacheado + Service Worker dentro del WebView) y a dejar documentada la
prueba completa "venta sin red → sync sin duplicar".

---

## 1. Qué es de v1.10 y NO se toca

El sistema de venta offline ya existe en esta rama (heredado vía A1) y es
propiedad de v1.10. **No duplicar, no modificar.**

- `src/lib/outbox.ts` — outbox de cobros/refunds en IndexedDB. Persiste el
  item con su **clave de idempotencia generada en cliente ANTES** de lanzar
  el POST. `flushOutbox()` drena los `pending`; `startOutboxSync()` dispara
  el reenvío en **tres** momentos: arranque, evento `window "online"`, y
  tick periódico (`OUTBOX_FLUSH_INTERVAL_MS = 15s`). La idempotencia del
  backend es la red de seguridad → reenviar el mismo item **no duplica**.
- `src/lib/offlineAuth.ts` y `src/lib/offlineShift.ts` — login de cajero
  por PIN offline + ciclo de turno. **NO están en esta rama** (son sólo de
  `v1-10-offline-un-terminal`); hacen falta para "abrir TPV en frío sin
  red". Su ausencia aquí es la razón principal por la que la prueba
  completa queda pendiente de integración (§4).

---

## 2. Auditado en esta rama (independiente de v1.10)

### 2.1 El Service Worker sirve la app sin red — OK a nivel de código
- `vite.config.ts` → `VitePWA` con `registerType: "autoUpdate"` y
  `workbox.globPatterns: ["**/*.{js,css,html,svg,woff2}"]`: el **precache**
  cubre el shell (index.html + bundle + estilos + fuentes). Con el SW
  activo, una recarga sin red sirve la app desde el precache.
- En el WebView, `capacitor.config.ts` fija `androidScheme: "https"` y
  `allowMixedContent: false` → origen **seguro**, requisito para que el SW
  se registre y controle la página igual que en producción. `main.tsx`
  registra el SW con `registerSW({ immediate: true })`.
- `devOptions.enabled: true` mantiene el SW también en `vite dev`.

### 2.2 El catálogo cacheado se ve sin red — OK a nivel de código
Doble red de seguridad, ambas anteriores a v1.10:
- **IDB local (fuente principal):** `catalog.ts` cachea el catálogo en
  IndexedDB (`mipiacetpv-catalog`, store `products`) con fallback a
  localStorage si no hay IDB. `loadCatalogFromCache()` / `readAll()`
  devuelven **sin tocar la red**. `refreshCatalog()` pagina contra el
  backend y, si está offline, **propaga el error pero conserva lo
  cacheado** (el TPV pinta la última versión).
- **Runtime cache del SW (secundaria):** `runtimeCaching` con
  `NetworkFirst` + `networkTimeoutSeconds: 5` sobre `/api/tpv/catalog/` y
  `/api/tickets`. Si la red tarda >5s, cae al último 200 cacheado.

### 2.3 Purga de runtime cache dentro del WebView — OK a nivel de código
- `public/sw-message-handler.js` (inyectado por `workbox.importScripts`)
  escucha `{type:"PURGE_RUNTIME"}` y borra `api-*` / `product-images` /
  `runtime` **sin desregistrar el SW ni tocar el precache**. `syncNow.ts`
  lo usa desde el botón "Sincronizar" con purga directa cliente como
  respaldo. La `postMessage` al `serviceWorker.controller` es API estándar
  → funciona igual en el WebView (mismo origen `https://localhost`).

### 2.4 Interacción con Frente 4 (version-check)
Ver `A2-done.md`: dentro de Capacitor `runVersionCheck()` es **no-op**
explícito (isCapacitor()) — el bundle es estático y se actualiza vía Play
Store. Así se evita que `purgeAndReload()` borre el precache local del que
el WebView no puede re-descargar el bundle. Esto **protege** el arranque
offline: el precache no se puede quedar huérfano.

---

## 3. Riesgos / observaciones para la integración

- **Base de la API en el WebView.** `api.ts` usa `BASE_URL = VITE_API_URL
  ?? "/api"`. En el bundle empaquetado, `/api` resolvería contra
  `https://localhost` (sin backend). El build del APK **debe** fijar
  `VITE_API_URL` al backend remoto de producción. Con URL absoluta, el
  `runtimeCaching` del SW sigue casando por `url.pathname` (`/api/...`), así
  que el cacheo de catálogo offline se mantiene. **Acción para A3/deploy:**
  documentar/parametrizar `VITE_API_URL` en el pipeline del APK.
- **Impresión offline** (BT/USB/WiFi-local) no depende de internet — es de
  A1; su validación offline entra en la prueba integrada de §4.

---

## 4. Prueba completa PENDIENTE de integración (hardware real)

La auditoría "venta entera sin red → sync sin duplicar" es una **prueba de
integración** que sólo puede correrse cuando **v1.10 + A1 + A2** estén en
una misma rama, sobre un **Android real (no emulador)**. Requiere
`offlineAuth`/`offlineShift` (v1.10, no presentes aquí) + `outbox` (v1.10) +
transportes de impresión (A1) + permiso/escáner de cámara (A2).

Checklist a ejecutar entonces:

1. Con red: login de cajero, abrir turno, sincronizar catálogo (IDB
   poblado).
2. **Cortar la red** (modo avión).
3. Reiniciar la app → el SW sirve el shell; se ve el catálogo cacheado.
4. Login de cajero por PIN **offline** (v1.10).
5. Crear una venta, cobrar en efectivo → el cobro se **encola** en
   `outbox` (IDB) con su clave de idempotencia.
6. Imprimir el ticket (BT/USB/WiFi-local) → **no** debe depender de red.
7. **Restaurar la red** → `startOutboxSync` dispara `flushOutbox` por el
   evento `online` (y/o tick 15s).
8. Verificar en Holded que el ticket llega **exactamente una vez**
   (idempotencia backend). Repetir el paso de reconexión para confirmar que
   un segundo flush **no duplica**.
9. Anotar dispositivo, versión de Android y resultado.

Mientras no exista la rama integrada, esta prueba **no puede** cerrarse
como hecha.
