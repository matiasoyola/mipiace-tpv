# Bloque v1.11 · Cierre de día automático

> **Hallazgo que origina el bloque (BD de producción, 2026-08-20).** Los quince últimos turnos de Peluquería Sole
> se cierran **entre 1 y 4 segundos antes** de abrirse el siguiente. Los quince, sin excepción. No hay auto-cierre
> en el código: `POST /shift/open` devuelve `409 SHIFT_ALREADY_OPEN` — *"Hay un turno abierto. Reanúdalo o ciérralo
> antes de abrir uno nuevo."* Es decir, **Sole nunca cierra el turno**: llega por la mañana, intenta abrir, se
> encuentra un muro, y hace el arqueo de ayer de pie, con la tabla de denominaciones, antes de su primera clienta.
> Dos meses así. Los turnos duran 24 h, 70 h en fin de semana, 288 h en vacaciones. El informe Z que sale de ahí no
> vale como control de caja, y como primera interacción del día es un peaje.
>
> **Decisión de producto (Matías, 2026-08-20):** en un negocio pequeño el cierre del día tiene que ser lo más
> automático del mundo — resumen de ventas, desglose de efectivo y tarjeta, y pedir confirmación sin más.

## Contexto (leer antes)

- Memoria del proyecto: `sole-nunca-cierra-turno` (el hallazgo completo con los datos).
- Memoria: **`marco-legal-fiscal`** — mipiacetpv **no** es sistema fiscal Verifactu, Holded sí. El informe Z de
  aquí es una herramienta de gestión, **no** una obligación legal. Eso es lo que permite rediseñarlo.
- `apps/api/src/shift/routes.ts` — apertura (el 409), cierre, generación del Z.
- `apps/api/src/shift/z-breakdown.ts` — **ya calcula el desglose por método** (bruto, devoluciones, neto por
  CASH/CARD/BIZUM/VOUCHER/OTHER, y el teórico de caja = fondo + neto CASH). El resumen que hay que enseñar ya
  existe; hoy se entierra detrás del arqueo.
- `apps/api/src/shift/cash-count.ts` — la tabla de 15 denominaciones. Es lo que se vuelve opcional.
- `apps/tpv-web/src/pages/ShiftOpenScreen.tsx`, `CloseShiftModal.tsx`, `ShiftActiveScreen.tsx`.
- `apps/tpv-web/src/lib/offlineShift.ts` — v1.10 hizo que abrir y cerrar turno funcionen sin red. **Cualquier cosa
  que se automatice server-side tiene que convivir con un terminal offline a media jornada.**

## Alcance

### 1. El turno deja de ser un muro (lo urgente, y lo barato)

Hoy el `409` es un portazo. Pasa a ser una pantalla con **"Reanudar turno" como acción primaria** y "Cerrar el día
de ayer y abrir uno nuevo" como secundaria. El cajero puede vender **antes** de arquear, siempre.

Esto solo ya devuelve a Sole su primera clienta. Si el bloque se parte por tiempo, esta parte va primera.

### 2. Cierre automático por corte de día

Job repeatable (la infra BullMQ ya existe, la usa el TTL de holds de la agenda) que a una hora de corte
configurable por tenant —`Tenant.dayCutHour`, default **05:00** local— cierra los turnos abiertos y genera su Z
con los datos del server.

- **Corte local, no UTC** (Europe/Madrid; la conversión ya está resuelta en `agenda/time.ts`, reutilízala).
- Un turno cerrado por el corte se marca como tal (`closedBy: AUTO_DAY_CUT` o equivalente) para que el resumen
  pueda decir la verdad y para no confundir reporting.
- **Terminal offline**: si el terminal está sin red a la hora del corte, el server cierra su turno igual; al
  reconectar, el terminal **no puede** perder ventas ni duplicar el cierre. Los tickets pendientes del outbox se
  imputan al turno que les corresponde por su timestamp, no al turno abierto en ese momento. Esto es lo delicado
  del bloque: si no lo tienes claro, páralo y pregunta antes de improvisarlo.

### 3. Resumen del día, no arqueo a ciegas

Al abrir por la mañana (o al pedirlo desde el menú), el cajero ve **una tarjeta de resumen del día cerrado**:

- Total de ventas y nº de tickets.
- **Desglose por método**: efectivo y tarjeta arriba y en grande; el resto debajo.
- Efectivo teórico en el cajón = fondo inicial + neto en efectivo (ya lo calcula `z-breakdown`).
- Un único botón: **"Confirmar"**. Nada más.
- Enlace discreto "Cuadrar caja" para quien quiera contar: abre la tabla de denominaciones de siempre, con el
  teórico delante, y registra la diferencia. **Opcional, nunca bloqueante.**

Las cifras son **trazables** (principio UX de auditabilidad): cada importe del resumen se puede abrir al detalle
que lo produce.

### 4. El arqueo obligatorio pasa a ser una opción del negocio

Nuevo flag `Tenant.requireCashCountOnClose`, **default `false`**. Los negocios que quieran el arqueo ciego lo
activan; el default es el comportamiento nuevo. Convive con `requireOwnerPinForCashClose`, que ya existe.

### 5. ADR

Mini-ADR en `docs/04-stack-y-decisiones.md` (o la serie que corresponda) recogiendo: contexto (el dato de los 15
turnos), decisión, alternativas descartadas (dejarlo como está; obligar al cierre con recordatorio), y
consecuencias — incluida la condición para revisarla: **que un cliente pida cuadrar caja a diario**.

## Restricciones

- **No inventar lógica fiscal.** El Z es gestión, no Verifactu. Holded es el sistema fiscal.
- No romper el offline de v1.10. Si el diseño exige que el terminal esté online para cerrar, el diseño está mal.
- No tocar el camino de cobro (ADR-010).
- Migración aditiva, multi-tenant por fila, flags con default que **preserva** el comportamiento de quien no
  quiera cambiar — salvo `requireCashCountOnClose`, cuyo default es a propósito el comportamiento nuevo.
- **Worktree propio** (`../mipiacetpv-v1-11-cierre`), verificado con `git worktree list` antes de empezar.
  **Devuelve el hash del commit** al cerrar. No push.

## Entregables

- Migración Prisma (`dayCutHour`, `requireCashCountOnClose`, marca de cierre automático).
- Job de corte + tests de la conversión de hora local y del caso offline.
- Pantalla de reanudar/cerrar y tarjeta de resumen del día.
- Mini-ADR.
- `docs/blocks/v1-11-cierre-de-dia-done.md`.
- **Criterio de "funciona"**: con un turno abierto de ayer, el cajero entra y **puede vender sin arquear**; a la
  hora de corte el turno de ayer aparece cerrado solo, con su Z; el resumen cuadra con la BD; y contar el efectivo
  sigue siendo posible para quien quiera, sin ser requisito.

## Fuera de alcance (explícito)

- Cita→caja y todo lo de la serie R (va en `bloque-reservas-5-cita-caja.md`).
- Informes multi-día, comparativas y cualquier cosa que huela a dashboard.
- Cambiar el modelo de turnos a "jornada" o a multi-cajero. Sigue siendo un turno por caja.
- Notificaciones o email del resumen diario.

## Bucle visual (obligatorio antes de cerrar)

Screenshots con Playwright de la pantalla de reanudar y de la tarjeta de resumen: móvil 320 px, móvil 390 px,
escritorio, un estado de error y la pantalla final. Importes con `tabular-nums`, tap targets ≥ 44 px. Recuerda para
quién es: alguien de pie, a las diez de la mañana, con la primera clienta esperando.
