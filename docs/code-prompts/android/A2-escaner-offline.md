# Prompt para Claude Code — Bloque A2 (Android · escáner + offline)

Foco: que el escáner de cámara funcione nativo dentro de la app y que el
flujo de venta offline esté auditado en un dispositivo Android real.

Pega esto en una sesión NUEVA de Claude Code, tras A1 revisado. Puede ir
en paralelo a A1 si se desacopla bien (toca cámara/SW, no impresión),
pero recomendado secuencial para no solapar el wiring de plataforma.

---

Hola Code. A2 cubre escáner de cámara nativo + auditoría offline real.

## Contexto — leer antes de tocar nada

- `docs/android/README.md` §2.3 (offline) y §2.4 (permisos).
- `apps/tpv-web/src/pages/SalePage.cameraScan.tsx` y el uso de
  `@zxing/browser` — escaneo actual por getUserMedia.
- `apps/tpv-web/vite.config.ts` — config Workbox/PWA: runtimeCaching de
  catálogo (NetworkFirst 5s), tickets, imágenes; `version-check`.
- `apps/tpv-web/src/lib/syncNow.ts` y el message handler del SW
  (`public/sw-message-handler.js`) — purga de runtime cache.
- `apps/tpv-web/src/platform/index.ts` — adaptador de A0.

## Alcance A2

### Frente 1 · Permiso y escáner de cámara en WebView
- El WebView de Android necesita el permiso de cámara nativo además del
  prompt web. Pedirlo en runtime (plugin de permisos de Capacitor o
  `@capacitor/camera` solo para el permiso; el escaneo lo sigue haciendo
  zxing sobre el `<video>`).
- Verificar que `getUserMedia` devuelve la cámara trasera por defecto en
  el terminal de caja. Si hay varias cámaras, permitir elegir.
- Manejar denegación de permiso con mensaje claro en castellano.

### Frente 2 · Rendimiento de escaneo en dispositivo real
- Probar lectura de código de barras de producto en hardware real (no
  emulador). Ajustar resolución/constraints de la cámara si el escaneo
  es lento. Documentar el dispositivo probado.

### Frente 3 · Auditoría offline del flujo de venta
- En dispositivo real, con red cortada, verificar el ciclo completo:
  abrir TPV (SW sirve la app), ver catálogo cacheado, crear venta,
  cobrar, imprimir (BT/USB/WiFi-local no dependen de internet), y que la
  venta queda **encolada** para sincronizar con Holded al volver la red.
- Verificar que al reconectar la cola drena y Holded recibe el ticket
  (idempotencia ya resuelta en backend — confirmar que no se duplica).
- Si falta cola de pendientes para el caso "sin red a media venta",
  implementarla mínima sobre el storage existente (IndexedDB/Dexie ya en
  uso). No reinventar; integrarse con el sync actual.

### Frente 4 · Gestión del Service Worker dentro de Capacitor
- Confirmar que el version-check agresivo (fetch `/version.json`) y la
  purga de runtime cache funcionan dentro del WebView igual que en
  navegador. Si el esquema https del WebView rompe alguna ruta, ajustar.

## Restricciones
- TypeScript estricto.
- Regresión cero en web: el escaneo y el offline en navegador siguen
  igual.
- No reescribir el sistema de sync ni el SW; integrarse con lo existente.
- Toda lógica nativa detrás de la capa de plataforma, no en componentes.

## Tests
- Test de la cola de pendientes (si se implementa): encola al fallar red,
  drena al reconectar, no duplica (idempotencia).
- Test del wrapper de permiso de cámara (mock concedido/denegado).

## Validación en hardware real (obligatoria)
- Escanear un producto real desde la app.
- Completar una venta entera con red cortada y verificar sincronización
  posterior sin duplicado.
- Anotar dispositivo y escenario en `A2-done.md`.

## Entregables
1. PR único con A2.
2. `docs/blocks/A2-done.md`: estructura, decisiones, resultado de la
   auditoría offline (qué se probó y resultado), dispositivo usado, dudas.

## Lo que NO entra en A2
- Impresión → A1.
- Icono/splash/firma/publicación → A3.
- Integración de datáfono → v2.

Cuando termines, Matías valida en dispositivo y abrimos A3 (publicación).
