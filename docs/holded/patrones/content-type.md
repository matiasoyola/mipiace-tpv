# Patrón · Content-Type mentiroso

Holded a veces declara `Content-Type` que no coincide con el cuerpo. Tres
sub-patrones conocidos: HTML cuando endpoint no existe, HTML cuando el
cuerpo es JSON válido, y `octet-stream` cuando el cuerpo es JSON con PDF
base64 dentro.

## Sub-patrón 1 — 200 + HTML para endpoint inexistente (spike §01.B)

```http
GET /invoicing/v1/warehouse
HTTP/1.1 200 OK
Content-Type: text/html

<!DOCTYPE html><html>...<title>404 · Holded</title>...
```

El endpoint **no existe**, pero Holded sirve la SPA con un `<title>`
genérico de 404 en lugar de un 404 JSON limpio.

**Mitigación (ya en `ApiKeyClient`):** validar Content-Type en cada
respuesta. Si 2xx pero CT no empieza por `application/json` → lanzar
`HoldedInvalidResponseError` con `{ method, url, status, contentType,
bodyPreview }`.

**Tratamiento del error:** NO reintentar. Es error de configuración del
cliente, no transitorio. Señal de que un endpoint cambió o nunca existió
con ese nombre.

## Sub-patrón 2 — text/html con cuerpo JSON válido

GET detalle de un salesreceipt (a veces):

```http
GET /invoicing/v1/documents/salesreceipt/65f0...
HTTP/1.1 200 OK
Content-Type: text/html

{"id":"65f0...","total":12.50,"products":[...]}
```

El cuerpo ES JSON perfectamente parseable, pero el CT lo niega. Bug
confirmado de Holded.

**Mitigación:** para endpoints conocidos por hacer esto, **bypassar** la
validación estricta del `ApiKeyClient` y usar `fetch` directo +
`JSON.parse` defensivo:

```ts
const res = await fetch(url, { headers: { key: apiKey } });
const text = await res.text();
try {
  return JSON.parse(text);
} catch {
  throw new HoldedInvalidResponseError({ url, status: res.status, bodyPreview: text.slice(0, 200) });
}
```

Lista de endpoints con bypass:
- `GET /invoicing/v1/documents/salesreceipt/:id`
- `GET /invoicing/v1/documents/salesreceipt/:id/pdf`

## Sub-patrón 3 — PDF como JSON con base64 (spike §06.B)

```http
GET /invoicing/v1/documents/salesreceipt/65f0.../pdf
HTTP/1.1 200 OK
Content-Type: application/octet-stream

{"status":1,"data":"JVBERi0xLjQKJ..."}
```

Pese al `application/octet-stream`, el cuerpo NO es PDF binario: es JSON
con `{ status, data: base64 }`.

**Tratamiento:**

```ts
const text = await res.text();
const { data } = JSON.parse(text);
const pdfBuffer = Buffer.from(data, 'base64');
```

Carryover impresoras Fase 1: `?fallback=pdf` temporal mantiene esta vía
para clientes cloud que no llegan a la LAN del TPV.

## Regla general

**No confíes nunca en el `Content-Type` de Holded.** Asume JSON por
defecto, parsea defensivo, valida shape después.

## Endpoint específicos con quirks de CT

| Endpoint | Quirk |
|---|---|
| `/invoicing/v1/<inexistente>` | 200 + HTML |
| `GET salesreceipt/:id` | text/html con JSON válido |
| `GET salesreceipt/:id/pdf` | octet-stream con JSON base64 |
| `GET products/{id}/image` | A revisar al implementar en cliente nuevo |

## Referencias

- [`docs/spike-holded.md`](../../spike-holded.md) §01.B, §05.C, §06.B.
- [endpoints/salesreceipt](../endpoints/salesreceipt.md)
- Carryovers v1.4 impresoras Fase 1.

Last-updated: 2026-06-03
