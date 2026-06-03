# Endpoint · `services`

Catálogo de servicios del tenant. En el modelo de Holded, "servicio" es un
item facturable sin stock ni SKU canónico (consultoría, mano de obra,
catering, etc.). Para mipiacetpv los servicios se sincronizan junto con
los productos pero se referencian DISTINTO al meterlos en un
`salesreceipt`: por `serviceId`, no por `sku`. Esa distinción es la causa
raíz del silent reject de "ticket a 0€" que motivó el hotfix 8.

## Qué documentado vs qué real

| Aspecto | Docs oficial | Realidad |
|---|---|---|
| `sku` en service | No mencionado | No existe campo `sku` real, sólo `id` + opcional `code` |
| `forSale` flag | "Marca disponibilidad para venta" | Para servicios es flag del TPV propio de Holded, irrelevante para nosotros |
| Paginación | `?page=N` | Igual que products — sin total_count |
| POST/PUT | Documentado | No implementado en nuestro cliente todavía |

## GET `/invoicing/v1/services`

```
GET /invoicing/v1/services?page=1
GET /invoicing/v1/services?page=2
...
```

Patrón estándar de paginación (ver
[patrones/paginacion](../patrones/paginacion.md)). Fin por array vacío.

### Forma de un service

```json
{
  "id": "65f0ab12cd3456ef78901234",
  "name": "Servicio de catering 4h",
  "code": "CAT-4H",
  "price": 250.00,
  "tax": 21,
  "desc": "Catering para evento de 4 horas",
  "forSale": true
}
```

- **`id`** — MongoId. Es la única forma de referenciar el servicio en
  documentos.
- **`code`** — opcional, lo asigna el tenant. NO es un SKU canónico, es
  un identificador libre.
- **`forSale`** — se ignora para servicios en mipiacetpv (hotfix3).
  Razón: es flag del TPV propio de Holded, irrelevante para nuestra
  lógica de disponibilidad.

## Referenciar un service en un salesreceipt

Esto es lo que más cuesta entender al principio:

```json
{
  "items": [
    {
      "name": "Servicio de catering 4h",
      "units": 1,
      "price": 250.00,
      "tax": 21,
      "serviceId": "65f0ab12cd3456ef78901234"
    }
  ]
}
```

- Usar `serviceId` (no `sku`).
- Si te equivocas y mandas `sku` aquí → silent reject, el item nace a
  precio 0 y SKU "0".
- Ver [endpoints/salesreceipt](salesreceipt.md) sección "PRODUCT vs
  SERVICE" para detalle del hotfix 8.

## POST / PUT `/invoicing/v1/services` y `/invoicing/v1/services/{id}`

**No implementados en nuestro cliente todavía.** Pendiente documentar
shape exacto si se necesita en evolutivos. Hipótesis:

```json
{
  "name": "Servicio nuevo",
  "price": 50.00,
  "tax": 21,
  "desc": "Descripción",
  "code": "NEW-SVC"
}
```

A validar contra cuenta de pruebas cuando se aborde la creación de
servicios desde mipiacetpv.

## Referencias

- Hotfix 3 (ignorar `forSale` para servicios).
- Hotfix 8 (PRODUCT vs SERVICE en items de salesreceipt).
- [endpoints/salesreceipt](salesreceipt.md)
- [patrones/silent-reject](../patrones/silent-reject.md)

Last-updated: 2026-06-03
