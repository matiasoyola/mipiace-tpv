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

