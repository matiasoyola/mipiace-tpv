# Bloque v1.7 · Alias de cajeros (adiós al email en pantalla y en ticket)

**Rama:** `v1-7-alias-cajeros` (worktree nuevo, NO sobre master directo)
**Origen:** decisión de Matías durante la implantación de Cachictos (2026-06-24): el usuario del TPV debe tener **alias obligatorio al crearlo**, y el alias sustituye al email en TODOS los sitios donde hoy se muestra (TPV, ticket impreso, comanderas, informes, admin). Un ticket que pone "María" en vez de "m.garcia.1987@gmail" es producto terminado.
**Decisión de producto:** alias > email, siempre. El email queda como credencial y canal, nada más.

---

## ⚠️ Bloque paralelo en vuelo — frontera de coexistencia

`v1-6-precio-sobre-total` corre en paralelo y toca `apps/tpv-web/src/pages/SalePage.lineSheet.tsx` y `apps/tpv-web/src/lib/cart.ts`. **NO toques esos dos archivos bajo ningún concepto.** Si un punto de display de email cayera dentro de ellos, anótalo como carryover en el done.md y sigue.

## Frontera de archivos

- `packages/db/prisma/schema.prisma` + **una** migración aditiva (`v1_7_user_alias`).
- `apps/api/src/cashiers/routes.ts`, `apps/api/src/auth/**` (cashier-auth bootstrap/sesión), `apps/api/src/shifts/**` (opened/closed, informe Z), `apps/api/src/tickets/print.ts`, `send-to-kitchen.ts`, `kitchen-dispatch.ts` (cashierLabel).
- `packages/escpos-builder/src/ticket.ts` sólo si `cashierLabel` necesita cambio de tipo/campo (probablemente no: ya es un string libre — basta poblarlo con alias).
- `apps/tpv-web/src/**` (App.tsx, SalePage.tsx, ReloginPinModal.tsx, storage.ts recent cashiers, TicketsHistoryPage.tsx, TableMapScreen.tsx) — **excepto** `SalePage.lineSheet.tsx` y `lib/cart.ts`.
- `apps/admin/src/pages/CashiersPage.tsx` (form alta/edición + listado).
- Tests de todo lo anterior + `docs/blocks/v1-7-alias-cajeros-done.md`.

**NO toques:** `apps/tpv-android/**`, `infra/**`, super-admin, onboarding.

---

## Frente 1 — Modelo y migración

- `User.alias String?` (nullable en BD, `@map("alias")`). Migración aditiva con **backfill**: `alias = local-part del email` (lo anterior a la `@`), truncado a 40 chars. Nullable en schema para no romper filas legacy de otros roles, pero la API lo hace obligatorio para cajeros (Frente 2).
- Sin unique global. **Unicidad por tenant entre cajeros activos** validada en API (case-insensitive), no como constraint de BD — un "María" puede existir en dos tenants.

## Frente 2 — API

- `POST /cashiers`: `alias` **required** (1..40 chars, trim, sin sólo-espacios). `PATCH`: editable. Listado devuelve `alias`.
- Duplicado en tenant → 409 con mensaje humano ("Ya hay un cajero llamado María").
- Bootstrap de sesión de cajero (cashier-auth): el payload/respuesta que hoy lleva `email` pasa a llevar también `alias` (email se mantiene por compat — NO lo quites del contrato, los devices con SW viejo lo siguen leyendo).
- Shift opened/closed, informe Z, ticket `openedBy`, force-close: exponer alias junto a lo existente.
- `print.ts` / `send-to-kitchen.ts` / `kitchen-dispatch.ts`: `cashierLabel = alias ?? email recortado` (fallback obligatorio en TODOS los puntos: hay users legacy sin alias hasta que el admin los edite).

## Frente 3 — TPV (tpv-web)

Reemplaza email por `alias` (con fallback a email) en todos los puntos de display: header SalePage, botón Bloquear, ReloginPinModal, recent cashiers de `storage.ts` (migra la shape guardada con tolerancia a entradas viejas sin alias), TicketsHistoryPage (`openedByEmail` → mostrar alias si viene), TableMapScreen si muestra operador. OJO: el "atendido por" de SERVICES (vertical pinta) es texto libre distinto — NO lo toques.

## Frente 4 — Admin

`CashiersPage`: campo Alias obligatorio en alta, editable en edición, columna en listado (alias primero, email secundario en gris). Validación en cliente + mensaje del 409.

## Frente 5 (rider cosmético, 30 min) — Badge CUENTA solapa N PAX

En `TableCard` (mapa de mesas) el badge CUENTA se solapa con el de N PAX. Arréglalo (stack vertical o reposicionamiento). Si resulta no-trivial, carryover.

---

## Cierre

- Suite completa verde + `tsc` limpio. Tests nuevos: unicidad por tenant, backfill de migración, fallback alias→email en cashierLabel y en TPV, contrato cashier-auth con y sin alias.
- `docs/blocks/v1-7-alias-cajeros-done.md` con puntos de display cubiertos (lista exhaustiva) y carryovers.
- NO mergees ni despliegues — lo hace Matías. La migración es aditiva: sin ventana de mantenimiento.
