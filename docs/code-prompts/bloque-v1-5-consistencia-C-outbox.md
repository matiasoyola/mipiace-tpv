# Bloque v1.5-Consistencia-C · Outbox offline del cobro (cero ventas perdidas)

**Rama:** `v1-5-outbox` (worktree limpio desde master)
**Origen:** auditoría 2026-06-10, hallazgo CRÍTICO de frontend: si la red cae en el instante del POST /tickets (o la PWA se recarga en ese momento), la venta puede perderse sin rastro. Para un TPV es el peor bug posible.
**Estimación:** 1-2 días Code.
**CORRE EN PARALELO con la rama `v1-0-pilotos`** — ver "Frontera de archivos" abajo. Entrega: un único commit, sin merge. `pnpm test` 0 failed, CI verde, `docs/blocks/v1-5-consistencia-C-done.md`.

---

## Objetivo

Garantía: **una vez el cajero pulsa Cobrar, la venta ya no se puede perder**. Ni por red caída, ni por recarga del SW, ni por crash del navegador, ni por cierre de pestaña.

## Diseño (outbox local en IndexedDB)

1. **Persistir ANTES de enviar**: al confirmar el cobro, el payload completo del POST /tickets (con su `externalId` ya generado) se escribe en un store `outbox` de IndexedDB ANTES de lanzar el request. Estados: `pending` → `sent` (2xx confirmado) → borrado. La pantalla de éxito solo depende de la persistencia local, no del POST.
2. **Reenvío automático**: al arrancar la PWA, al recuperar conectividad (`online` event) y cada N segundos si hay pendientes, se reenvía todo lo `pending`/no confirmado. La idempotencia por `externalId` ya existe en la API (reenviar dos veces no duplica — apoyarse en ella, verificarlo en un test contra el handler real).
3. **UI honesta**: si el POST no confirmó, el overlay de éxito muestra "Venta guardada — pendiente de enviar" (estado visual discreto, no alarmante: la venta ESTÁ a salvo). Contador de pendientes visible (reutilizar/extender el chip "Pendientes" existente si encaja, sin rediseñarlo). Cuando el reenvío confirma, el estado se actualiza sin intervención.
4. **Errores permanentes** (400/422 del servidor, no de red): NO reintentar en bucle; marcar `rejected` con el motivo, mostrarlo en Pendientes para acción manual, y reportar a Sentry. Un rechazo de validación no debe quedarse reintentando para siempre.
5. **Refunds y checkout de mesa**: aplicar el mismo outbox a POST /refunds y POST /tickets/:id/checkout si el esfuerzo es contenido; si no, documentar en done.md como fase 2 (la venta rápida es lo prioritario).
6. **Multi-pestaña**: dos pestañas del TPV no deben reenviar el mismo item a la vez (lock optimista por item con marca de tiempo, suficiente — la idempotencia del backend es la red de seguridad).

## Tests (jsdom + fake-indexeddb si hace falta como devDep, justificar)

- Cobro con red OK: outbox escribe → POST → confirmación → borrado.
- POST falla (network error) → item queda pending → "reconexión" → reenvío → confirmado.
- Recarga simulada entre persistencia y POST → al arrancar se reenvía.
- Respuesta 422 → rejected, sin bucle de reintentos, visible para el cajero.
- Doble reenvío del mismo externalId → un solo ticket (contra el handler con mock de BD, verificando que la idempotencia responde 200/409 coherente).

## Frontera de archivos (CRÍTICO — bloque en paralelo con v1-0-pilotos)

PERMITIDO tocar: `apps/tpv-web/src/pages/CheckoutPage*.tsx`, lib nueva `apps/tpv-web/src/lib/outbox.ts` (+ tests), registro de listeners en `apps/tpv-web/src/App.tsx` (mínimo), `apps/tpv-web/src/pages/RefundPage.tsx` si entra el punto 5.

PROHIBIDO tocar (los toca la otra rama): `SalePage*.tsx`, `ShiftForceCloseScreen/CloseShiftModal`, `apps/api/**` (la API NO se toca: la idempotencia ya existe), `apps/admin/**`, `packages/**`, `infra/**`, `.github/**`, schema/migraciones.

Si descubres que necesitas tocar algo de la lista prohibida, PARA y documenta en done.md — no lo toques.

## Definición de hecho

1. `pnpm test` 0 failed. CI verde en el push de la rama.
2. Demostrable: matar la red justo antes del POST y la venta sobrevive a recarga + se sincroniza al volver la red.
3. `docs/blocks/v1-5-consistencia-C-done.md` con resumen, decisiones y qué quedó a fase 2.
4. Un único commit: `v1.5-consistencia-C · outbox offline de cobros · cero ventas perdidas`.
