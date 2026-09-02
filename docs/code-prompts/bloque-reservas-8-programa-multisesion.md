# Bloque Reservas-8 · Programa multisesión: saldo y consumo atómico con la cita

> **Un programa no es un cheque regalo.** El cheque se canjea una vez; el programa de 10 sesiones
> tiene **saldo**, y ese saldo baja cuando se entrega una sesión. Hoy aquí no existe ni el saldo ni el
> consumo: `Appointment.voucherId` es una columna suelta (`schema.prisma:1916`, comentada «sólo la
> columna») y `GET /clients/:id/vouchers` devuelve un contrato **vacío a propósito**
> (`apps/api/src/crm/routes.ts:449-462`).
>
> Es el **diferencial comercial** del módulo, no una funcionalidad más: en el CRM incumbente el
> producto que más margen deja es invisible para cualquier integración, porque su API no expone bonos
> (verificado por barrido de documentación y por sondeo de 13 rutas, todas 404 —
> `docs/reservas/00-koibox-ingenieria-inversa-y-modelo.md` §1.6). Aquí la venta, el saldo, la cita y el
> ticket son **el mismo sistema**.
>
> Rama propia en worktree. Sin push.

## Contexto (leer antes)

- **`docs/reservas/01-cruce-con-b-reservas-4.md` §H3 y divergencia D-2** — el veredicto que fija este
  bloque: **el saldo por sesiones EXTIENDE el `voucher` ya diseñado; NO se crea un modelo paralelo
  `Program`/`ProgramBalance`/`ProgramConsumption`.** Un modelo paralelo significaría dos sitios donde
  mirar el saldo de una clienta, dos caminos fiscales y dos formas de canjear en caja.
- **`docs/design/reservas-modulo-kickoff.md` §4** — el modelo **ya decidido** de `voucher` (`type
  SESSIONS|AMOUNT`, `sessions_total`/`sessions_left`, `service_scope`, `expires_at`, `sold_ticket_id`)
  y `voucher_movement` (`delta_sessions`, `ticket_id`, `appointment_id`). **Es la base; se refina, no
  se sustituye.**
- **ADR-R3** (`reservas-modulo-kickoff.md` §3) — fiscalidad: la **venta** del bono se registra en
  Holded en el momento de la venta; el **canje no re-emite documento fiscal**. ⚠️ **Bloqueante
  declarado: lo confirma el asesor fiscal antes de producción.** Aquí no se inventa lógica fiscal
  (memoria `marco-legal-fiscal`).
- **ADR-R7** — QR de bono: token opaco firmado, validado con el lector HID que ya existe (ADR-011).
- **`docs/reservas/00-koibox-ingenieria-inversa-y-modelo.md` §1.6** — qué aporta el campo: la
  atomicidad como requisito, la función explícita de traducción programa→sesión, y la advertencia de
  catálogo (29 programas en 22 fichas de 46; 45 variantes reservables para 37 servicios).
- `apps/api/src/agenda/checkout.ts` — el puente cita→caja ya construido, y `bloque-reservas-5-cita-caja.md`,
  que hace que el cobro **pague el DRAFT enlazado**. Este bloque se cuelga de ahí, no lo reescribe.
- `docs/blocks/B-reservas-1-done.md` — el contrato de CRM que hoy devuelve el saldo vacío.

## Alcance

### 1. Datos (Prisma / Postgres) — migración aditiva

- **`vouchers`** — según el kickoff §4: `type SESSIONS|AMOUNT`, `sessionsTotal`/`sessionsLeft`,
  `amountTotalCents`/`amountLeftCents`, `serviceScope` (jsonb: qué variantes cubre), `expiresAt`,
  `status ACTIVE|REDEEMED|EXPIRED|CANCELLED`, `token` (opaco firmado, ADR-R7), `soldTicketId`,
  `clientId?`. `tenantId` por fila.
- **`voucher_movements`** — la traza del saldo: `voucherId`, `deltaSessions?`,
  `deltaAmountCents?`, `ticketId?`, `appointmentId?`, `createdByUserId`, `createdAt`.
  **Es append-only**: un saldo se corrige con un movimiento contrario, nunca editando el anterior.
- **Enlace duro con la cita**: `Appointment.voucherId` (ya existe) pasa a llevar FK real, y el
  movimiento de consumo guarda `appointmentId`. Una sesión consumida se puede rastrear hasta la cita
  que la gastó, y al revés.
- **Índice de saldo vivo** por `(tenantId, clientId, status)` — lo consulta la ficha y el panel de
  salud.
- Flag de capacidad `bonosEnabled` en `Tenant`, columna booleana explícita (patrón fijado en B1, ADR-R6).

### 2. La regla de traducción programa → sesión reservable · **función explícita, no convención**

Lo que se vende (el programa, N sesiones) **no es** lo que se reserva (una sesión, indistinguible en
la agenda de una cita suelta). La traducción es una función registrada y testeada:

```ts
resolveSession(voucher, requestedServiceId, ctx): 
  | { ok: true; serviceId }            // el scope cubre exactamente uno
  | { ok: false; reason: "AMBIGUOUS" | "NOT_COVERED" | "EXPIRED" | "NO_BALANCE"; message }
```

**Cuando es ambigua, se cae con mensaje.** Nunca elige en silencio: es la regla que ya se validó en
campo. El `message` es el texto que el cajero le lee a la clienta.

### 3. Consumo atómico · **el corazón del bloque**

> **Crear la cita y descontar la sesión son UNA SOLA TRANSACCIÓN. O las dos, o ninguna.**

- Una sola `$transaction` que hace: `INSERT appointment` + `items` + `assignments` (donde el GiST
  puede rechazar) **y** el `UPDATE vouchers SET sessions_left = sessions_left - 1` + el
  `INSERT voucher_movement`. Si el EXCLUDE salta, **el saldo no se toca**; si el saldo no da, **la
  cita no nace**.
- El decremento va **condicionado en la propia sentencia** (`WHERE sessions_left > 0`) y se comprueba
  el número de filas afectadas: dos cajeros a la vez sobre la última sesión → uno gana, el otro recibe
  `409 NO_BALANCE`. La concurrencia del saldo la resuelve la BD, igual que el solape.
- **Anular la cita devuelve la sesión**: movimiento contrario, con su `appointmentId`. Un no-show
  **no** la devuelve por defecto (hereda la política de no-show ya confirmada: no-show al 100 %), y eso
  es una política **apagable**, no una constante en el código.
- **Caducidad**: una sesión de un bono caducado no se consume. La prórroga es discrecional del
  operador (regla ya confirmada el 29-may) y **queda auditada**.

### 4. Venta y canje en caja

- **Venta del programa** = línea de ticket por el camino de cobro existente; al cobrarse se emite el
  voucher con su `soldTicketId` (ADR-R3). **No se toca `/pay` ni el GET-back** (ADR-010).
- **Canje en la cita**: al cerrar en caja una cita con `voucherId`, la línea de servicio va al ticket
  con el importe que decida **P5** (ver Restricciones) y el ticket **no re-emite documento fiscal por
  la parte del bono**. Extras (productos, servicios no incluidos) van al ticket normal.
- **QR** (ADR-R7): token opaco firmado, validable con el lector HID ya integrado. Sin hardware nuevo.

### 5. Front

- **Ficha de cliente · saldo y consumo** (P8): saldo vivo por programa, **qué cita gastó qué sesión**
  (la traza, legible), caducidad y estado. Rellena el hueco que hoy pinta un 0.
- **En el alta de cita**: si la clienta tiene saldo para ese servicio, se ofrece consumirlo, con el
  saldo resultante **antes** de confirmar. Si `resolveSession` es ambigua, se pregunta; no se elige.
- **En la rejilla**: la sesión de programa se distingue de una cita suelta con un distintivo sobrio
  (punto + inicial), sin teñir el bloque entero.

## Restricciones

- **NO se crea `Program`/`ProgramBalance`/`ProgramConsumption`.** El saldo por sesiones vive en
  `voucher` + `voucher_movement` (divergencia **D-2** del cruce). Decisión de este proyecto; el
  documento de entrada propone otra cosa y no se sigue.
- **NO se inventa lógica fiscal** (memoria `marco-legal-fiscal`, ADR-008, ADR-R3). ⚠️ **El importe que
  va a la línea del ticket al consumir una sesión (0 € o prorrateado) es la decisión P5 del cruce, y
  es FISCAL: la responde la asesoría, se documenta como ADR con la respuesta escrita, y hasta
  entonces el bloque la deja parametrizada, no clavada.**
- **NO se toca el camino de cobro a Holded**: GET-back, tolerancia 5 cts, `/pay` idempotente (ADR-010).
- **NO se toca el anti-solape** (GiST). El saldo entra **dentro** de la misma transacción del hold, no
  al lado.
- **Nada de saldo en el cliente.** El decremento es server-side y condicionado; el front nunca calcula
  el saldo resultante por su cuenta para escribirlo.
- Gate por `bonosEnabled` (ruta y UI), independiente de `agendaEnabled`. Multi-tenant por fila.
  Migración aditiva.
- **No commit en el worktree principal.** `git worktree list` antes de la primera línea. No push.

## Entregables

- Migración aditiva: `vouchers`, `voucher_movements`, FK de `appointments.voucher_id`,
  `Tenant.bonosEnabled`.
- `resolveSession()` con sus cuatro ramas de fallo y su mensaje legible.
- El hold transaccional con consumo, y el movimiento contrario al anular.
- API: `GET /clients/:id/vouchers` **relleno de verdad** (mismo contrato que ya publica, ahora con
  datos), alta de voucher desde la venta, canje, prórroga auditada.
- Front: ficha con saldo y traza, consumo en el alta de cita, distintivo en la rejilla.
- **Tests**, y el nº 1 es innegociable:
  - **Invariante 9**: consumir sesión y crear cita son atómicos. **Dos tests**: el GiST rechaza →
    el saldo **no** baja; el saldo está a 0 → la cita **no** nace.
  - Carrera sobre la última sesión: uno gana, el otro `409 NO_BALANCE`.
  - Anular devuelve la sesión; no-show no la devuelve (y es apagable).
  - `resolveSession` ambigua **falla con mensaje**, no elige.
  - Bono caducado no consume; la prórroga queda auditada.
  - Un tenant sin `bonosEnabled` no ve nada de esto.
- **Criterio de "funciona"**: una clienta compra un programa de 10 sesiones (se cobra por el camino
  existente y queda el voucher con `soldTicketId`); el cajero le reserva una sesión y **en la misma
  transacción** el saldo baja a 9 y queda el movimiento con el `appointmentId`; anular esa cita lo
  devuelve a 10; con el saldo a 0 la reserva se rechaza **sin crear la cita**; y en la ficha se ve qué
  cita gastó qué sesión.
- **Tabla sabotaje → test rojo** en el cierre: en particular, romper la atomicidad a mano (sacar el
  decremento de la transacción) tiene que poner **rojo** un test concreto.
- `docs/blocks/B-reservas-8-done.md` con la plantilla de la metodología.

## Fuera de alcance (explícito)

- **Las reglas de yield** — **B-reservas-6**. Un bono no salta una política; si la franja está
  protegida, lo está también para una sesión de programa.
- **La ventana reservable, el horario del centro y los festivos** — **B-reservas-7**.
- **El panel de salud**, incluida la tarjeta «programas con saldo vivo y sin próxima cita» —
  **B-reservas-9**. Aquí se deja la **consulta** disponible; la pantalla la pinta B-9.
- **Venta online de bonos** — va con la reserva online (**B-reservas-11**).
- **Tarjetas regalo al portador** (`type=AMOUNT` sin cliente hasta el canje): el modelo las contempla,
  este bloque implementa **SESSIONS**. `AMOUNT` se declara deuda y se anota.
- **Campañas, avisos de caducidad y marketing** — fase 2. Aquí sólo el dato de caducidad.
- Cualquier cosa de Koibox, incluida la importación de bonos existentes — **B-reservas-10**.

---

*Lanzar como los bloques previos: implementar respetando alcance/restricciones/fuera-de-alcance,
escribir el `-done.md`, no commit/push. Commit selectivo después (stage → revisar → commit), NUNCA
`git add -A`.*
