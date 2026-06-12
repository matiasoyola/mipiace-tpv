# v1.5-Consistencia-C · done — Outbox offline del cobro

**Rama:** `v1-5-outbox` · un único commit, sin merge. Corre en paralelo con `v1-0-pilotos`.
**Estado final:** `pnpm test` → 77 files passed, 563 tests passed, 3 skipped (pre-existentes de v1.5-A, entorno Redis), **0 failed**. `tsc -b` limpio en tpv-web. `vite build` de tpv-web OK.
**Frontera respetada:** sólo `apps/tpv-web/src/lib/outbox.ts` (nueva), `CheckoutPage.tsx`, `CheckoutPage.successOverlay.tsx`, `CheckoutPage.outboxChip.tsx` (nueva, dentro del patrón `CheckoutPage*`), `App.tsx` (mínimo), `RefundPage.tsx`, tests nuevos en `apps/tpv-web/test/`, y `apps/tpv-web/package.json` + `pnpm-lock.yaml` (devDep `fake-indexeddb`, autorizada por el bloque). Nada de `apps/api`, `SalePage*`, `packages`, `infra`, `.github`, schema.

---

## Qué garantiza

Una vez el cajero pulsa Cobrar, la venta no se puede perder: el payload completo del POST /tickets (con su `externalId` de idempotencia) se escribe en IndexedDB **antes** de lanzar el request, y la pantalla de éxito depende sólo de esa persistencia local. Red caída, recarga del SW, crash del navegador o cierre de pestaña → el item sigue en el outbox y se reenvía solo.

## Diseño (`apps/tpv-web/src/lib/outbox.ts`)

- **BD propia `mipiacetpv-outbox`**, store `outbox`, keyPath `externalId`. Deliberadamente FUERA de `IDB_NAMES_TO_CLEAR` de `version-check.ts` (la limpieza de ese módulo es una lista explícita, así que las ventas pendientes sobreviven deploys sin tocarlo). IndexedDB y no sessionStorage porque debe sobrevivir al cierre de pestaña.
- **Estados:** `pending` → (2xx confirma) → borrado; o → `rejected` si el servidor responde un 4xx permanente. `rejected` NO se reintenta en bucle: queda visible para acción manual y se reporta a Sentry (`captureError`, gated por DSN como siempre).
- **Clasificación de errores** (`isPermanentRejection`): 4xx permanente salvo 401 (sin sesión de cajero — al volver a loguearse se reenvía solo), 408 y 429. Red, TypeError y 5xx son transitorios (con 5xx el reintento es seguro por la idempotencia).
- **Reenvío** (`startOutboxSync`, registrado en `App.tsx`): al arrancar la PWA, al evento `online`, y cada 15 s (`OUTBOX_FLUSH_INTERVAL_MS`). El flush con outbox vacío es un `getAll` y nada más.
- **Multi-pestaña:** lock optimista por item con marca de tiempo (TTL 30 s), tomado dentro de una transacción readwrite (re-lee y escribe atómicamente). El POST interactivo persiste con `lock: true` para que el flush periódico no dispare el mismo item en paralelo; si el POST falla, `outboxReleaseAfterFailure` suelta el lock y el background lo retoma. Lock de pestaña muerta caduca solo; la idempotencia del backend es la red de seguridad final.
- **Respuesta `200 duplicate:true`** (reenvío de algo que el servidor ya tenía) cuenta como confirmación y borra el item.

## UI

- **CheckoutPage:** si el POST no confirmó pero el item quedó persistido, en vez del error aparece `PendingSaleOverlay` — "Venta guardada · Pendiente de enviar", discreto (check verde + aviso ámbar, no alarmante). Si el reenvío confirma con la pantalla abierta, salta sola al `SuccessOverlay` completo (suscripción a eventos del outbox); si el servidor rechaza, lo dice y apunta al panel de pendientes.
- **Chip de pendientes** (`CheckoutPage.outboxChip.tsx`, montado desde `LoggedInWrapper` en App.tsx): flotante, sólo visible si hay items. Ámbar "N por enviar"; rojo si hay rechazados. Tap → panel con cada item (etiqueta, importe, hora, motivo del rechazo) y, para rechazados, **Reintentar** y **Descartar** (con confirmación en dos taps). *No* se reutilizó el chip "Pendientes" de SalePage: ese es de carritos aparcados (otra cosa) y SalePage pertenece a la rama paralela.
- **Flujos interactivos preservados:** autorización del encargado (403 MANAGER_*) y errores de validación con el cajero delante se siguen tratando inline; en esos casos el item se saca del outbox (si quedara, el reintento en background repetiría el 403/422 o duplicaría al recobrar con el payload corregido).
- Si IndexedDB no está disponible (modo privado restrictivo), el cobro degrada al POST directo de siempre — nunca se promete "venta guardada" sin persistencia real (flag `persisted`).

## Refunds (punto 5 — entró)

`POST /refunds` ya es idempotente por `externalId` en la API, así que `RefundPage.tsx` aplica el mismo patrón: `externalId` estable por overlay (antes se generaba uno por intento — un reintento tras timeout podía duplicar), persistir antes del POST, red caída → "Devolución guardada — pendiente de enviar", 4xx de validación → inline sin item residual.

## Checkout de mesa (punto 5 — fase 2)

`POST /tickets/:id/checkout` **no se llama desde el TPV hoy** (cero referencias en `apps/tpv-web/src`; la integración SalePage↔mesa quedó pendiente desde B8). Además su schema **no acepta `externalId`** — darle outbox exigiría tocar `apps/api` (prohibido en esta rama). Queda a fase 2: cuando se integre el cobro de mesa, añadir idempotencia al endpoint y reutilizar este outbox tal cual (es agnóstico del path).

## Tests (6 nuevos ficheros/escenarios, 15 tests)

`fake-indexeddb@^6` como devDep de tpv-web — justificación: jsdom no implementa IndexedDB y el outbox vive ahí a propósito; es la implementación de referencia (la usa el propio jsdom upstream) y sólo entra en tests.

- `test/outbox.test.ts` (9): ciclo completo escribir→POST→borrar; `duplicate:true` confirma; red caída → pending → evento `online` → confirmado; recarga simulada (item persistido + `startOutboxSync` lo reenvía al arrancar); 422 → `rejected` visible y sin bucle (flushes posteriores no reintentan); 401 no es permanente; `outboxRetry` revive un rechazado; lock fresco de otra pestaña no se reenvía / caducado sí; lock interactivo no se duplica en paralelo.
- `test/checkout-outbox.test.tsx` (3): persiste ANTES del POST (verificado dentro del mock del POST); red caída → overlay "Venta guardada — pendiente de enviar" + item pending + al confirmar el flush la pantalla pasa sola al éxito completo; 422 interactivo → inline, outbox limpio.
- `test/refund-outbox.test.tsx` (3): mismos tres ejes para refunds.
- **Idempotencia contra el handler real** (doble reenvío del mismo `externalId` → un solo ticket, 200 `duplicate:true`; cross-tenant → 409): ya cubierta en `apps/api/test/tickets-route.test.ts` ("idempotente: mismo externalId → devuelve el ticket existente (200)") con el handler real y mock de BD — verificada en verde en esta suite. `apps/api` está fuera de la frontera, así que no se añadió test nuevo allí.

## Decisiones y carryovers

1. **Token de autorización del encargado en reintentos:** si un cobro autorizado (descuento sobre umbral) cae a pending y el token expira antes del reenvío, el flush recibirá 403 → `rejected` visible para acción manual. Caso raro (red caída exactamente entre autorizar y confirmar) y siempre recuperable desde el chip.
2. **Lock tras crash:** si la pestaña muere con el POST en vuelo, el item queda lockeado hasta 30 s; peor caso ~45 s hasta el reenvío tras recarga (TTL + tick de 15 s). Aceptado — spec pedía lock por timestamp, no Web Locks.
3. **Contador cross-pestaña:** el chip se refresca con los eventos del outbox de SU pestaña (cada pestaña corre su propio sync cada 15 s, así convergen). Sin BroadcastChannel a propósito — no lo necesita la garantía.
4. **Demo manual (definición de hecho §2):** DevTools → Network offline → Cobrar → "Venta guardada — pendiente de enviar" → recargar la PWA → chip "1 por enviar" → Network online → se confirma solo (o al tick de 15 s). Pendiente de pasarlo contra la cuenta piloto antes de live.
5. **pnpm-lock.yaml compartido con la rama paralela:** el lockfile sólo añade `fake-indexeddb`; si `v1-0-pilotos` también toca dependencias, el merge del lock es trivial (entradas disjuntas).
