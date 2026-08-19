# Bloque v1.10 · Offline de un terminal · login de cajero + ciclo de turno sin internet

## Contexto (leer antes)
- `claude/arquitectura-offline-y-app-nativa.md` (plan por fases; esto es la **Fase 0**).
- `apps/tpv-web/src/lib/outbox.ts` — patrón outbox v1.5-C (persistir antes de enviar, reenvío idempotente por `externalId`). SE REUTILIZA Y EXTIENDE.
- `apps/tpv-web/src/lib/catalog.ts` — patrón de cache en IndexedDB (BD fuera de `IDB_NAMES_TO_CLEAR`). Mismo patrón para el paquete offline de auth.
- `apps/api/src/shift/cashier-auth.ts` — login de cajero actual (verifica `pinHash` con argon2 server-side, rate-limit Redis, firma JWT de sesión).
- `apps/api/src/shift/routes.ts` — `/shift/current`, `/shift/open`, `/shift/:id/close`, `/shift/:id/cash-count`.
- `apps/tpv-web/src/pages/PinScreen.tsx`, `ShiftOpenScreen.tsx`, `ShiftActiveScreen.tsx`, `CloseShiftModal.tsx`, `components/ReloginPinModal.tsx`, `App.tsx` (bootstrap de cajero).

## Objetivo
Un **único terminal ya bootstrapeado** (con deviceToken) debe poder **operar un turno completo sin internet**: iniciar sesión de cajero con PIN, abrir turno, vender, cobrar, reimprimir y cerrar/arquear — todo offline — y sincronizar con el servidor y Holded cuando vuelva la conexión. Hoy la venta/cobro ya sobrevive (outbox v1.5-C); lo que falta es el **login de cajero** y el **ciclo de turno**, que aún son 100% servidor.

Fuera de alcance de este bloque el multi-terminal (mesas compartidas sin internet), que requiere nodo local (Fase 2).

## Alcance (concreto: ficheros, endpoints, estados)

### 1. Paquete offline de autenticación (bootstrap extendido)
- **API**: extender el bootstrap del cajero (`/shift/cashier-bootstrap` o endpoint nuevo `GET /shift/offline-bundle`, con `preHandler: requireDeviceToken`) para devolver, cuando hay red, un "paquete offline" del tenant:
  - roster de usuarios que pueden abrir turno en esa caja: `{ id, email, alias, role, pinHash }` (OWNER/MANAGER/CASHIER con `pinHash != null`).
  - config relevante: `cashierSessionTtlMinutes`, `cashierAutoLogoutMinutes`.
  - estado de turno actual de la caja (`registerId`).
- **Front**: nueva lib `apps/tpv-web/src/lib/offlineAuth.ts` que cachea ese paquete en una BD IndexedDB nueva `mipiacetpv-auth` (store `roster` + `config`), **fuera de `IDB_NAMES_TO_CLEAR`** de `version-check.ts` (debe sobrevivir a deploys). Se refresca en cada bootstrap online.

### 2. Login de cajero offline (PIN verificado en local)
- En `PinScreen.tsx` y `ReloginPinModal.tsx`: si `/shift/cashier-login` falla por red (no por credenciales), caer a verificación **local** del PIN contra el `pinHash` cacheado.
- Verificación argon2 en cliente vía WASM (dependencia a elegir y justificar en el done.md; candidata: `hash-wasm`, ligera y sin build nativo).
- **Rate-limit local**: contador por (email) en IndexedDB con la misma política que el server (5 intentos → bloqueo temporal). No sustituye al server; es su reflejo offline.
- Emitir una **"sesión de cajero local"** (marca en IndexedDB con expiración = `cashierSessionTtlMinutes`) que habilita operar. Al recuperar red, renovar/validar contra `/shift/cashier-login` en segundo plano para obtener el JWT real (que los POST del outbox necesitan).

### 3. Ciclo de turno offline
- **Estado de turno local**: store `shift` en `mipiacetpv-auth` (o BD propia). `SalePage`/`ShiftActiveScreen` leen el turno de local, no de `/shift/current`, con `/shift/current` como refresco cuando hay red.
- **Abrir turno offline** (`ShiftOpenScreen` → `/shift/open`): crear el turno en local con su `externalId`; encolar el `POST /shift/open` en el **outbox** (extender `OutboxKind` a `shift-open`). La UI abre el turno al instante (latencia percibida cero).
- **Cerrar turno / arqueo offline** (`CloseShiftModal` → `/shift/:id/close`, `/shift/:id/cash-count`): verificar el estado actual (el cierre ya toca outbox) y completar para que funcione end-to-end sin red; encolar como `shift-close` / `cash-count`. El informe Z se genera desde datos locales.
- **Idempotencia**: apoyarse en `externalId` (extender el patrón del backend a open/close/cash-count si no lo cubre ya; si requiere tocar la API más de lo mínimo, documentarlo y proponerlo, no improvisar el esquema).

### 4. Degradado limpio + indicador honesto
- Cada pantalla del flujo (PIN → abrir turno → venta → cobro → cierre) usable sin red, sin pantallas en blanco ni spinners infinitos.
- Indicador de "modo offline" discreto y honesto (reutilizar/extender el chip de pendientes del outbox, sin rediseñarlo). Nunca alarmante: los datos ESTÁN a salvo en local.

## Restricciones
- Hereda ADRs de front del proyecto (React+Vite+PWA, tokens Mi Piace, auditabilidad de cifras, latencia percibida cero — ver principios UX).
- **No romper el online**: el camino con red sigue siendo el de hoy; el offline es un fallback, no un reemplazo.
- **Seguridad**: cachear `pinHash` (no PIN en claro) en un dispositivo YA bootstrapeado (deviceToken). El server sigue siendo la red de seguridad (idempotencia + re-validación al volver). Documentar el modelo de confianza en el done.md.
- Sin dependencias nativas pesadas: la verificación argon2 va por WASM en el WebView/PWA.

## Entregables
- `apps/tpv-web/src/lib/offlineAuth.ts` (+ tests) — cache del paquete, verificación PIN local, rate-limit local, sesión local.
- `apps/tpv-web/src/lib/outbox.ts` extendido con `shift-open` / `shift-close` / `cash-count`.
- `PinScreen.tsx`, `ReloginPinModal.tsx`, `ShiftOpenScreen.tsx`, `ShiftActiveScreen.tsx`, `CloseShiftModal.tsx`, `App.tsx` (bootstrap) cableados al modo offline.
- API: endpoint/ampliación del bootstrap para el paquete offline (mínimo imprescindible; sin tocar esquema salvo lo justificado).
- Criterio de "funciona": con el dispositivo bootstrapeado, **cortar la red** y poder loguear cajero por PIN, abrir turno, vender, cobrar, cerrar turno; al **volver la red**, todo sincroniza sin duplicar (turno único, ventas únicas) y aparece en Holded.

## Tests (vitest, jsdom + fake-indexeddb)
- Login offline: PIN correcto contra `pinHash` cacheado → sesión local; PIN incorrecto → error; 5 fallos → bloqueo local.
- Bootstrap online refresca el paquete offline (roster/config).
- Abrir turno offline → outbox `shift-open` → "reconexión" → un solo turno en el server (idempotencia por `externalId`).
- Cerrar turno offline → arqueo Z desde datos locales → sync.
- Recarga de la PWA a mitad de turno offline → el estado local se recupera.
- El camino online no cambia (regresión de los tests existentes de login/turno).

## Fuera de alcance (explícito)
- **Multi-terminal sin internet** (varias tablets compartiendo mesas): necesita nodo local en el bar → Fase 2. NO tocar el WebSocket de mesas ni intentar sync P2P aquí.
- **Login de dueño por email+contraseña offline** (admin): es flujo de back-office, no operativo. Fuera.
- **Numeración fiscal offline / Holded**: la subida a Holded ya va por worker/outbox; NO rediseñar numeración fiscal aquí (se aborda en Fase 4 con el asesor fiscal).
- **App nativa** (impresión USB, escáner): bloques A1/A2/A3 aparte, corren en paralelo (tocan `apps/tpv-android`, no colisionan con este bloque).
- Cambios de esquema de BD salvo el mínimo justificado para el paquete offline / idempotencia de turno.

## Definición de hecho
1. `pnpm test` 0 failed, CI verde en el push de la rama.
2. Demostrable: modo avión, turno completo (login→venta→cobro→cierre) sin red; al volver, sync sin duplicados y reflejo en Holded.
3. `docs/blocks/v1-10-offline-un-terminal-done.md` con: estructura, qué quedó hecho vs alcance, **decisiones tomadas sin preguntar** (una a una, con justificación — especialmente el modelo de confianza de cachear `pinHash` y la elección de la lib argon2 WASM), dudas abiertas, y cómo probarlo de cero.
4. Un solo commit por sub-entrega; sin merge (lo hace Matías).
