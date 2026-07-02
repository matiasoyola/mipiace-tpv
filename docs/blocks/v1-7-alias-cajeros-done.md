# Bloque v1.7 · Alias de cajeros — DONE

**Rama:** `v1-7-alias-cajeros`
**Origen:** decisión de Matías en la implantación de Cachictos (2026-06-24): alias obligatorio al crear cajero; el alias sustituye al email en todos los puntos de display. El email queda como credencial y canal.
**Estado:** cerrado. `pnpm test` (workspace) verde, `tsc` limpio en api/tpv-web/admin. Sin merge ni deploy (los hace Matías). Migración aditiva pendiente de aplicar en el deploy — sin ventana de mantenimiento.

---

## Resumen de números

- **Tests:** 696 passing + 3 skipped (legacy pre-existentes), antes 670 passing. **+26 tests**.
- **Ficheros de test nuevos:** `cashiers-alias.test.ts` (10), `users-display.test.ts` (5), `migration-v1-7-user-alias.test.ts` (3), `cashier-alias-display.test.tsx` (4, tpv-web).
- **Tests añadidos a existentes:** `cashier-login.test.ts` (+2, contrato con/sin alias), `tickets-print.test.ts` (+2, cashierLabel alias/fallback).
- **Migración:** `20260702000000_v1_7_user_alias` — `ALTER TABLE users ADD COLUMN alias TEXT` + backfill `LEFT(SPLIT_PART(email,'@',1),40)`.

---

## Frente 1 — Modelo y migración

- `User.alias String? @map("alias")` en `schema.prisma`. Nullable en BD (filas legacy de otros roles); la API lo exige al crear cajeros.
- Backfill en la propia migración: local-part del email truncada a 40 chars, para TODOS los users (los revocados con email sentinel reciben un alias irrelevante que nunca se muestra; los históricos imprimen algo razonable desde el día 1).
- Sin unique de BD. Unicidad **por tenant, case-insensitive, entre cajeros activos** (roles MANAGER/CASHIER, excluyendo emails `@revoked.local`) validada en API — `findAliasCollision()` en `cashiers/routes.ts`.

## Frente 2 — API

- `POST /cashiers`: `alias` **required** (schema 1..40 + trim en handler; sólo-espacios → 400 `INVALID_ALIAS`). Duplicado → 409 `ALIAS_TAKEN` con mensaje humano ("Ya hay un cajero llamado María").
- `PATCH /cashiers/:cashierId` **nuevo**: edita alias (requireOwner, misma validación/colisión excluyendo al propio user). El email no se edita — es la credencial.
- `GET /cashiers` devuelve `alias`.
- `DELETE` (revocación): el alias se conserva — los tickets históricos del revocado siguen imprimiendo su nombre, y su alias queda libre para nuevos cajeros (la colisión excluye revocados).
- Contrato cashier-auth: `POST /shift/cashier-login` y `GET /shift/cashier-bootstrap` devuelven `user.alias` junto a `user.email`. **El email NO sale del contrato** (compat con devices con SW viejo).
- Informe Z (`shift/routes.ts` + `z-report.ts`): `cashierLabel` y `closedByLabel` usan alias con fallback; "Autorizado por" imprime `alias (email)` — el email se conserva en el PDF como audit trail porque el alias no es único globalmente. El log estructurado de auditoría sigue usando email.
- `cashierLabel = alias ?? local-part del email` centralizado en **`apps/api/src/users/display.ts` (`cashierLabelFrom`)** — usado por `tickets/print.ts` (ticket ESC/POS), `send-to-kitchen.ts` (comanda PDF), `kitchen-dispatch.ts` (comanda ESC/POS) y el informe Z. Fallback obligatorio en todos.
- Snapshot de mesas (`tables/routes.ts` · `buildTableSnapshot`): `activeTicket.openedByAlias` junto a `openedByEmail` (este último se mantiene por compat). Sirve a `/tpv/tables` y `/admin/stores/:id/tables`.
- `escpos-builder/ticket.ts` y `kitchen.ts`: **sin cambios** — `cashierLabel` ya era string libre; basta poblarlo con alias (como preveía el bloque).

## Frente 3 — TPV (tpv-web)

`storage.ts` es el punto de decisión único: `CashierSession.alias?` y `RecentCashier.alias?` (opcionales → toleran JSON guardado pre-v1.7) + helper `cashierDisplayLabel()` (alias con trim, fallback email).

Puntos de display cubiertos (lista exhaustiva):

| # | Punto | Antes | Ahora |
|---|-------|-------|-------|
| 1 | Header SalePage (centro) | email completo | `cashierLabel` (alias ?? email) |
| 2 | Botón "Bloquear (…)" + title | email completo | `cashierLabel` |
| 3 | ReloginPinModal (sesión caducada) | email | alias ?? email (login sigue por email) |
| 4 | PinScreen · lista de recientes | email + iniciales de email | alias primero, email secundario; iniciales del alias |
| 5 | PinScreen · display del keypad | email seleccionado | alias del reciente seleccionado (email si tecleado a mano) |
| 6 | ShiftOpenScreen (avatar + nombre) | email | `cashierLabel` |
| 7 | TableMapScreen · botón header | local-part del email | `cashierLabel` |
| 8 | TableMapScreen · chip de operador en TableCard | iniciales de `openedByEmail` | iniciales de `openedByAlias ?? openedByEmail` |
| 9 | SalePage · TableContextLine ("2 comensales · 12m · maría · 3 uds.") | local-part de `openedByEmail` | `openedByAlias ?? local-part` |
| 10 | ShiftActiveScreen | email | `cashierLabel` (componente sin uso desde B4, actualizado por coherencia) |

- Prop `cashierEmail` renombrada a **`cashierLabel`** en SalePage/TableMapScreen/ShiftOpenScreen/ShiftActiveScreen — App la calcula con `cashierDisplayLabel()`. El email crudo ya no baja a las pantallas de venta.
- PinScreen sigue pidiendo **email + PIN** como credencial (decisión del bloque: alias es display, no credencial).
- El "atendido por" de SERVICES (vertical pinta) NO se tocó — texto libre distinto, como pedía el bloque.
- `SalePage.lineSheet.tsx` y `lib/cart.ts` **no tocados** (frontera con v1-6-precio-sobre-total). Ningún punto de display de email caía dentro de ellos.

## Frente 4 — Admin (CashiersPage)

- Alta: campo "Alias (nombre visible en TPV y tickets)" obligatorio, recortado a 40 chars en cliente, validación de sólo-espacios antes del POST; el 409 del backend se muestra tal cual (mensaje humano).
- Edición: botón "Editar" (sólo OWNER) → `EditAliasModal` → `PATCH /cashiers/:id`.
- Listado: alias primero (negro), email secundario en gris junto a rol y último acceso. Avatar con iniciales del alias. Confirmaciones de revocar y cambio de PIN usan el alias.

## Frente 5 — Rider: badge CUENTA solapa N PAX

Arreglado en `TableCard` (TableMapScreen). Los badges "cuenta" y "cobro pendiente" eran `absolute top-2 right-2` y pisaban el "N pax" del header. Ahora la columna derecha del header es un `flex-col items-end` que apila pax + badge; los spans absolutos desaparecieron. No fue carryover.

---

## Fuera de la frontera literal (justificado)

- `apps/api/src/tables/routes.ts`: no estaba en la lista de archivos, pero el Frente 2 pide explícitamente "ticket `openedBy`: exponer alias junto a lo existente" y ese dato vive en `buildTableSnapshot`. Cambio aditivo (`openedByAlias`).
- `apps/api/src/users/display.ts`: helper nuevo para no duplicar el fallback en 4 sitios.
- `apps/tpv-web/test/*`: 3 tests existentes renombraron la prop `cashierEmail` → `cashierLabel`.

## Notas / decisiones

- **TicketsHistoryPage**: el bloque mencionaba `openedByEmail` ahí, pero la página NO muestra cajero (los hits de "email" son el reenvío del ticket al cliente). Nada que cambiar; si algún día se pinta el cajero, el alias ya viaja en el snapshot de mesas y en el contrato de sesión.
- **Z PDF "Autorizado por"**: se optó por `alias (email)` en vez de sustituir — es audit trail y el alias no es único globalmente.

## Carryovers

1. **Eventos WS con `byEmail`** (`realtime/store-events.ts`, `emit-helpers.ts`, `tables/operativa.ts`, broadcast de `kitchen-dispatch.ts`): siguen llevando sólo email. Hoy ningún consumidor del TPV lo pinta en UI (sólo tipos en `useStoreEventStream`), así que no hay display de email vivo — pero si un bloque futuro pinta "quién cobró/envió" desde el WS, hay que añadir `byAlias` a esos payloads.
2. **CheckoutPage · autorización de encargado**: muestra el email que el encargado TECLEA como credencial (`managerEmail` del endpoint de autorización). No es display de identidad almacenada; si se quiere alias ahí, el endpoint de manager-authorize tendría que devolverlo.
3. **Backfill sólo verificado por contrato**: la suite mockea Prisma (sin Postgres real); `migration-v1-7-user-alias.test.ts` fija el SQL (aditiva + backfill + sin unique) pero no lo ejecuta. Verificar el backfill contra la BD del piloto al aplicar la migración en el deploy.
4. **Usuarios legacy**: hasta que el admin edite el alias, imprimen la local-part del email (backfill). Si la local-part es fea (`m.garcia.1987`), es el admin quien debe poner "María" desde CashiersPage → Editar.
