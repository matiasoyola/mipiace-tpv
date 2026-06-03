# Patrón · Paginación

Patrón uniforme `?page=N` en endpoints de listado. SIN metadata: ni
`total_count`, ni `next_page`, ni `Link` header. Detectar el fin por
array vacío. Caso especial: filtros temporales en documents requieren
AMBOS extremos.

## Patrón base

```
GET /invoicing/v1/products?page=1
GET /invoicing/v1/products?page=2
...
```

- `page` empieza en **1** (no en 0).
- Tamaño de página fijo por Holded (típicamente 100), NO configurable
  desde request.
- Respuesta: array directo de items, sin envoltorio con metadata.

## Detectar el fin

```ts
async function fetchAllPages(endpoint: string): Promise<Item[]> {
  const all: Item[] = [];
  let page = 1;
  while (true) {
    const items = await client.get(`${endpoint}?page=${page}`);
    if (items.length === 0) break;
    all.push(...items);
    page += 1;
  }
  return all;
}
```

- `items.length === 0` → fin.
- **No** asumir que página parcial implica fin: Holded podría devolver
  página con N<tamaño antes del final (raro, pero posible). Sólo el array
  vacío es señal definitiva.

## Endpoints que usan el patrón

| Endpoint | Notas |
|---|---|
| `/invoicing/v1/products` | Estándar |
| `/invoicing/v1/services` | Estándar |
| `/invoicing/v1/contacts` | Estándar |
| `/invoicing/v1/documents/salesreceipt` | Estándar + requiere starttmp/endtmp |

## Excepción · taxes

`GET /invoicing/v1/taxes` **NO** está paginado. Devuelve todo en una
llamada. Ver [endpoints/taxes](../endpoints/taxes.md).

## Caso especial · rango temporal en documents

```
GET /invoicing/v1/documents/salesreceipt?starttmp=1717200000&endtmp=1717286400&page=1
```

- **Ambos extremos son obligatorios** (`starttmp` y `endtmp`).
- Si pasas sólo uno → respuesta vacía o silenciosa, NO error explícito.
  Pierdes minutos depurando si no lo sabes.
- Combinable con `?page=N` para paginar dentro del rango.

## Política mipiacetpv

- Worker de sync: itera `fetchAllPages` con backoff entre páginas (~200ms)
  para no saturar cuota.
- Rango temporal: nunca mayor de 90 días en una llamada — Holded empieza
  a comportarse de forma errática con rangos muy amplios (no error
  explícito, sólo lentitud y resultados parciales).

## Tradeoff conocido

Sin `total_count`, no podemos mostrar barra de progreso real al sync.
Mostramos "Sincronizando página N..." y dejamos al usuario inferir.
Aceptable hasta ahora.

## Referencias

- [endpoints/products](../endpoints/products.md)
- [endpoints/services](../endpoints/services.md)
- [endpoints/salesreceipt](../endpoints/salesreceipt.md)

Last-updated: 2026-06-03
