# Bloque v1.5-D · Hardening de aislamiento multi-tenant — DONE

**Rama:** `v1-5-D-seguridad-multitenant`
**Origen:** auditoría `docs/auditorias/2026-06-10-auditoria-tecnica-completa.md` §1, punto 11 del plan.
**Estado:** cerrado. `pnpm test` (workspace) verde, `tsc --noEmit` limpio. Sin cambio de schema (Frente 5 sólo propuesto). Sin merge a master.

---

## Resumen de números

- **Tests:** 667 passing + 3 skipped (legacy `describe.skip` pre-existente en `super-admin.test.ts`), antes 656 passing. **+11 tests** en este bloque.
- **Ficheros de test nuevos:** `tenant-isolation.test.ts` (6), `ws-tenant-isolation.test.ts` (2), `super-admin-2fa-throttle.test.ts` (1).
- **Tests añadidos a ficheros existentes:** `password-reset.test.ts` (+1), `two-factor.test.ts` (+1).
- **Código de producción tocado:** `tickets/routes.ts` (Frente 2), `auth/rate-limit.ts` + `auth/password-reset.ts` + `auth/routes.ts` + `superadmin/auth.ts` (Frente 3). Nada más.

---

## Frente 1 — Suite de aislamiento multi-tenant

**Entregable:** `apps/api/test/tenant-isolation.test.ts` — suite parametrizada de la familia **cashier-session** (el camino del dinero, `tickets/routes.ts`), dos tenants A y B con datos coexistiendo en el mismo store.

**Diseño que la hace morder (no queda hueca):**
- El fake aplica EXACTAMENTE el `where` que recibe, sin scoping de tenant implícito. Las filas de A y B coexisten.
- `findUnique({ where: { externalId } })` devuelve la fila por `externalId` SIN filtrar por tenant — fiel a Postgres, donde `externalId` es UNIQUE global. Si una ruta olvida asertar el tenant tras el lookup, el fake le entrega la fila ajena y la ruta filtra → test rojo.
- `findFirst({ where: { id, tenantId } })` sólo casa si AMBOS coinciden.
- Las aserciones comprueban SIEMPRE la respuesta HTTP de la ruta (403/404/409, nunca 200 con datos ajenos), nunca el estado interno del fake.

**Endpoints cubiertos (6):**

| Caso | Endpoint | Guardia | Resultado |
|------|----------|---------|-----------|
| Leer ticket ajeno | `GET /tickets/:id` | `findFirst {id, tenantId}` | 404 |
| Historial | `GET /tickets` | `findMany {tenantId}` | A nunca ve tickets de B |
| Idempotencia ticket | `POST /tickets` (externalId de B) | guardia tenant tras `findUnique` | 409, sin filtrar el objeto |
| Cerrar mesa/draft ajena | `POST /tickets/:id/checkout` | `findFirst {id, tenantId}` | 404 |
| Devolver ticket ajeno | `POST /refunds` (originalTicketId de B) | `findFirst {id, tenantId}` | 404 |
| **Idempotencia refund** | `POST /refunds` (externalId de B) | **NUEVA guardia (Frente 2)** | 409, sin filtrar el objeto |

**Evidencia de que la suite muerde:** el último caso (idempotencia de refund) se escribió ANTES del fix y se corrió en rojo — devolvía `200` con `serializeRefund(B)`. Tras el fix del Frente 2 pasa a `409`. Las otras 5 rutas ya estaban guardadas (B-Hardening A · S5) y pasan en verde desde el primer run, lo que confirma que el fake no es vacuo: distingue ruta-guardada de ruta-con-hueco.

**LIMITACIÓN CONOCIDA (documentada en el header del test):** es un fake in-memory, no una BD real. Prueba que la RUTA aplica la guardia asumiendo que Postgres se comporta como el fake (cosa que hace para los `where` usados). Coherente con el repo (46/63 ficheros ya mockean Prisma), dentro de frontera, y entrega el valor ahora.

**Cobertura por-diseño (NO en la suite parametrizada, verificado por lectura):**
- Familia **admin/owner** (`admin/tickets-errors.ts`, stores, registers, cashiers, settings, shifts/turnos): todas las rutas resuelven el recurso con `findFirst({ where: { id, tenantId: auth.tenantId } })` antes de mutar. Ver auditoría de `externalId` en el Frente 2. Extender la suite parametrizada a esta familia es un **carryover** (requiere montar el fake de owner-auth por módulo).

---

## Frente 2 — Guardia de tenant en idempotencia por `externalId`

**Hueco real cerrado:** `tickets/routes.ts` idempotencia de **refund** (~1266). Hacía `prisma.refund.findUnique({ where: { externalId } })` y devolvía `serializeRefund(existing)` con `duplicate:true` **sin comprobar `existing.tenantId === cashier.tid`**. Un `externalId` de refund de otro tenant (UNIQUE global) filtraba el objeto serializado.

**Fix:** misma guardia canónica que la creación de ticket (~204) — si `existing.tenantId !== cashier.tid`, responde `409 EXTERNAL_ID_TAKEN` genérico que NO confirma existencia cross-tenant ni devuelve el objeto.

**Auditoría de TODOS los `where: { externalId` del backend (veredicto por sitio):**

| Sitio | Contexto | Veredicto |
|-------|----------|-----------|
| `tickets/routes.ts:~200` (ticket create) | HTTP cashier | ✅ Ya guardado (409 tras lookup) |
| `tickets/routes.ts:~1266` (refund create) | HTTP cashier | ✅ **CERRADO en este bloque** (409 tras lookup) |
| `tickets/routes.ts:~484, ~828, ~1422` (`holdedUpload.upsert`) | HTTP cashier | ✅ Seguro: el `update` es no-op y el `externalId` es el del propio request, que sólo llega aquí tras pasar la guardia de idempotencia de ticket/refund (un externalId ajeno se rechaza con 409 antes). Dejado como está; riesgo práctico nulo. |
| `tickets/upload-ticket.ts` (×9), `upload-refund.ts` (×7) | Worker | ✅ Seguro por diseño: el worker procesa un `HoldedUpload` concreto que ya conoce su tenant. No expuesto a HTTP. |
| `admin/tickets-errors.ts:130` (`findMany {externalId: {in}}`) | HTTP owner | ✅ Seguro: los `externalIds` se derivan de tickets/refunds ya filtrados por `tenantId: auth.tenantId`. |
| `admin/tickets-errors.ts:373, 428, 612-627` (`holdedUpload.update {externalId}`) | HTTP owner | ✅ Seguro: cada uno va precedido de un `findFirst({ id, tenantId: auth.tenantId })` que resuelve el `externalId` de una fila ya probada como del tenant. |

---

## Frente 3 — Rate-limit en confirmación de password-reset y 2FA

La infraestructura `throttle()` ya existía pero sólo se aplicaba a la **solicitud** de password-reset (`pwd-reset-req:${email}`), no a los endpoints de **confirmación/verificación**. Se confirmaron **3 huecos** (uno más de los 2 que pedía el prompt) y se cerraron:

| Endpoint | Hueco | Fix | Clave | Test |
|----------|-------|-----|-------|------|
| `POST /auth/password-reset/confirm` | Hacía un `argon2.verify` por cada token vivo → fuerza bruta del token viable | `passwordResetConfirmThrottle` | **IP** (10/15min) | `password-reset.test.ts` |
| `POST /auth/login/2fa` (owner) | Código 6 dígitos sin throttle dentro de la validez del pendingToken | `twoFactorVerifyThrottle("owner", …)` | **cuenta (sub)** (5/15min) | `two-factor.test.ts` |
| `POST /super-admin/auth/login-2fa` | Igual; el paso de password sí tenía rate-limit, el de 2FA no | `twoFactorVerifyThrottle("super-admin", …)` | **cuenta (sub)** (5/15min) | `super-admin-2fa-throttle.test.ts` |

### Corrección post-revisión: la IP del throttle era falsificable

La primera implementación usaba un `clientIp()` que parseaba `X-Forwarded-For` y cogía el **primer** token. Pero Fastify no tenía `trustProxy`, así que ese primer token lo controla el cliente (Caddy añade la IP real al **final**). Como las claves metían esa IP, un atacante rotando la cabecera conseguía **buckets infinitos** y podía fuerza-brutear. Tres cambios:

1. **IP de confianza.** `apps/api/src/server.ts` → `Fastify({ trustProxy: 1, … })` (un único proxy de confianza = Caddy). A partir de ahí `request.ip` es el último salto del XFF (la IP real que añade Caddy), no falsificable. Se eliminó el parseo manual de `X-Forwarded-For`: todas las claves usan `request.ip`. Se borró el `clientIp` local de `superadmin/auth.ts` y se migró su rate-limit de login (`superAdminLoginRateLimit`) a `request.ip` — tenía la misma vulnerabilidad.
2. **2FA por cuenta, no por IP.** Clave `2fa-verify:<scope>:<sub>` (sin IP). Acota la fuerza bruta del código de 6 dígitos contra una cuenta concreta **independientemente de la IP de origen**. 5 intentos / 15 min. Riesgo asumido (menor): alguien puede quemar los 5 intentos de una víctima → bloqueo de 15 min, sólo el paso 2FA; el dueño legítimo acierta a la primera.
3. **password-reset/confirm por IP sola.** Con el punto 1 la IP ya es de confianza. El token es de 256 bits (no adivinable), así que el throttle aquí sólo limita el coste del argon2 por token. (Meter un prefijo del token en la clave la haría inútil: cada intento lleva token distinto → bucket distinto.)

**Tests de la corrección:**
- `password-reset.test.ts`: 10 confirms con un **primer token de XFF falso distinto cada vez** pero el último salto real constante → todos caen en el mismo bucket → el 11º es 429. Con la implementación vieja (primer token) cada intento habría tenido bucket propio y nunca se bloquearía.
- `two-factor.test.ts` y `super-admin-2fa-throttle.test.ts`: los 5 intentos llegan desde **IPs rotadas** (XFF distinto cada vez) y aun así el 6º es 429 → prueba que el bucket es la cuenta, no la IP.

Nuevas funciones en `auth/rate-limit.ts`: `passwordResetConfirmThrottle()`, `twoFactorVerifyThrottle()`. Los tests de auth montan el Fastify con `trustProxy: 1` para reproducir producción.

---

## Frente 4 — WebSocket: binding de tenant/store

**Verificado correcto, no se reescribió nada.** `realtime/ws-route.ts` ata la suscripción al store real del register del cashier: `register.findFirst({ where: { id: payload.rid, storeId, deletedAt: null } })` → cierra `4403` si el register del cashier no pertenece al `storeId` pedido. El bus (`store-event-bus.ts`) está indexado por `storeId` (UUID, partición global, sin colisión cross-tenant posible).

**Entregable: test** `ws-tenant-isolation.test.ts` (vía `app.injectWS` de `@fastify/websocket`, sin puerto real ni dependencia extra):
1. Cashier de A intentando suscribirse a un store de B → cierre **4403**.
2. Cashier suscrito a su store → recibe el evento de su store (control positivo) y **NO** el evento emitido al store de B.

(El aislamiento del bus en sí ya estaba cubierto en `store-event-bus.test.ts`.)

---

## Frente 5 — Email único por tenant (REQUIERE TU VISTO BUENO — no migrado)

**Hallazgo confirmado:** `packages/db/prisma/schema.prisma` modelo `User` tiene `email String @unique` **global**. La tabla `User` la comparten OWNER/MANAGER/CASHIER. Consecuencias:
- Dos tenants NO pueden tener un OWNER con el mismo email.
- El rate-limit de owner login (`ownerLoginRateLimit`) está keyed por email **solo** (no por tenant) → enumeración compartida entre tenants, tal como dice la auditoría. (El cashier login sí está keyed por `(tenantId, userId)`.)

**Migración propuesta (NO aplicada):**

```prisma
model User {
  // ...
  // QUITAR el @unique global de email:
  email String   // antes: String @unique
  // AÑADIR unicidad por-tenant:
  @@unique([tenantId, email])
  @@index([tenantId])
  @@map("users")
}
```

**Análisis de impacto (por qué NO la aplico a ciegas):** dejar de ser `@unique` global **rompe** todos los `prisma.user.findUnique({ where: { email } })`. Call sites afectados:
- `auth/routes.ts:72` y `:145` — **login del owner** (paso password y resolución de usuario).
- `auth/password-reset.ts:61` — solicitud de reset (busca owner por email).
- `superadmin/tenants.ts:1468` y `:1634` — checks de "email ya en uso" al crear tenant/owner.

Cada uno pasaría a `findFirst`. **El problema de fondo es el login:** en el login el usuario aporta sólo email+password, **sin contexto de tenant**. Con email único sólo por-tenant, el mismo email podría existir en varios tenants y el login no puede resolver a qué usuario sin un discriminador de tenant (subdominio, slug del tenant en la URL, o un campo en el form). Es decir, la migración **obliga a un cambio de arquitectura del flujo de login**, no es un simple cambio de schema.

**Recomendación:** decidir primero el discriminador de tenant en login antes de migrar. Hasta entonces, dejar el `@unique` global. Marcado **"requiere visto bueno"** — es un bloque propio (toca login flow + frontend admin), no de este frente.

---

## Carryovers

- **Extender la suite de aislamiento a la familia admin/owner y turnos** (stores, registers, cashiers, settings, tickets-errors, shifts). Hoy cubierta por-diseño (verificada por lectura: todas usan `findFirst {id, tenantId}`), pero no en la suite parametrizada — requiere montar el fake de owner-auth por módulo.
- **Patrón oro futuro: suite de aislamiento contra Postgres real** (testcontainers). Implicaciones de infra/CI, bloque aparte fuera de esta frontera. Cuando se haga, `tenant-isolation.test.ts` es lo primero que se porta (los casos y aserciones HTTP se reutilizan tal cual; sólo cambia el harness de seed).
- **Frente 5 (email por-tenant)** — requiere tu visto bueno + diseño del discriminador de tenant en login. Migración escrita arriba, sin aplicar.
- **`trustProxy: 1` asume exactamente un proxy (Caddy).** Si algún día se mete otro hop (un LB delante de Caddy), hay que subir el número o `request.ip` volvería a ser falsificable. Documentado aquí para no olvidarlo en un cambio de infra.

## Fuera de alcance (confirmado intacto)
- Marco fiscal sin tocar: Holded sigue siendo el SIF; no se introdujo numeración ni cálculo fiscal.
- No se tocó frontend, infra, ni otros prompts.
- Sin migración aplicada en VPS.
