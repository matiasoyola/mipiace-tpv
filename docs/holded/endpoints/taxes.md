# Endpoint · `taxes`

Catálogo de impuestos del tenant. Lista plana, no paginada (típicamente
<20 entradas). mipiacetpv los sincroniza al arranque del worker y los
aplica en `tax` de cada item de `salesreceipt`.

## Qué documentado vs qué real

| Aspecto | Docs oficial | Realidad |
|---|---|---|
| Paginación | No mencionada | NO paginado, devuelve todo en una llamada |
| `value` | "Porcentaje" | Entero (21 = 21%), no decimal (0.21) |
| `name` | "Etiqueta libre" | Sigue convenios `s_iva_21`, `s_iva_10`, etc. para España |

## GET `/invoicing/v1/taxes`

```
GET /invoicing/v1/taxes
```

Respuesta:

```json
[
  { "id": "65a0...", "name": "s_iva_21", "value": 21 },
  { "id": "65a1...", "name": "s_iva_10", "value": 10 },
  { "id": "65a2...", "name": "s_iva_4",  "value": 4  },
  { "id": "65a3...", "name": "s_iva_0",  "value": 0  }
]
```

- **`value` es entero** (21 ≠ 0.21). En items de salesreceipt se manda
  igual: `"tax": 21`.
- **`name`** sigue convenio `s_iva_<pct>` para España. Otros tenants
  pueden tener otros patrones.
- **`id`** es MongoId pero **no se usa en items de salesreceipt** —
  ahí va el `value` directamente, no el `id`.

## Uso en mipiacetpv

```ts
// En el worker:
const taxes = await client.getTaxes();
const taxByPct = new Map(taxes.map(t => [t.value, t]));

// Al armar item:
const item = {
  name: product.name,
  price: product.price,
  units: 1,
  tax: product.taxPct,  // ej. 21 — el value, no el id
  sku: product.sku,
};
```

## Referencias

- `docs/03-integracion-holded.md` (especificación funcional).
- [endpoints/salesreceipt](salesreceipt.md) — uso del campo `tax` en items.

Last-updated: 2026-06-03
