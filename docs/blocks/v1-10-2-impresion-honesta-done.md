# Bloque v1.10.2 · La impresión deja de mentir — DONE

**Rama:** `v1-10-2-impresion-honesta` (worktree `../mipiacetpv-v1-10-2-impresion`)
**Origen:** hallazgo en producción, Cafetería Sirope, Caja 1, 2026-08-20. Con **cero impresoras configuradas**, "Reimprimir ticket" sobre el #000014 respondió *«Enviado a impresora. La copia llevará marca COPIA.»*. No había impresora, no salió papel.
**Estado:** cerrado. `pnpm vitest run` (workspace) verde — **1124 passing + 3 skipped**, antes 1095. `tsc -b` limpio en `apps/api`, `apps/tpv-web`, `apps/admin` y `packages/escpos-builder`. Sin push, sin merge, sin deploy.

---

## La causa: un 202 leído como "ha salido papel"

El botón de reimprimir llamaba a `POST /tickets/:id/reprint`, que **no imprime**: crea un `PrintIntent(REPRINT)` en estado PENDING para que lo consuma el bridge B5. Ese bridge nunca se llegó a montar. El 202 significa "he apuntado la intención" y la pantalla lo traducía a "enviado a impresora" — sin mirar si la caja tiene impresora, sin transporte de por medio, sin nada que pudiera fallar.

La marca COPIA que el mensaje prometía tampoco existía en ESC/POS: sólo estaba en el renderer del PDF (`packages/ticket-pdf/src/render.ts:213`), otra pieza del mismo bridge que no llegó.

Y no era un fallo de una pantalla suelta: cada punto de impresión decidía por su cuenta si había impresora y cuándo pintar el éxito. Por eso el arreglo va en la capa.

---

## Resumen de números

- **Tests:** +29 — `print-job-honesty.test.ts` (21, nuevo), `print-failure-keeps-payment.test.tsx` (6, nuevo), `tickets-print.test.ts` (+2).
- **Ficheros nuevos:** `apps/tpv-web/src/platform/printer/printJob.ts`, `apps/tpv-web/src/platform/printer/telemetry.ts`.
- **Migración:** ninguna. **Endpoints nuevos:** ninguno (un query param aditivo).
- **`CheckoutPage.tsx`: NO tocado** (ver *Coordinación* al final).

---

## Frente 1 — El servicio de impresión (`platform/printer/printJob.ts`)

Punto único donde se resuelve toda impresión del TPV. **Contrato: ninguna función lanza.** Devuelven un `PrintOutcome` que la UI pinta tal cual.

```ts
type PrintOutcome =
  | { status: "printed"; printedAt: string; printerName: string }
  | { status: "no-printer"; message: string }
  | { status: "needs-pairing"; printerName: string; message: string }
  | { status: "failed"; code; message: string; printerName: string | null }
```

- `lookupPrinter(section)` → `configured` | `none` | **`unknown`**. Los dos últimos NO se colapsan a propósito: *"esta caja no tiene impresora"* es un hecho; *"no pude preguntarlo"* (PWA sin red) no lo es. Confundirlos volvería a producir un mensaje que afirma más de lo que se sabe.
- `printTicket({ticketId, operation, printer?, copy?})` — resuelve impresora si hace falta, comprueba soporte y emparejamiento USB, entrega el binario y **sólo devuelve `printed` cuando el transporte (USB) o el backend (WiFi) lo confirma**. El `printedAt` es el del transporte, no un `new Date()` optimista.
- `printUsbBytes(...)` — misma garantía para binarios ya construidos (justificantes de fiado).
- `describePrintFailure(err)` traduce el motivo a algo accionable detrás de una barra: `UNREACHABLE` → *"La impresora no responde. Comprueba que está encendida, con papel y conectada."* El 502 del canal WiFi arrastra el error real del socket (`ECONNREFUSED 192.168.1.50:9100`).
- El 409 `PRINTER_NOT_CONFIGURED` del backend WiFi se mapea a `no-printer`: para el cajero es el mismo hecho, no hay a dónde imprimir.

`lib/escposPrint.ts`: `printEscposUsb` devuelve el `PrintResult` del transporte en vez de `void` (ensancha el tipo, no rompe callers), `printTicketWifi` devuelve el `{ok, printedAt}` del backend en vez de descartarlo, y las tres funciones de ticket aceptan `{copy}`.

## Frente 2 — Los tres puntos de impresión

| Punto | Antes | Ahora |
|---|---|---|
| **Overlay tras el cobro** (`CheckoutPage.successOverlay.tsx`) | Sin impresora → botón oculto en silencio. Fallo → error, pero el modal **se autocerraba a los 4 s encima del aviso**. | Estado vacío explícito `print-no-printer`. El autocierre se pausa también sobre `error` y `no-printer`. El éxito se autolimpia a los 2 s; los fallos no. |
| **Reimpresión** (`TicketsHistoryPage.tsx`) | `/reprint` → 202 → *"Enviado a impresora"*. Siempre. | Hook `useReprint` compartido por el mini-botón de la lista y el detalle. Va por ESC/POS con `copy: true`. Tres estados visibles: `Imprimiendo…` / `Copia impresa (lleva la marca COPIA)` / `No se pudo imprimir: <motivo>` + **Reintentar**. |
| **Comanda a cocina** (`SalePage.tsx`) | El toast verde *"Comanda nº N enviada"* listaba **todas** las secciones, incluidas las que fallaron. | El toast sólo lista las secciones que la impresora **aceptó** (`s.ok`); si ninguna imprimió, no hay toast. El fallo abre banner con motivo por sección y **Reintentar**, y **no se autocierra** (los banners de operativa de mesa mantienen su autocierre de 7 s: `autoDismiss` por defecto `true`). El 409 `PRINTER_NOT_CONFIGURED_FOR_SECTION` tiene su propio título *"Sin impresora configurada"*. |

**Extra fuera de los tres puntos nombrados:** `DebtsScreen.tsx` (justificante de cobro de fiado) se comía la causa con un *"No se pudo imprimir el recibo."* a secas. Ahora pasa por `printUsbBytes`: motivo real, confirmación de impreso, y telemetría.

**Enlace a configurar:** el copy dice *"Se configura en el panel de administración → Impresoras"*, sin enlace. La gestión de impresoras vive en la app `admin` (`/admin/printers`), a la que el TPV no tiene ruta ni URL conocida — inventar un deep-link entraba en "rediseñar la configuración de impresoras", explícitamente fuera de alcance.

## Frente 3 — La marca COPIA existe de verdad

- `packages/escpos-builder/src/ticket.ts`: `isCopy?: boolean` en `TicketReceiptInput` → banner centrado y en negrita `*** COPIA - no fiscal ***` bajo la cabecera del comercio, antes del cuerpo. Va arriba para que se lea antes que el importe. Guión ASCII, no raya, por el code page PC850.
- `apps/api/src/tickets/print.ts`: query param aditivo `copy` (default `false`) en `POST /tickets/:id/print/escpos`. `ticketToEscposInput` gana un 4º parámetro `isCopy = false` — los callers y fixtures existentes no cambian.
- El original impreso tras el cobro **nunca** lleva la marca; la reimpresión siempre.

## Frente 4 — El dinero manda (ADR-010)

Regla que ya se cumplía y que ahora está fijada por escrito y por test. El mecanismo que la garantiza es estructural: **`printTicket` nunca lanza**, así que no existe excepción de impresión que pueda subir hasta el camino de cobro y abortarlo.

- `print-job-honesty.test.ts` barre cuatro formas de reventar el transporte (`PrinterError`, `ApiError`, `Error` pelado, y algo que no es `Error`) y comprueba que las cuatro resuelven a `failed` sin lanzar. Incluye también el fallo de la propia consulta de impresora.
- `print-failure-keeps-payment.test.tsx` monta el overlay con una impresora que falla y verifica que el ticket cobrado sigue en pantalla, que **ninguna** llamada toca `/void`, `/refund` ni `/checkout`, que no aparece "Enviado a impresora" en ninguna forma, y que el overlay **no se autocierra** encima del aviso (20 s de reloj falso).
- `tickets-print.test.ts` lo comprueba desde el backend: con el socket TCP reventado, el ticket sale de la impresión **byte a byte como entró** (`JSON.stringify` antes/después) y el 502 sólo escribe diagnóstico en el `PrinterConfig`.

## Frente 5 — Telemetría

No había **una sola** llamada a `captureException` en toda la carpeta `platform/printer/`. Ahora `telemetry.ts` reporta cada fallo con `printerOperation` (ticket / reprint / kitchen / credit-receipt / pair), `printerTransport` (usb / wifi), `printerErrorCode`, `ticketId`, `printerName` y `printerSection`.

Un único punto de reporte, en `printJob.ts`, que es donde todo intento se resuelve: si reportaran además los transportes tendríamos eventos duplicados por cada fallo. `reportPrinterFailure` no lanza — la telemetría no puede tumbar una impresión.

**No se reporta** cuando no hay impresora configurada: eso es configuración pendiente, no una avería, y llenaría Sentry de ruido de los pilotos sin impresora.

Para el canal WiFi el `printerErrorCode` que llega a Sentry es el slug del backend (`PRINT_FAILED`), más útil para agrupar que el genérico `BACKEND` que ve la UI.

---

## Criterio de "funciona"

| Escenario | Resultado |
|---|---|
| Caja sin impresora, pulsar imprimir | *"Esta caja no tiene impresora configurada."* — el botón ni se ofrece en el overlay |
| Impresora configurada pero apagada | *"No se pudo imprimir: La impresora no responde. Comprueba que está encendida, con papel y conectada."* + Reintentar |
| En ninguno de los dos | Aparece "Enviado a impresora" ✗ (cadena eliminada del código; sólo queda en comentarios que documentan el bug) |

## Decisiones y deuda

- **`POST /tickets/:id/reprint` queda sin usar por el TPV.** No se ha borrado: la ruta, el modelo `PrintIntent` y la marca COPIA del renderer de PDF son el diseño del bridge B5, que puede retomarse. La traza de auditoría no se pierde: `tickets.print.escpos` ya loguea `tenantId`, `registerId`, `ticketId` y `target`. **Si B5 nunca se monta, el candidato a limpieza es esa ruta + las filas PENDING acumuladas.**
- **Sin cola de reintentos persistente** (fuera de alcance explícito). El reintento es un botón que el cajero pulsa.
- `WifiBackendTransport.isPaired()` sigue devolviendo `true` incondicionalmente: la config vive server-side y el 409/502 del backend es quien responde. No se tocó (regresión cero) y ahora esos códigos se traducen bien.
- El caso `lookup unknown` (PWA sin red al montar el overlay) no ofrece el botón de imprimir. Es deliberado: sin poder consultar, no se afirma ni que hay impresora ni que no la hay, y el flujo digital (QR/email) sí está disponible.

## Coordinación con v1.10.3 (cobro mixto)

**`apps/tpv-web/src/pages/CheckoutPage.tsx` no se ha tocado en absoluto.** Todo el trabajo quedó en `platform/printer/*`, `lib/escposPrint.ts` y `CheckoutPage.successOverlay.tsx` (fichero aparte). El bloque de cobro mixto puede entrar en `CheckoutPage.tsx` sin conflicto.

Ficheros compartidos con posible roce menor: `SalePage.tsx` (sólo `sendToKitchen` y `KitchenErrorBanner`, lejos del carrito y del checkout) y `TicketsHistoryPage.tsx`.

## Ficheros tocados

```
NUEVO  apps/tpv-web/src/platform/printer/printJob.ts
NUEVO  apps/tpv-web/src/platform/printer/telemetry.ts
NUEVO  apps/tpv-web/test/print-job-honesty.test.ts
NUEVO  apps/tpv-web/test/print-failure-keeps-payment.test.tsx
       apps/tpv-web/src/lib/escposPrint.ts
       apps/tpv-web/src/pages/CheckoutPage.successOverlay.tsx
       apps/tpv-web/src/pages/TicketsHistoryPage.tsx
       apps/tpv-web/src/pages/SalePage.tsx
       apps/tpv-web/src/pages/DebtsScreen.tsx
       apps/api/src/tickets/print.ts
       apps/api/test/tickets-print.test.ts
       packages/escpos-builder/src/ticket.ts
```
