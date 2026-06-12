# v1.0-Pilotos · done

**Rama:** `v1-0-pilotos` · un único commit, sin merge.
**Estado tests:** `pnpm test` 0 failed (suite nueva E2E de mesas incluida).

---

## Lote 1 · E2E del flujo de mesas + fixes (PRIORITARIO)

### Suite nueva

- `apps/api/test/tables-e2e.test.ts` (15 tests): recorre el ciclo completo contra las rutas reales (operativa + grouping + tickets/checkout) con BD fake in-memory rica: abrir mesa → líneas (con idempotencia por `lineExternalId`) → mover línea (`originalTableId`) → agrupar → desagrupar (reversibilidad) → checkout → `internalNumber` fiscal → upload Holded (mock: `holdedUpload` PENDING + `enqueueTicketUpload`). Incluye los casos pedidos: dos cajas sobre la misma mesa, DRAFT no cobrable dos veces (secuencial + carrera simulada), agrupar mesa ya agrupada, y **verificación de que todos los eventos WS `table.*` se emiten fuera de transacción** (se captura la profundidad de tx en el momento de cada broadcast).
- `apps/tpv-web/test/table-map-offline.test.tsx` (4 tests): modo degradado online-only del mapa de sala.

### Bugs reales destapados y ARREGLADOS en este lote

1. **Totales de agrupar/mover ignoraban los suplementos de modifiers.** `grouping.ts · totalsFromLines` no aplicaba `priceDeltaCents` (el `unitPrice` persistido es el BASE). Mover una línea "café + leche de avena (+0,30)" a otra mesa encogía el total del destino → cobro inferior a lo servido. Fix: helper compartido `readUnitPriceDeltaCents` extraído a `tickets/totals.ts` y usado por operativa, grouping y checkout (antes había 2 copias privadas).
2. **Grupos anidados.** `POST /tables/:id/group` no comprobaba si la MESA PRINCIPAL ya estaba absorbida en otro grupo → se podían crear grupos anidados que el ungroup de la mesa raíz no sabía revertir. Fix: 409 `TABLE_ALREADY_GROUPED`.
3. **Operativa sobre mesa absorbida → DRAFTs fantasma.** Abrir/añadir líneas/mover-ticket/mover-líneas hacia una mesa con `groupedIntoTableId != null` estaba permitido; al desagrupar, la mesa quedaba con DOS DRAFTs (estado fantasma en el mapa). Fix: 409 `TABLE_GROUPED` en los 4 caminos.
4. **Carrera de doble cobro.** El check `status !== DRAFT` del checkout corría FUERA de la transacción: dos checkouts simultáneos podían pasar ambos (doble pago + dos `internalNumber`). Fix: claim `updateMany({ id, status: DRAFT })` DENTRO de la tx, antes de incrementar el contador (un 409 no quema serie fiscal).
5. **El throttle del bus WS descartaba eventos críticos.** 5 eventos/s por store, sin distinguir tipo: una ráfaga de `lineAdded` podía tirar el `table.paid` y la otra caja veía la mesa ocupada hasta el polling de respaldo (30 s). Fix: el throttle sólo aplica a eventos line-level (`table.lineAdded/lineUpdated/lineRemoved`); las transiciones de estado nunca se descartan.
6. **Gate offline incompleto en el TPV.** Sólo se deshabilitaban las mesas LIBRES; tocar una ocupada sin red llevaba a un SalePage que fallaba a mitad de flujo. Fix: sin conexión se bloquea la operativa de mesas ENTERA con banner claro; la venta rápida sigue disponible (catálogo IDB + carrito local). Nota: el cobro de la venta rápida sigue necesitando red al confirmar — no hay cola offline de tickets (fuera de alcance, ya conocido).

### Hallazgo GRANDE (documentado, parado a preguntar — ver mensaje en sesión)

**El TPV no está cableado a los endpoints de mesa.** `TableMapScreen → SalePage` sólo pasa contexto visual; las líneas viven en el carrito local (sessionStorage) y el cobro va por `POST /tickets` SIN `tableId` (el endpoint ni lo acepta). Consecuencias en producción HOSPITALITY:

- una mesa nunca aparece ocupada en la otra caja (el DRAFT server-side nunca se crea desde el TPV);
- mover/agrupar/desagrupar no son alcanzables desde la UI (move-to-table falla con "No hay ticket abierto"; enviar-comanda igual);
- los eventos `table.*` no se disparan nunca.

Es el carryover "integración SalePage↔mesa pendiente" de B7→B8 que no se llegó a hacer. La suite E2E valida que los endpoints están correctos (tras los fixes de arriba), pero **Cafetería Sirope no puede operar mesas sin ese cableado frontend** (~1-2 días: abrir mesa al tocar, añadir/editar/borrar líneas vía API, retomar DRAFT al volver a la mesa, checkout vía `/tickets/:id/checkout`). Decisión pendiente del usuario: bloque propio antes del go-live de Sirope.

### Semántica documentada (no bug, decisión B7)

- Dos cajas sobre la misma mesa: AÑADIR líneas es colaborativo (cualquier caja del store); EDITAR/COBRAR exige la caja que abrió el ticket (403 `REGISTER_MISMATCH`). Last-writer-wins en ediciones de la caja propietaria. Cubierto por test.

## Lote 2 · #9 Reimprimir con body vacío

**Causa raíz reproducida en test:** el wrapper fetch del TPV mandaba `Content-Type: application/json` en TODOS los requests, también en POSTs sin body (reimprimir, enviar comanda, gift-receipt). El parser por defecto de Fastify corta esos requests con `FST_ERR_CTP_EMPTY_JSON_BODY` (400) ANTES del handler → "reimprimir falla con body vacío". Doble fix:

- **Server** (`lib/lenient-json.ts`, registrado en server.ts): body vacío se parsea como `{}`. Crítico server-side porque las PWA cachean JS viejo semanas. JSON malformado sigue siendo 400; endpoints con body required siguen 400 por schema.
- **TPV** (`api.ts`): `Content-Type` sólo cuando hay body (el admin ya lo hacía bien).

`apps/api/test/reprint-route.test.ts` (6 tests): reproduce el bug con el parser default, valida el fix, y cubre **reimpresión de ticket histórico de turno YA CERRADO** (el endpoint no depende del shift → 202) y DRAFT → 409. De rebote quedan arreglados enviar-comanda y gift-receipt-intent, que sufrían el mismo 400.

## Lote 3 · #28 Arqueo Z con desglose por método

- Nuevo `shift/z-breakdown.ts` (`computeZBreakdown`, pura): por método (lo que haya en `TicketPayment.method` + métodos de refund) → ventas brutas / devoluciones / neto; agregados `grossSales`, `refundsTotal`, `netSales`; y `cashTheoretical = fondo + neto CASH`.
- **Fix de paso:** las devoluciones EN EFECTIVO ahora restan del teórico de caja (ese dinero sale del cajón); antes no se restaban y el descuadre culpaba al cajero. Las de tarjeta no tocan caja. `refundsCount` del Z dejó de ser el `0` hardcodeado ("se contarán en B6") y `ticketsCount` ya no cuenta DRAFT/VOIDED.
- `generateZReportPdf`: tabla método × (bruto / devol. / neto / contado) + totales brutos/netos.
- Pantalla de cierre (`CloseShiftModal`): la respuesta de `/shift/:id/cash-count` (X y Z) incluye `breakdown`; el arqueo X lo pinta en su panel y el cierre Z ahora muestra un panel de resultado con el desglose (lo mismo que queda en el PDF) antes de cerrar el modal.
- Tests: `z-breakdown.test.ts` (7, pagos mixtos + devoluciones + redondeo) y 3 escenarios de integración en `shift-close.test.ts` (close, cash-count Z, arqueo X).

## Lote 4 · Sesión y login del cajero (#18 + #6 + addendum)

- **#18**: nueva columna `Tenant.cashierSessionTtlMinutes` (default 720 = 12 h, migración `20260612000000_v1_0_cashier_session_ttl`, aditiva). El JWT de sesión del cajero se firma ahora con este TTL — antes se firmaba con `cashierAutoLogoutMinutes` (10 min) y el cajero re-logueaba varias veces al día aunque estuviera activo. El auto-logout por inactividad (cliente) no cambia. Editable en Ajustes del admin (rango 30–1440, slider). Tests: JWT exp = 720 min, settings GET/POST/rango.
- **#6**: botón ojo mostrar/ocultar. `PasswordField` (componente único en `apps/admin/src/ui.tsx`) usado por el login del admin y el del super-admin; el TPV (keypad de PIN, no input de texto) tiene su toggle propio sobre los dots del PIN en `PinScreen`.
- **Addendum (visto en Peluquería Sole)**: 401 a mitad de acción → modal de re-login con PIN **in situ**, sin navegar y sin perder carrito/checkout; al validar, la request que falló se reintenta automáticamente con el token nuevo. Implementado en el wrapper `apiWithCashier` (handler registrable + retry único + 401s concurrentes comparten un solo modal) + `ReloginPinModal` + cableado en App. Cancelar propaga el 401 y vuelve al PinScreen clásico. Tests (`relogin-on-401.test.tsx`, 3): 401 a mitad de checkout → modal → PIN → reintento exitoso con el mismo estado; PIN incorrecto reintentable; cancelar propaga 401.

## Lote 5 · #19 Borrar impresora completamente

- **BD**: `DELETE /admin/printer-configs/:id` pasa de soft-delete (`active=false`, dejaba la fila y "reaparecía" en el listado) a **borrado real** (`deleteMany`; PrinterConfig no tiene dependientes). Para apagar sin borrar sigue existiendo `PATCH { active: false }`.
- **TPV**: `syncUsbPairingWithServerConfig` — al consultar `/tpv/printer-info`, si el register ya no tiene impresora USB (borrada o cambiada a WIFI) se limpia el pairing WebUSB residual de localStorage. La re-alta del mismo dispositivo re-empareja limpio.
- Tests: ciclo **alta → borrado (listado vacío) → re-alta limpia** en `printer-configs.test.ts`, aislamiento de tenant en DELETE, y `usb-pairing-sync.test.ts` (4) en el TPV.
- Nota deploy: las filas `active=false` históricas de producción quedan como están (inofensivas: los consumidores filtran `active: true`). Si molestan en el listado, borrar a mano.

## Lote 6 · #22 Importador de clientes desde Excel/CSV

- **Arquitectura**: el admin (OWNER-only, `/admin/contacts-import`, ítem de nav `ownerOnly`) parsea el archivo EN EL NAVEGADOR y manda filas normalizadas como JSON (evita plugin multipart en la API). El backend valida (máx 2.000 filas, 409 sin API key de Holded) y encola un job **BullMQ** (`contact-import`, concurrency 1). El worker crea cada contacto **EN HOLDED** (`type=client`, `createContactWithGetBack` — GET-back ADR-010) y la BD local se rellena por el upsert del propio flujo. Nunca contactos "solo locales".
- **Throttle**: ~5 req/s (cada alta son 2 requests POST+GET-back → pausa 400 ms por fila creada; `CONTACT_IMPORT_DELAY_MS` para ajustar). Reintentos por fila: 3 con backoff; si se agotan, la fila va a errores y el resto sigue.
- **Idempotencia**: clave NIF normalizado > email > nombre; check contra BD local (espejo de Holded, decisión B2) + dedupe dentro del archivo. Releer el archivo no duplica (test).
- **Validación NIF**: `validateSpanishTaxId` (util-validation) en el worker; inválidos a errores con motivo.
- **Resultado**: progreso por polling (`GET /admin/contacts/import/:jobId`, aislado por tenant) con barra; al final creados / ya existían / con error + **CSV de errores descargable** (motivo por fila) + plantilla CSV descargable.
- **Elección de parser xlsx — justificación**: `exceljs` (sólo en `apps/admin`, chunk lazy de ~920 KB que carga al entrar a la página). Se descartó SheetJS porque el paquete `xlsx` de npm está congelado en 0.18.5 con CVE de ReDoS sin parche en npm (los fixes viven en su CDN propio, fuera de pnpm/lockfile). CSV con parser propio RFC-4180-ish (comillas, `;` del Excel español, BOM).
- Tests: worker (11 — creación, idempotencia x3, NIF inválido, reintentos, throttle, progreso, sin-API-key), endpoints (7 — OWNER-only, 409, límite, polling, aislamiento tenant), parser CSV (10).

## Lote 7 · Versión visible

- Fuente única: `apps/admin/src/version.ts` → `PRODUCT_VERSION = "v1.0"`. La leen (1) el footer del admin (sidebar desktop + drawer móvil: `mipiacetpv v1.0 · <hash7>`) y (2) el plugin de vite que emite **`/version.json`** en el build (`{ version, buildHash }`, hash de `VITE_BUILD_HASH` que ya inyecta CI; también servido en dev). Verificado en build local.

---

## Acciones manuales de deploy

1. **Migración** `20260612000000_v1_0_cashier_session_ttl` (aditiva, `ALTER TABLE tenants ADD COLUMN cashier_session_ttl_minutes INT NOT NULL DEFAULT 720`). Recordatorio: la `b27` sigue pendiente de aplicar al piloto (carryover v1.4).
2. `pnpm install` en el build (nueva dep `exceljs` en `@mipiacetpv/admin` — el Dockerfile ya lo hace).
3. Nada más: sin cambios de CI/deploy, sin env vars nuevas obligatorias (`CONTACT_IMPORT_DELAY_MS` opcional).

## Fuera de alcance / carryovers para el siguiente bloque

- **Cableado SalePage↔mesa (CRÍTICO para Sirope)** — ver Lote 1; pendiente de decisión.
- Cola offline de tickets para venta rápida sin red (hoy el carrito sobrevive pero el cobro espera a reconectar).
- Filas `PrinterConfig` soft-deleted históricas en producción (limpiar a mano si molestan).
- El TPV no muestra versión de producto (el bloque pedía admin + version.json); trivial de añadir si se quiere.
- jsdom sigue pineado a 25 (carryover v1.5-A); tests TPV de SalePage completo siguen diferidos (jsdom).
