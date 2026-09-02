# Bloque Reservas-6 · Capa de yield sobre `BookingPolicy`

> B4 creó la tabla `booking_policies` y **nadie la lee**: cero apariciones de `BookingPolicy` en todo
> `apps/` (ver `docs/reservas/01-cruce-con-b-reservas-4.md` §H1). Hoy el motor ofrece y acepta
> **cualquier hueco físicamente posible, incluido ayer**. Este bloque pone las reglas del centro entre
> el motor y la clienta — al listar **y** al reservar — y salda de paso la deuda declarada de B4
> (ADR-R8 §3.6 prometía el subset min/max lead + ventana de cancelación, que no llegó).
>
> Rama propia en worktree. Sin push.

## Contexto (leer antes)

- **`docs/reservas/01-cruce-con-b-reservas-4.md`** — el cruce. §H1 (el hueco medido), §1.2 punto 6 (la
  simetría listar/reservar **ya existe**: `availability()` y `hold()` llaman a la misma
  `planForStart()`), **D-4b** (la fuga que hay que cerrar) y la Parte 4 (los invariantes que este
  bloque cierra).
- **`docs/reservas/00-koibox-ingenieria-inversa-y-modelo.md` §3.5** — las cuatro reglas, con los
  números del negocio que las justifican, ya probadas en producción en `rt-booking`. **Documento de
  entrada: sus marcas `[H]` no son hechos; el §1.8 entero no se usa.**
- `docs/design/agenda-belleza-spec.md` §5 — el diseño de la capa de políticas de casa (pipeline
  `(slot, context) -> allow/deny/annotate`, funciones puras registradas, parámetros en BD). **Es la
  forma; el §3.5 del documento de entrada pone el contenido.**
- `docs/design/adr-r8-motor-reservas-agnostico.md` §3.6 (claves de `booking_policy`) y §4 (el motor).
- `apps/api/src/agenda/engine.ts` — `availability()` (`:455`), `hold()` (`:466`), `reschedule()`
  (`:548`) y `planForStart()` (`:290`), que es el punto único del que cuelgan las reglas.
- `packages/db/prisma/schema.prisma:2032` — `BookingPolicy(tenantId, key, value Json)`, `@@unique([tenantId, key])`.
  **La tabla ya existe: este bloque no la migra, la usa.**
- Memoria: `criterio_funciona_sabotaje` (la tabla sabotaje→test rojo es obligatoria en el cierre).

## Alcance

### 1. El registro de políticas (apps/api)

Nuevo `apps/api/src/agenda/policy.ts`. Una política es **una función pura registrada en código**; la
fila de `booking_policies` sólo la **parametriza** y la **enciende**:

```ts
type PolicyVerdict =
  | { allow: true }
  | { allow: false; code: string; explain: string; nextOpening?: string };

interface Policy {
  key: string;                                  // la key de booking_policies
  evaluate(slot: SlotCandidate, ctx: PolicyContext, value: unknown): PolicyVerdict;
}
```

- **Registro estático**: una `key` sin función registrada se **ignora con warning en log**, nunca
  rompe el motor. Una función registrada sin fila en BD está **apagada**.
- **`value` valida su forma** al leerse (esquema por política). Un `value` corrupto **apaga esa
  política y lo dice**; no tumba la disponibilidad del centro.
- **Caché por tenant** con invalidación al escribir la política (mismo patrón que el resto del repo).

### 2. Las políticas de la v1

Siete claves. Las tres primeras son la deuda de B4; las cuatro siguientes son las reglas medidas del
§3.5. **Todas apagables** (sin fila → no se aplica) y **todas explicables por teléfono**:

| key | Qué hace | `value` (forma) | Explicación a la clienta |
|---|---|---|---|
| `MIN_LEAD_MINUTES` | Antelación mínima. **Y con ella se acaba el poder reservar en el pasado** | `{ minutes: 60 }` | «Necesitamos una hora de margen» |
| `MAX_LEAD_DAYS` | Horizonte máximo | `{ days: 60 }` | «La agenda se abre con 60 días» |
| `CANCEL_WINDOW_HOURS` | Ventana de cancelación sin penalización | `{ hours: 24, penaltyPct: 30, noShowPct: 100 }` | Ya confirmado con Raquel el 29-may (ver `rt-gift-cards/docs/02-BUSINESS-RULES.md`): +24 h gratis, −24 h 30 %, no-show 100 % |
| `CLOSED_WINDOWS` | Franjas cerradas salvo lista blanca de servicios (el «sábado tarde») | `{ windows:[{ rrule, from, to, allowServiceIds:[] }] }` | «Los sábados por la tarde sólo hacemos X» |
| `PROTECTED_SLOTS` | Franjas de valor reservadas a servicios de duración ≥ N | `{ windows:[{ rrule, from, to, minDurationMin: 30 }] }` | «A las 12:00 guardamos sitio para tratamientos de 30 min o más» |
| `LATE_RELEASE_HOURS` | Una franja protegida se **libera** si sigue vacía a X horas | `{ hours: 48 }` | «Si a 48 h sigue libre, te la damos» |
| `NO_FRAGMENT` | **No partir bloques libres**: un servicio corto sólo se ofrece pegado a un extremo de un bloque libre | `{ maxGapMin: 15 }` | «Te lo pongo a las 10:00 o a las 12:45, para no dejar un hueco muerto» |

`NO_FRAGMENT` es la que más capacidad protege y la que nadie cuenta (medido: 48 huecos crudos → 6 con
la regla). Es **aritmética de empaquetado, no predicción**.

### 3. El enganche: al listar Y al reservar — la mitad importante del bloque

- **Un solo punto de evaluación.** `evaluatePolicies()` se llama desde `availability()`,
  desde `hold()` y desde `reschedule()`. La fontanería ya está: los tres pasan por `planForStart()`.
  **Si una regla filtra sólo al listar, basta con adivinar la hora y llamar al endpoint** — y eso ya
  nos pasó en `rt-booking`.
- **Cerrar la fuga de la rejilla (D-4b del cruce).** Hoy `availability()` sólo propone inicios
  alineados a 15 min (`engine.ts:417`) pero `hold()` acepta **cualquier** `start` factible
  (`engine.ts:497`): se puede reservar a las 10:07 llamando al endpoint. `hold()` pasa a exigir
  alineación a la retícula del centro.
- **El error dice cuál regla y por qué.** `409 { error: "POLICY_BLOCKED", code, message, alternatives }`,
  con `message` = el texto explicable a la clienta, no el nombre de la función. Y **siempre con
  alternativas**: un error que no propone salida es medio error.
- **Excepción del mostrador, explícita y auditada.** Owner (no cajero) puede **forzar** una reserva
  que una política rechaza, con `{ overridePolicy: true }`; queda registrado quién y qué regla se
  saltó. Sin esto la política se apaga entera el primer día que estorbe.

### 4. Ajustes (front) — P11 del inventario de pantallas

Pantalla de reglas dentro de la agenda, gateada por `agendaEnabled` y sólo para OWNER:

- Una tarjeta por regla: **interruptor**, parámetros, y **la frase que se le dice a la clienta**
  escrita ahí mismo. Si una regla no se puede explicar por teléfono, no entra.
- **Simulación del efecto antes de guardar**: «hoy esta regla habría ofrecido 6 huecos en vez de 48».
  Se calcula con el motor real sobre el día en curso, no con una estimación.
- Cambios con **confirmación explícita** (tocan la agenda de todo el centro) y sin barra flotante que
  tape la acción primaria.

### 5. Cerrar la deuda de test que abre este bloque

Con el motor abierto se cierran, en el mismo bloque, cuatro invariantes de la Parte 5 del documento de
entrada que hoy están ❌/🟡 (ver Parte 4 del cruce):

- **Invariante 6** — `book()` de un hueco que `availability()` no ofrecía **falla**. Es el test
  fundacional de este bloque.
- **Invariante 2** — solape de **recurso**: la restricción existe y ningún test la ejerce.
- **Invariante 4** — un caso con **buffers ≠ 0** (hoy todos los tests van con buffers a 0,
  `agenda-engine.test.ts:290-291`).
- **Invariante 14** — repetir la suite de tz bajo otra `TZ` de proceso (`TZ=America/New_York`).
- **Y el que más vale:** un test de integración que ejecute el `EXCLUDE USING gist` **contra un
  Postgres real** (testcontainer o servicio de CI). Hoy la carrera se prueba contra un store en
  memoria que **simula** el EXCLUDE (`agenda-engine.test.ts:443`, decisión nº 1 de `B-reservas-4-done.md`).
  Nadie ha visto nunca a Postgres rechazar una fila.

## Restricciones

- **NO se migra el esquema.** `booking_policies` ya existe (`schema.prisma:2032`,
  `migration.sql:103`). Si algún `value` pidiera columna nueva, se replantea el `value`, no la tabla.
- **NO se toca el camino de cobro a Holded** (ADR-010: GET-back, tolerancia 5 cts, `/pay` idempotente).
- **NO se toca el anti-solape.** Las políticas corren **encima** del matching físico; el GiST sigue
  siendo el único árbitro del solape (ADR-R4).
- **Nada de IA ni de predicción.** Reglas deterministas, auditables y testeables. Cero reservas online
  = cero datos con los que entrenar. La capa predictiva, si llega, va encima — nunca en lugar de.
- **Toda regla apagable.** Sin fila de política, el motor se comporta **exactamente** como hoy. Un
  tenant sin políticas no nota este bloque.
- **Toda regla explicable a una clienta por teléfono.** Si el texto no se puede leer en voz alta, la
  regla no entra en la v1.
- Vocabulario neutro (ADR-R6): cero `if (businessType)`. Gate `agendaEnabled` en ruta y en UI.
- Multi-tenant por fila; la política es **por tenant**, nunca global.
- **No commit en el worktree principal.** `git worktree list` antes de la primera línea. No push.

## Entregables

- `apps/api/src/agenda/policy.ts` (registro + 7 políticas + evaluación) y el enganche en
  `engine.ts` (`availability`, `hold`, `reschedule`).
- Alineación a la retícula en `hold()` (D-4b).
- API: `GET/PUT /agenda/policies` (OWNER), `POST /agenda/policies/simulate` (efecto sobre un día real).
- `403`/`409` con `code` + `message` explicable + `alternatives`.
- Front: pantalla de reglas con interruptor, parámetros, frase a la clienta y simulación.
- **Tests**: uno por política (encendida/apagada/valor corrupto), el de simetría listar↔reservar, el
  de override auditado, los invariantes 2/4/6/14, y **el de integración del EXCLUDE contra Postgres
  real**.
- **Criterio de "funciona"**: en un tenant con `agendaEnabled` y `PROTECTED_SLOTS` + `NO_FRAGMENT`
  encendidas, un servicio de 15 min en un día vacío ofrece **los huecos de los extremos, no todos**;
  llamar a `POST /agenda/appointments` con una hora del centro de un bloque libre devuelve **409
  `POLICY_BLOCKED`** con la frase explicable y tres alternativas; apagar la regla devuelve el
  comportamiento de hoy **sin desplegar nada**; y un OWNER puede forzarla dejando rastro.
- **Tabla sabotaje → test rojo** en el cierre: qué línea se rompe a mano y qué test se cae. Sin eso,
  el bloque no está verificado (memoria `criterio_funciona_sabotaje`).
- `docs/blocks/B-reservas-6-done.md` con la plantilla de la metodología.

## Fuera de alcance (explícito)

- **El saldo de programas y su consumo** — es **B-reservas-8**. Aquí no se toca `voucher` ni nada que
  se parezca a un saldo. Esta valla existe para que B-6 no se coma a B-8.
- **La ventana reservable separada del turno, el horario del centro y los festivos** — es
  **B-reservas-7**. Aquí las políticas se aplican sobre la disponibilidad **tal y como el motor la
  calcula hoy** (desde `staff_shifts`).
- **El panel de salud y la tarjeta «qué han filtrado hoy las reglas»** — es **B-reservas-9**. Aquí
  basta con **dejar la traza escrita** (qué regla descartó qué hueco) para que B-9 la pinte; no se
  construye la pantalla.
- **Cualquier cosa de Koibox** — es **B-reservas-10**.
- **Capa predictiva / IA / lista de espera** — fuera de la versión.
- **Cambiar el ajv de la API para devolver 400 ante parámetro desconocido** — es una decisión global
  del TPV (divergencia D-4 del cruce), pendiente de Matías. No se toca aquí.
- **`catalogDurationMin`** (publicar 90 y bloquear 100) — deuda de catálogo B-reservas-2, divergencia
  D-5. No entra.
- Comisiones, informes de agenda y ocupación — fase 2.

---

*Lanzar como los bloques previos: implementar respetando alcance/restricciones/fuera-de-alcance,
escribir el `-done.md`, no commit/push. Commit selectivo después (stage → revisar → commit), NUNCA
`git add -A`.*
