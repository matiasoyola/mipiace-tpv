# Bloque auditoria-sirope · lo que se hizo con los 29

Rama `auditoria-sirope` desde `master` (`9523a6f`). Los 29 hallazgos de
`docs/qa/2026-10-18-sirope-auditoria.md`, en el orden del prompt.

---

## A · Lo que frena a Sirope

### #17 🔴 Devoluciones imposibles en cuentas sin Holded y en ensayo

**Qué pasaba.** La pregunta «¿se puede devolver este ticket?» se contestaba en
dos sitios con dos respuestas distintas. El servidor aceptaba `SYNCED`, `PAID`
y `TEST`; el TPV sólo pintaba el botón con `SYNCED`, o con `TEST` más el modo
prueba antiguo del cajero técnico. Las dos formas de cobrar que tiene una
cuenta de hoy caían en el hueco: sin Holded el ticket nace `PAID` y no pasa
nunca por `SYNCED`, y en ensayo nace `TEST` sin que haya ninguna sesión
técnica detrás. El servidor habría devuelto el dinero en los dos casos; no
había forma de pedírselo. (Captura 31.)

**Qué se hizo.**

- `packages/ticket-model/src/devolucion.ts` (nuevo): `esDevolvible`,
  `motivoNoDevolvible` y `mensajeNoDevolvible`. El contexto son dos señales
  que ya existían — la cuenta en ensayo (`facturaDesde == null`) y la sesión
  de prueba. Vive en `ticket-model` porque el TPV, la API y el panel ya
  dependen de ese paquete.
- `apps/api/src/tickets/routes.ts`: la ruta de refund llama a la regla. El
  `select` del tenant añade `facturaDesde`.
- `apps/tpv-web/src/pages/TicketsHistoryPage.tsx`: el botón lo decide la misma
  función. Cuando dice que no, **se dice**: el motivo queda escrito en la
  ficha en vez de desaparecer el botón sin explicación.
- El 409 ya no dice «sincronizado con Holded» a un comercio que no usa Holded.

**Decisión tomada sin preguntar.** `PENDING_SYNC` sigue sin ser devolvible: es
lo que el servidor rechazaba antes del bloque, dura segundos y la devolución
se calcula sobre un documento de Holded que todavía no existe. Ampliar eso no
era parte del hallazgo.

**Tests.** `packages/ticket-model/test/devolucion.test.ts`,
`apps/api/test/devolucion-sirope.test.ts`,
`apps/tpv-web/test/devolucion-sirope.test.tsx`.

### #25 🔴 En venta rápida, «Enviar» no mandaba nada a cocina

**Qué pasaba.** `SalePage.sendToKitchen` empezaba con
`if (!tableContext?.activeTicketId) return;`. Sin mesa el envío terminaba en
seco y el botón seguía encendido, sin aviso. Sirope trabaja casi todo en
mostrador: lo que se pedía en la barra no llegaba nunca a la cocina.
(Capturas 76, 77.)

La causa de fondo es que una venta rápida **no existe en el servidor** hasta
que se cobra, y la comanda se manda sobre un ticket.

**Qué se hizo.**

- `POST /mostrador/draft` (`apps/api/src/tickets/mostrador.ts`, nuevo): crea el
  DRAFT de la venta rápida con sus líneas. A partir de ahí la venta de
  mostrador es un borrador como el de una mesa — mismas rutas de línea y cobro
  por `/tickets/:id/checkout`, que es lo que hace que cobrar CIERRE la comanda
  en vez de dejarla viva (#22).
- `Ticket.counterNumber` (migración `20261018100000_mostrador_a_cocina`):
  correlativo **por día y por caja**. La tarjeta de la pantalla se titula
  «Mostrador nº 3» en lugar de «#1». El título lo escribe una sola función
  (`apps/api/src/kitchen/titulo.ts`) para la tarjeta, el papel ESC/POS y el
  aviso de «listo para servir» del TPV.
- El TPV recuerda su venta de mostrador en `sessionStorage`
  (`apps/tpv-web/src/lib/mostrador.ts`): una recarga a media mañana no puede
  dejar un borrador abierto en el servidor y sin dueño en la pantalla.
- **Cobrar con líneas sin mandar**: en mostrador salen solas (se paga primero
  y se prepara después); en una mesa se pregunta, con tres salidas —«Enviar y
  cobrar», «Cobrar sin enviar», «Volver»— porque el Atrás del sistema no puede
  decidir ninguna de las dos. `ConfirmSheet` estrena esa tercera acción.
- **Nunca un botón mudo**: comanda vacía, cuenta sin Cocina encendida o
  borrador que no se puede crear dicen por qué en el banner.
- Vaciar una venta de mostrador con borrador lo **anula en el servidor**
  (`DELETE /tickets/:id`), no sólo en pantalla.

**Decisiones tomadas sin preguntar.**

- El número es por CAJA y no por tienda: dos barras del mismo local cantan «el
  3» cada una con el suyo.
- `MAX + 1` y no `COUNT + 1`: un borrador anulado deja su número gastado en
  vez de repetirlo en la misma pantalla.
- El contexto de mostrador vive dentro de `SalePage` y no en `App`: subirlo
  obligaría a remontar la pantalla del carrito en mitad del gesto.
- Un precio cambiado con el lápiz (`unitPriceOverride`, que sólo existe en
  venta rápida) viaja como `unitPrice` del borrador: el mostrador tiene que
  cobrar lo mismo que cobraba el carrito.

**Tests.** `apps/tpv-web/test/mostrador-a-cocina.test.tsx`,
`apps/api/test/mostrador-a-cocina.test.ts`.

