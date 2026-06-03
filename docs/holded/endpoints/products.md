# Endpoint · `products`

Catálogo de productos del tenant — items facturables CON stock, SKU
canónico e imagen opcional. Es el otro polo de la distinción PRODUCT vs
SERVICE (ver [endpoints/services](services.md)). Para mipiacetpv los
productos se sincronizan con `runAutoSku` que asegura que todos tengan SKU
asignado, y se referencian por `sku` en los items de `salesreceipt`.

## Qué documentado vs qué real

| Aspecto | Docs oficial | Realidad |
|---|---|---|
| `sku` | "Identificador opcional" | Para mipiacetpv es obligatorio; `runAutoSku` lo asegura |
| `forSale` | "Marca disponibilidad para venta" | Para productos sí lo respetamos: filtramos `forSale=false` del TPV |
| Imagen en `/products` lista | "Incluida si existe" | NO viene `imageUrl`; hay que pegar a `/products/{id}/image` separado |
| `PUT` con `sku` | Documentado | Funciona; lo usamos en `runAutoSku` |

## GET `/invoicing/v1/products`

```
GET /invoicing/v1/products?page=1
GET /invoicing/v1/products?page=2
...
```

Paginación estándar (ver
[patrones/paginacion](../patrones/paginacion.md)).

### Forma de un product

```json
{
  "id": "65a1b2c3d4e5f67890123456",
  "name": "Café con leche",
  "sku": "BEB-CAF-001",
  "price": 1.80,
  "tax": 21,
  "stock": 0,
  "forSale": true,
  "desc": "Café con leche taza grande"
}
```

- **`sku`** — canónico, asignable. Es la referencia que se mete en items
  de `salesreceipt`.
- **`forSale`** — aquí SÍ indica "disponible para venta", y mipiacetpv
  lo respeta filtrando los `forSale=false` del catálogo del TPV.
- **`stock`** — en mipiacetpv el stock se gestiona en almacén local, no
  en Holded (ver `docs/03-integracion-holded.md` para detalle).

### `runAutoSku`

Job que recorre todos los productos sin `sku` y les asigna uno generado
(`AUTO-<MongoId-corto>`). Razón: nuestro cliente exige SKU para
referenciar el producto en items de salesreceipt — si llegara un producto
sin SKU, los tickets que lo incluyan caerían en silent reject.

## PUT `/invoicing/v1/products/{id}`

```json
{
  "sku": "BEB-CAF-001",
  "name": "Café con leche",
  "price": 1.80
}
```

- Se usa para asignar `sku` en `runAutoSku`.
- **PUT silencioso** (rareza Holded confirmada): devuelve 200 OK sin
  cuerpo informativo aunque el campo no se haya aplicado. Hacer GET-back
  para confirmar.

## Imágenes — endpoint separado

El listado `GET /invoicing/v1/products` **no** incluye `imageUrl`.

```
GET /invoicing/v1/products/{id}/image
```

Devuelve la imagen binaria (con sus propios quirks de Content-Type;
revisar al implementar en un cliente nuevo). El worker
`image-cache-worker` de mipiacetpv lo consume.

Carryovers de B-ProductImages:
- Spike §13 contra cuenta piloto antes de habilitar live.
- Header `key:` sólo va a `*.holded.com`; al servir desde Cloudflare/R2
  no se reenvía.
- Volumen Docker del cache se puebla progresivamente, no en bulk.

## "404 sobre PUT /products/{id}" — pista

Si el cliente recibe 404 sobre un `PUT /products/{id}`, **es servicio,
no producto**. Hay que mandar a `/services/{id}`. Es el error más
frecuente en evolutivos que tocan el catálogo. Ver
[runbook](../runbook.md).

## Referencias

- `docs/03-integracion-holded.md` (especificación funcional).
- Carryovers B-ProductImages (volumen cache, header `key:`).
- [endpoints/services](services.md) — el otro polo de la distinción.
- [patrones/paginacion](../patrones/paginacion.md)

Last-updated: 2026-06-03
