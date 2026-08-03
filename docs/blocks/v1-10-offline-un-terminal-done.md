# v1.10 · Offline de un terminal — DONE

**Fase 0** del plan `claude/arquitectura-offline-y-app-nativa.md` (que no existe
como fichero; el plan vive en `docs/roadmap-master.md` y en el prompt del
bloque). Objetivo cumplido: **un único terminal ya bootstrapeado opera un turno
completo sin internet** (login de cajero por PIN → abrir turno → vender → cobrar
→ cerrar/arquear) y **sincroniza sin duplicar** al volver la red.

Rama: `v1-10-offline-un-terminal` (sin merge — lo hace Matías). Un commit por
sub-entrega.

---

## Estructura (qué se tocó)

### Backend (`apps/api`)
- `src/shift/cashier-auth.ts` — **nuevo endpoint `GET /shift/offline-bundle`**
  (`preHandler: requireDeviceToken`). Devuelve el *paquete offline*: roster de
  cajeros que pueden abrir turno (`OWNER/MANAGER/CASHIER` con `pinHash != null`)
  con su `pinHash`, config del tenant (`cashierSessionTtlMinutes`,
  `cashierAutoLogoutMinutes`) y `shiftState` (mismo cálculo que el login).
- `test/offline-bundle.test.ts` — cobertura del endpoint (roster con pinHash,
  filtro sin-PIN, shiftState reanudar, 401 sin/mal device token).

**No se tocó el esquema de BD.** Ver *decisión 1*.

### Frontend (`apps/tpv-web`)
- `src/lib/offlineAuth.ts` — **nueva BD IndexedDB `mipiacetpv-auth`** (stores
  `roster`, `config`, `session`, `rateLimit`, `shift`). Cachea el paquete,
  verifica el PIN en local (argon2id WASM), rate-limit local, sesión de cajero
  local.
- `src/lib/offlineShift.ts` — estado de turno local (store `shift`). Turno
  abierto offline nace con `localId` + `serverId: null`; sobrevive recargas.
- `src/lib/offlineSession.ts` — pegamento UI↔libs (`refreshOfflineBundle`,
  `offlineLogin`, `deriveOfflineShiftState`).
- `src/lib/outbox.ts` — `OutboxKind` extendido con `shift-open` / `shift-close`
  / `cash-count`; etiquetado por turno local, **gate** de dependientes,
  **reescritura** `shiftId` local→server e **idempotencia 409** de las
  operaciones de turno.
- `src/hooks/useDeviceBootstrap.ts` — cachea `device-me` en localStorage →
  recarga sin red no queda colgada en el spinner.
- `src/App.tsx` — registra los hooks del outbox, descarga el paquete al arrancar
  online, renueva el JWT al volver la red (PIN en memoria), espeja/limpia el
  turno local según el login.
- `src/pages/PinScreen.tsx`, `src/components/ReloginPinModal.tsx` — fallback a
  PIN local cuando falla la red.
- `src/pages/ShiftOpenScreen.tsx` — apertura offline (turno local + `shift-open`
  encolado).
- `src/pages/CloseShiftModal.tsx` — cierre/arqueo Z desde datos locales +
  `cash-count` encolado.
- `src/pages/CheckoutPage.outboxChip.tsx` — indicador honesto de "sin conexión".
- `src/lib/version-check.ts` — documentado que `mipiacetpv-auth` y
  `mipiacetpv-outbox` quedan FUERA de `IDB_NAMES_TO_CLEAR` (sobreviven a
  deploys).
- Tests: `offline-auth.test.ts`, `offline-shift-outbox.test.ts`,
  `offline-session.test.ts`.
- `package.json` — nueva dep `hash-wasm ^4.12.0`.

---

## Qué quedó hecho vs. alcance

| Alcance del prompt | Estado |
|---|---|
| §1 Paquete offline de autenticación (API + cache front) | ✅ |
| §2 Login de cajero offline (PIN argon2 WASM + rate-limit local + sesión local) | ✅ |
| §3 Ciclo de turno offline (abrir/cerrar/arqueo vía outbox + estado local) | ✅ |
| §4 Degradado limpio + indicador honesto | ✅ |
| Idempotencia open/close/cash-count | ✅ (cliente, sin tocar esquema — *decisión 1*) |
| El camino online no cambia | ✅ (251 tests tpv-web verdes, sin regresión) |

`ShiftActiveScreen.tsx` figuraba en el prompt pero está **muerto** en el flujo
real desde B4 (App renderiza `TpvHome`, no `ShiftActiveScreen`). No se cableó a
propósito — habría sido código inalcanzable. Ver *duda abierta 3*.

---

## Decisiones tomadas sin preguntar (una a una)

### Decisión 1 — Idempotencia del turno SIN cambio de esquema (reescritura cliente)
**Qué:** el prompt permitía añadir idempotencia server-side a
open/close/cash-count "si no lo cubre ya". Opté por **NO tocar el esquema de BD
ni la ruta de tickets** y resolver la idempotencia **en el cliente**:

- El turno offline nace con un `localId` (UUID v4). Los tickets vendidos offline
  llevan ese `localId` como `shiftId` en su body (CheckoutPage no cambia: el
  outbox auto-etiqueta el item consultando el turno local).
- El outbox envía **`shift-open` primero**. Cuando el server responde con el id
  real (`{shift:{id}}`), el outbox **reescribe** `shiftId` local→server en todos
  los items dependientes (tickets y arqueos, incluido el `:id` del path) y
  `offlineShift` fija el `serverId`.
- Los dependientes quedan **bloqueados (gate)** mientras su `shift-open` siga en
  la cola: nunca viajan con un `shiftId` que el server desconoce
  (`SHIFT_NOT_OPEN`).
- **Idempotencia por 409**: si el `shift-open` se reintenta y el server ya lo
  creó, devuelve `409 SHIFT_ALREADY_OPEN` con `openShiftId` → el cliente lo
  adopta como éxito. Igual para `cash-count`/`shift-close` con
  `SHIFT_ALREADY_CLOSED` / `Z_ALREADY_EXISTS`.

**Por qué:** la alternativa "limpia" (columna `Shift.externalId @unique` +
resolver `shiftId`-o-`externalId` en `POST /tickets`, `/close`, `/cash-count`)
obliga a **tocar la ruta de tickets**, que es el corazón del camino online, y a
una migración. Para *un solo terminal* (Fase 0) la reescritura cliente da la
misma garantía (turno único, ventas únicas) con **riesgo cero para el online** y
sin migración. La restricción del prompt era explícita: "sin tocar esquema salvo
lo justificado; si requiere tocar la API más de lo mínimo, documentarlo y
proponerlo, no improvisar". Aquí no hizo falta.
**Propuesta para Fase 2 (multi-terminal):** con varios terminales compartiendo
turno, la reescritura cliente no basta (cada uno tendría su `localId`). Ahí sí
conviene `Shift.externalId @unique` + resolución server-side. Se aborda con el
nodo local de Fase 2.

### Decisión 2 — Librería argon2 WASM: `hash-wasm`
**Qué:** verificación del PIN en cliente con `hash-wasm` (`argon2Verify`).
**Por qué:** (a) verifica directamente el string PHC de argon2id que ya emite el
server (`apps/api/src/auth/passwords.ts`, `$argon2id$v=19$m=65536,t=3,p=1$...`),
sin reimplementar el parseo; (b) es **WASM puro, sin build nativo** (cumple la
restricción "sin dependencias nativas pesadas" — corre en WebView/PWA y en
Node/vitest); (c) ligera (~50 KB) y mantenida. Candidata sugerida por el prompt.
Descartadas: `argon2-browser` (asm.js viejo, peor DX de bundling) y reimplementar
(inviable/arriesgado con cripto).

### Decisión 3 — Modelo de confianza: cachear el `pinHash`, no el PIN
**Qué:** el paquete offline lleva el **hash argon2id** del PIN, nunca el PIN en
claro, y sólo se entrega a un **device ya emparejado** (`requireDeviceToken`).
**Por qué / superficie de ataque:** un atacante con acceso físico al IndexedDB
de un terminal robado ve el mismo hash que protege la BD del servidor.
Fuerza-brutearlo cuesta lo mismo que atacar el server: argon2id con 64 MB / t=3
por intento (≈250 ms/intento en hardware modesto). El rate-limit local (5
intentos → bloqueo 15 min) **refleja** la política del server pero **no la
sustituye**: quien controla el IndexedDB puede borrar el contador; da igual,
sigue enfrentándose al argon2id. El server es la red de seguridad definitiva:
idempotencia del outbox + re-validación real al volver la red. Se cachea sólo el
roster de quien **puede abrir turno en esa caja** (no todo el tenant).

### Decisión 4 — Renovación del JWT: PIN en memoria, nunca persistido
**Qué:** el prompt pide "al recuperar red, renovar contra `/shift/cashier-login`
en segundo plano". Para hacerlo hace falta el PIN. Decisión: **retener el PIN
sólo en memoria de React** (`App.offlineCreds`) mientras la pestaña vive; al
volver `navigator.onLine` (evento `online` + tick de 20 s) se hace el login real
→ se guarda el JWT → el outbox sube el turno + ventas. **Nunca se escribe el PIN
a disco.**
**Trade-off honesto:** si la PWA se recarga estando aún offline, el PIN en
memoria se pierde → cuando vuelva la red el outbox **no puede** subir nada hasta
que el cajero haga un login online normal (que mintará el JWT y disparará el
flush). Es lo correcto: no persistir el PIN es más importante que un reintento
100 % automático. Los datos siguen a salvo en local; sólo se difiere la subida.

### Decisión 5 — `device-me` cacheado en localStorage
**Qué:** cacheo la respuesta de `/devices/me` (ids + nombres + auto-logout) para
que una **recarga de la PWA sin red** no quede colgada en "loading" (antes
reintentaba `/devices/me` cada 3 s indefinidamente y bloqueaba todo el modo
offline). Sólo datos no sensibles. Se purga si el server confirma revocación.
**Por qué:** sin esto, el requisito "recarga a mitad de turno offline → el estado
se recupera" era imposible: el terminal ni siquiera llegaba a la PinScreen.

### Decisión 6 — Z offline desde datos locales (aproximado, best-effort)
**Qué:** el arqueo Z offline calcula `cashTheoretical = fondo inicial + efectivo
neto` sumando los pagos `CASH` de los tickets del turno **que siguen en la cola
local** (restando refunds). Es una aproximación: si algún ticket ya se subió y se
borró de la cola, no cuenta en el Z local. El **Z definitivo** lo recalcula el
server al procesar el `cash-count` (fuente de verdad).
**Por qué:** offline no hay forma de conocer el total autoritativo; el prompt
pide "informe Z desde datos locales" para no bloquear el cierre. El cajero ve un
Z coherente; el server cuadra al sincronizar.

### Decisión 7 — `mipiacetpv-auth` fuera de `IDB_NAMES_TO_CLEAR`
Igual que el outbox: el paquete offline, la sesión local y el turno offline
**deben sobrevivir a deploys**. Documentado en `version-check.ts`.

### Decisión 8 — Rama `v1-10-offline-un-terminal` desde `master`
El repo integra en `master` (los últimos commits son merges a master). Creé la
rama de trabajo desde ahí. Sin merge ni push (los hace Matías).

---

## Dudas abiertas

1. **`forceClose` offline.** Si el terminal recupera sesión offline con un turno
   de un día anterior colgado, `deriveOfflineShiftState` lo trata como
   `reanudar` (no `forceClose`) — el cierre forzado real necesita el server.
   Aceptable para un terminal que opera a diario; revisar si aparece en piloto.
2. **Rate-limit local vs. server desincronizados.** Son contadores
   independientes (Redis vs. IndexedDB). Tras reconectar, el cajero podría tener
   "0 intentos" en local y "3 fallos" en server (o al revés). No es un problema
   de seguridad (el server manda), pero el countdown mostrado offline puede no
   coincidir con el online. No se intentó reconciliar.
3. **`ShiftActiveScreen` muerto.** ¿Se borra en un bloque de limpieza? Hoy sólo
   se referencia a sí mismo. No lo toqué para no ampliar la superficie.
4. **Z local aproximado** (ver decisión 6): si en piloto molesta la diferencia
   con el Z real, la Fase 2 con nodo local lo resuelve al tener el histórico
   completo en local.

---

## Fuera de alcance (respetado)
- Multi-terminal sin internet (Fase 2): **no** se tocó el WebSocket de mesas ni
  se intentó sync P2P.
- Login de dueño por email+contraseña offline: fuera.
- Numeración fiscal offline: la subida a Holded sigue por worker/outbox; no se
  rediseñó.
- App nativa (A1/A2/A3): sin colisión (no se tocó `apps/tpv-android`).

---

## Cómo probarlo de cero

### Tests automáticos (DoD #1)
```
pnpm test          # 972 passed | 3 skipped (los 3 skip = timeouts Redis de entorno)
```
Focalizados:
```
npx vitest run apps/api/test/offline-bundle.test.ts
npx vitest run apps/tpv-web/test/offline-auth.test.ts
npx vitest run apps/tpv-web/test/offline-shift-outbox.test.ts
npx vitest run apps/tpv-web/test/offline-session.test.ts
```

### Manual (DoD #2 — demostrable en modo avión)
1. Con el terminal **bootstrapeado y con red**, entra una vez (login de cajero).
   Esto descarga el paquete offline (`GET /shift/offline-bundle`) y cachea
   `device-me`.
2. **Corta la red** (modo avión / DevTools → Offline).
3. **Recarga la PWA** → debe llegar a la PinScreen (no quedar en spinner).
4. **Login por PIN** → verifica en local (chip inferior no debe mostrar errores).
5. **Abrir turno** (fondo de caja) → se abre al instante; aparece en el chip
   "Sin conexión · 1 guardado".
6. **Vender y cobrar** un par de tickets (efectivo) → se acumulan en el chip.
7. **Cerrar turno / arqueo Z** → cuenta el efectivo; se muestra el Z local.
8. **Restaura la red.** En segundos: el outbox sube `shift-open` (primero), los
   tickets (con el `shiftId` ya reescrito al del server) y el `cash-count`. El
   chip se vacía. Verifica en el admin/Holded: **un solo turno, ventas únicas**,
   sin duplicados.

Para provocar el reintento idempotente: durante el paso 8, corta y restaura la
red a mitad del flush; no debe aparecer un segundo turno ni tickets dobles.
