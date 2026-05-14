# @mipiacetpv/ticket-pdf

Renderer PDF de tickets digitales. Toma un `TicketDocument` (del package
`@mipiacetpv/ticket-model`) y produce un `Uint8Array` con un PDF 80mm
de ancho y alto dinámico, listo para descargar, adjuntar a email o
embeber en pantalla.

## Diseño

- **Librería:** `pdf-lib` (ESM puro, sirve en Node y en browser).
- **Formato:** 80mm × alto dinámico, con margen 5mm. Fuente
  `Courier` embebida del PDF estándar (no necesita assets externos)
  para alineación tipo térmica.
- **QR opcional:** si pasas `qrPngBytes`, se dibuja en el pie como
  bloque cuadrado con el caption configurable.
- **Devoluciones:** misma plantilla con cabecera "DEVOLUCIÓN" y
  referencia al ticket original.

## Uso

```ts
import { renderTicketPdf } from "@mipiacetpv/ticket-pdf";

const bytes = await renderTicketPdf(document, {
  qrPngBytes: optionalQr,
  qrCaption: "Escanea para descargar tu ticket",
});
```

`bytes` es un `Uint8Array` que puede ir directo a `fetch` body, a
adjunto SMTP (Buffer.from), o convertirse en `Blob` en el browser.
