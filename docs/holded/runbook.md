# Runbook · Errores comunes Holded

Catálogo de errores frecuentes vistos en producción y cuenta de pruebas,
con causa raíz y solución. Formato similar a `docs/errores/README.md`.
Para errores nuevos no listados aquí, ir al patrón correspondiente en
[patrones/](patrones/).

## "Documento creado a 0€" / "Ticket aparece a cero en Holded"

**Síntoma:** Tras una venta en TPV, el ticket aparece en Holded con
`total=0`, `subtotal=0` y los items con `price=0` y `sku=0`.

**Causa raíz:** Silent reject por línea de servicio con `sku` en lugar
de `serviceId`.

**Solución:**
1. Verificar en el item del salesreceipt si el catálogo lo trata como
   servicio (`/services`) o producto (`/products`).
2. Si es servicio → mandar `serviceId: <MongoId>`, no `sku`.
3. Si es producto → mandar `sku: <string>`, no `serviceId`.

Ver [endpoints/salesreceipt](endpoints/salesreceipt.md) "PRODUCT vs
SERVICE" y [patrones/silent-reject](patrones/silent-reject.md) caso 1.

## "Doble cobro tras reintento del worker"

**Síntoma:** Un ticket aparece pagado dos veces en Holded
(`paymentsPending < 0`).

**Causa raíz:** Falta el pre-check de idempotencia en `pay`. Un timeout
intermedio en el primer POST + retry del worker → segundo POST que
cobra de nuevo.

**Solución:**
1. Verificar que el cliente hace **GET-back** antes de POSTear pay.
2. Si `paymentsPending ≈ 0` con tolerancia 5 céntimos → skip.
3. Hotfix 10 cubre esto en mipiacetpv; si un cliente nuevo lo hereda,
   asegurarse de no haberlo perdido en el merge.

Ver [endpoints/pay](endpoints/pay.md) y
[patrones/idempotencia](patrones/idempotencia.md).

## "404 sobre PUT /products/{id}"

**Síntoma:** Al intentar actualizar un item del catálogo, Holded
responde 404.

**Causa raíz:** El item es servicio, no producto. Está en
`/invoicing/v1/services/{id}`, no en `/invoicing/v1/products/{id}`.

**Solución:**
1. Consultar el catálogo local para verificar tipo.
2. Rutar al endpoint correcto (`/services/{id}` o `/products/{id}`).

Ver [endpoints/products](endpoints/products.md) y
[endpoints/services](endpoints/services.md).

## "ECONNREFUSED al pegarle a Holded"

**Síntoma:** Worker recibe `ECONNREFUSED` o timeouts repetidos.

**Causa raíz:** Suele ser uno de:
- Rate limit transitorio (Holded no devuelve 429 limpio en todos los
  casos — a veces corta TCP).
- Caída temporal de su infraestructura.

**Solución:**
1. Retry exponencial (1s, 2s, 4s, 8s, 16s) con jitter.
2. Tras 5 reintentos → marcar `SYNC_FAILED` y dejar reintentar al
   siguiente tick del worker.
3. NO bloquear el TPV: el sync siempre es asíncrono.

## "HTTP 402 — Account has been blocked. Reason: Unpaid" (spike §01.A)

**Síntoma:** Toda llamada devuelve 402 con ese mensaje.

**Causa raíz:** La cuenta de Holded del cliente tiene cuotas impagadas.
**No** es problema de credenciales — la API Key es válida.

**Solución:**
1. El cliente HoldedClient debería tipar este caso como
   `HoldedSubscriptionSuspendedError` (recomendación Fase 1, pendiente de
   implementar).
2. UI admin: banner "Tu Holded está suspendido por impago" en lugar de
   toast genérico.
3. Worker: parar reintentos hasta que el propietario actúe — reintentar
   un 402 sólo gasta cuota.

## "HTTP 200 + HTML para un endpoint" (spike §01.B)

**Síntoma:** Llamada devuelve 200 OK pero con
`Content-Type: text/html` y cuerpo SPA de Holded.

**Causa raíz:** El endpoint no existe con ese nombre. Holded sirve la SPA
en lugar de un 404 JSON.

**Solución:**
1. `ApiKeyClient` ya valida CT y lanza
   `HoldedInvalidResponseError`.
2. Tratar como error de configuración, NO reintentar.
3. Revisar si el endpoint cambió de nombre o nunca existió.

Ver [patrones/content-type](patrones/content-type.md).

## "GET salesreceipt detalle parsea raro"

**Síntoma:** El cliente lanza `HoldedInvalidResponseError` al hacer GET
detalle de un salesreceipt, aunque el JSON sería válido.

**Causa raíz:** Bug Holded — devuelve `Content-Type: text/html` con cuerpo
JSON parseable.

**Solución:** Bypass del cliente estricto para ese endpoint, parsear
defensivo. Ver [patrones/content-type](patrones/content-type.md)
sub-patrón 2.

## "PDF descargado no abre"

**Síntoma:** Descargar `/salesreceipt/:id/pdf` produce un fichero que no
es PDF válido.

**Causa raíz:** El cuerpo no es binario PDF: es JSON
`{ status, data: base64 }`. Si lo guardas tal cual, no abre.

**Solución:**
```ts
const text = await res.text();
const { data } = JSON.parse(text);
fs.writeFileSync('out.pdf', Buffer.from(data, 'base64'));
```

Ver [patrones/content-type](patrones/content-type.md) sub-patrón 3.

## "Filtro temporal de documents devuelve vacío"

**Síntoma:** `GET /salesreceipt?starttmp=X` devuelve array vacío aunque
hay tickets en ese rango.

**Causa raíz:** Falta `endtmp`. El endpoint exige AMBOS extremos.

**Solución:** Pasar siempre `starttmp` Y `endtmp` juntos. Ver
[patrones/paginacion](patrones/paginacion.md).

## "Tras POST salesreceipt no aparece docNumber"

**Síntoma:** El doc nace sin `docNumber` y queda inservible.

**Causa raíz:** Falta `approveDoc: true` en el POST.

**Solución:** Forzar `approveDoc: true` siempre desde el cliente. Ver
[endpoints/salesreceipt](endpoints/salesreceipt.md).

## Referencias

- [`docs/errores/README.md`](../errores/) — runbook genérico del proyecto.
- [`docs/spike-holded.md`](../spike-holded.md) — hallazgos del spike Fase 0.

Last-updated: 2026-06-03
