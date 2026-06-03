# Endpoint · `salesreceipt`

Tickets de venta (recibo de venta). Es el endpoint núcleo del TPV: cada venta
que cobramos en mipiacetpv termina como un `salesreceipt` en Holded. Es
también el endpoint con más sorpresas: silent rejects, content-type
inconsistente y dos formas distintas de referenciar items (PRODUCT vs
SERVICE). Todo lo descubierto aquí está validado contra cuenta de pruebas
en el spike Fase 0 y reforzado por hotfixes 8, 9 y 10.

## Qué documentado vs qué real

| Aspecto | Docs oficial | Realidad |
|---|---|---|
| Crear → devuelve `id` | Sí | Sí, pero puede salir con `total=0` (silent reject) |
| `approveDoc` opcional | "Por defecto false" | Si no lo pasas a `true`, el doc nace sin `docNumber` y queda inservible |
| Items con `sku` | Documentado para products | NO sirve para servicios — hay que usar `serviceId` |
| `Idempotency-Key` header | No mencionado | Ignorado. Hay que meter UUID en `notes` |
| `GET ?starttmp/endtmp` | "Filtros opcionales" | Falla en silencio si pasas sólo uno |
| GET detalle Content-Type | `application/json` | A veces `text/html` con cuerpo JSON válido |
| GET PDF | "binary PDF" | JSON `{status, data: base64}` con CT mentiroso |

## POST `/invoicing/v1/documents/salesreceipt`

### Payload mínimo definitivo (spike §05.A)

```json
{
  "contactId": "<MongoId del cliente>",
  "approveDoc": true,
  "date": 1717420800,
  "items": [
    {
      "name": "Café con leche",
      "units": 1,
      "price": 1.80,
      "tax": 21,
      "sku": "BEB-CAF-001"
    },
    {
      "name": "Servicio de catering 4h",
      "units": 1,
      "price": 250.00,
      "tax": 21,
      "serviceId": "65f0ab12cd3456ef78901234"
    }
  ],
  "notes": "TPV-uuid: 7c9a4f8d-1e2b-4f3a-9c0d-5b6e8f9a0b1c"
}
```

### Reglas clave

- **`approveDoc: true` es obligatorio.** Sin él, el doc nace sin
  `docNumber` y queda fuera del flujo normal de facturación. No hay
  reaprobación posterior cómoda desde API.
- **PRODUCT vs SERVICE — campos excluyentes** (hotfix8):
  - PRODUCT → `sku` canónico (cadena, ej. `"BEB-CAF-001"`).
  - SERVICE → `serviceId` con el MongoId del servicio en Holded.
  - Mandar `sku` en una línea de servicio causa silent reject: Holded
    acepta el POST pero el item sale con `price=0` y `sku=0`.
  - Mandar `serviceId` en una línea de producto: Holded ignora el campo
    y el item queda sin referencia válida → `sku=0` también.
- **Campos por item:** `name`, `units`, `price`, `tax`, `discount?`,
  `sku?` (productos) o `serviceId?` (servicios), `desc?`.
- **`notes`** lleva el patrón `TPV-uuid: <externalId>` para idempotencia
  (ver [patrones/idempotencia](../patrones/idempotencia.md)).
- **`numSerieId`** opcional. Si se omite, Holded usa la serie default
  del tenant.

### Silent reject pattern

Respuesta del POST:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{ "status": 1, "id": "65f0ff00aa11bb22cc33dd44" }
```

GET-back inmediato del documento creado:

```json
{
  "id": "65f0ff00aa11bb22cc33dd44",
  "docNumber": "SR-2026-00042",
  "total": 0,
  "subtotal": 0,
  "products": [
    { "name": "Servicio de catering 4h", "price": 0, "sku": "0", "units": 1 }
  ]
}
```

Lo que el cliente debe hacer:

1. Tras POST, hacer **GET-back** del documento.
2. Validar invariantes: `total ≈ expectedTotal` con tolerancia
   `TOTAL_TOLERANCE_EUR` (ver [patrones/tolerancias](../patrones/tolerancias.md)).
3. Si falla → lanzar `HoldedSilentRejectError` con detalle, marcar ticket
   `SYNC_FAILED` y dejar al worker reintentar.

## GET `/invoicing/v1/documents/salesreceipt`

### Filtros temporales — requieren AMBOS extremos

```
GET /invoicing/v1/documents/salesreceipt?starttmp=1717200000&endtmp=1717286400
```

Si pasas sólo `starttmp` o sólo `endtmp`, la respuesta es vacía/silenciosa
en lugar de error explícito (spike §05.D). Nuestro cliente fuerza pasar
los dos siempre.

### Paginación

Ver [patrones/paginacion](../patrones/paginacion.md).

## GET `/invoicing/v1/documents/salesreceipt/:id`

- Puede devolver `Content-Type: text/html` aunque el cuerpo es JSON
  perfectamente parseable (bug Holded — spike §05.C).
- Nuestro `ApiKeyClient` valida CT estricto y lanzaría
  `HoldedInvalidResponseError`. Para este endpoint usamos `fetch` directo
  con bypass del cliente (ver [patrones/content-type](../patrones/content-type.md)).

## GET `/invoicing/v1/documents/salesreceipt/:id/pdf`

(spike §06.B)

```http
HTTP/1.1 200 OK
Content-Type: application/octet-stream

{ "status": 1, "data": "JVBERi0xLjQKJ..." }
```

- El cuerpo NO es un PDF binario: es JSON con `{status, data: base64}`.
- El Content-Type es mentiroso (a veces `application/octet-stream`, a
  veces `text/html`).
- Hay que: parsear JSON → `Buffer.from(data, 'base64')` → ese es el PDF
  real.
- Hotfix de impresoras Fase 1 mantiene `?fallback=pdf` temporal porque
  algunos clientes cloud no llegan a la LAN del TPV (ver carryovers
  v1.4 impresoras).

## Referencias

- [`docs/spike-holded.md`](../../spike-holded.md) §05.A, §05.C, §05.D, §06.B
- Hotfix 8 (PRODUCT vs SERVICE).
- Hotfix 9 (tolerancia 5 céntimos).
- Hotfix 10 (pre-check idempotencia en pay — ver
  [endpoints/pay](pay.md)).
- [patrones/silent-reject](../patrones/silent-reject.md)
- [patrones/idempotencia](../patrones/idempotencia.md)

Last-updated: 2026-06-03
