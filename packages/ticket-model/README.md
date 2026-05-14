# @mipiacetpv/ticket-model

Modelo abstracto de ticket compartido por todos los renderers
(`ticket-pdf` hoy, futuros `ticket-escpos`/`ticket-html` mañana).

Sin dependencias externas salvo `zod` para validar el documento antes
de renderizar.

## Uso

```ts
import { buildTicketDocument } from "@mipiacetpv/ticket-model";

const doc = buildTicketDocument({
  tenant,    // del schema Prisma
  store,     // del schema Prisma
  register,  // del schema Prisma
  cashier,   // { email, name? }
  ticket,    // del schema Prisma con lines + payments
  customer,  // { name?, taxId?, email? } | null
});
```

Devuelve un `TicketDocument` listo para alimentar `renderTicketPdf` o
cualquier otro renderer.
