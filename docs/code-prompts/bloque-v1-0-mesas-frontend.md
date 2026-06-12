# Bloque v1.0-Mesas-Frontend · Cablear SalePage ↔ endpoints de mesa (go-live Sirope)

**Rama:** `v1-0-mesas-frontend` (worktree desde master, DESPUÉS de que `v1-0-pilotos` esté mergeado — este bloque depende de sus fixes del Lote 1)
**Origen:** hallazgo GRANDE de `docs/blocks/v1-0-pilotos-done.md` §Lote 1: el TPV no está cableado a los endpoints de mesa (carryover B7→B8). Los endpoints quedaron validados y endurecidos por la suite E2E; falta que la UI los use. Sin esto, Cafetería Sirope no puede operar.
**Estimación:** 1-2 días Code.
**Entrega:** un único commit, sin merge. `pnpm test` 0 failed, CI verde, `docs/blocks/v1-0-mesas-frontend-done.md`.

**LEER ANTES DE EMPEZAR:** `docs/blocks/v1-0-pilotos-done.md` §Lote 1 completo (bugs arreglados, semántica de dos cajas REGISTER_MISMATCH, eventos WS post-commit) y `apps/api/test/tables-e2e.test.ts` (es el contrato vivo de los endpoints).

---

## Lote 1 · Ciclo de vida de mesa desde el TPV

1. **Tocar mesa libre** → crea el DRAFT server-side (endpoint de abrir mesa) ANTES de entrar a SalePage; la mesa pasa a ocupada en el mapa de las demás cajas (los eventos `table.*` ya se emiten — el Lote 1 de pilotos lo garantizó).
2. **Líneas vía API**: añadir/editar unidades/borrar/limpiar línea en contexto mesa van contra los endpoints de líneas con `lineExternalId` (idempotencia ya soportada). UX: actualización optimista local + reconciliación con la respuesta; si la API rechaza (p. ej. 403 REGISTER_MISMATCH al editar desde otra caja), revertir y toast claro.
3. **Retomar mesa ocupada** → carga el DRAFT del servidor (no el carrito local); el carrito local en sessionStorage queda SOLO para venta rápida.
4. **Cobrar mesa** → `POST /tickets/:id/checkout` (no `/tickets`). El flujo de pago (CheckoutPage) se reutiliza; lo que cambia es el destino del confirm.
5. **Mover líneas / mover ticket / agrupar / desagrupar** accesibles desde la UI en contexto mesa (los pickers `SalePage.movePicker` / `splitBill` existen — cablearlos a los endpoints reales). Respetar los 409 nuevos (`TABLE_GROUPED`, `TABLE_ALREADY_GROUPED`) con mensajes en español.
6. **Enviar comanda** desde mesa (el 400 de body vacío ya está arreglado en pilotos Lote 2).
7. **Gate online-only intacto**: todo lo anterior solo con conexión (el gate del Lote 1 de pilotos ya bloquea el mapa offline — no aflojarlo).

## Lote 2 · Outbox para el checkout de mesa (fase 2 pendiente de v1.5-C)

`docs/blocks/v1-5-consistencia-C-done.md` lo dejó documentado: el schema de `POST /tickets/:id/checkout` no acepta `externalId`. Aquí SÍ se puede tocar la API:

1. Añadir `externalId` (uuid, opcional para back-compat, idempotencia GET-back como en `/tickets`) al schema del checkout + persistirlo. Test de idempotencia: dos checkouts con el mismo externalId → un solo cobro (la carrera ya está cerrada con el claim en tx; esto cubre el reintento de red).
2. Integrar el checkout de mesa con `lib/outbox.ts` (mismo patrón que venta rápida y refunds). Matiz: un checkout `pending` en outbox debe bloquear reabrir/editar esa mesa en ESTE dispositivo hasta resolverse (la mesa está "cobrada en tránsito") — estado visible en el mapa local.

## Lote 3 · Tests

- jsdom del flujo mesa completo con API mockeada: abrir → líneas → retomar desde "otra sesión" → checkout → mapa refleja estados. Errores: 403 REGISTER_MISMATCH al editar, 409 al agrupar agrupada.
- API: idempotencia de checkout con externalId (contra handler real, patrón de `tickets-route.test.ts`).
- Los 15 E2E de mesas y 4 de offline existentes deben seguir verdes sin tocar.

## Frontera de archivos (en paralelo solo con `a0-android-scaffold`)

PROHIBIDO: `apps/tpv-android/**` (lo toca A0), `infra/**`, `.github/**`. Todo lo demás (tpv-web, api, tests) permitido — los otros bloques ya están en master.

## Definición de hecho

1. `pnpm test` 0 failed. CI verde en el push.
2. Demostrable de punta a punta: dos pestañas del TPV (dos cajas), una abre mesa y añade líneas → la otra la ve ocupada en segundos; cobro → mesa libre en ambas; mover/agrupar funcionan desde la UI.
3. `docs/blocks/v1-0-mesas-frontend-done.md` con resumen, decisiones UX y carryovers.
4. Un único commit: `v1.0-mesas-frontend · SalePage cableado a endpoints de mesa + outbox checkout · go-live Sirope`.
