# Super-mini-MVP · cómo arrancarlo en local

> Este MVP es **descartable**. Backend escrito lo más sencillo posible para
> validar el camino crítico end-to-end (TPV → Holded) en local. Pedro
> reescribirá el backend a su gusto cuando se incorpore. El frontend sí
> debe quedar usable como base.

## Qué hace

Una pantalla con grid de productos a la izquierda y carrito a la derecha.
Botón "Cobrar efectivo" → crea un `salesreceipt` aprobado en Holded con
numeración fiscal, registra el cobro y muestra el `docNumber` al cajero.

## Qué NO hace (deliberado)

- Sin BD, sin Prisma, sin Redis, sin BullMQ, sin worker.
- Sin offline, sin PWA, sin Service Worker.
- Sin agente de impresión, sin barcode reader.
- Sin auth, sin cajero real, sin PIN, sin emparejamiento de dispositivo.
- Sin multi-tenant (un solo tenant: el de Matías).
- Sin idempotencia client-side (si el cajero pulsa "Cobrar" dos veces, duplica).
- Sin tests automáticos.

## Pre-requisitos

- Node ≥ 20.11.
- pnpm 9.x.
- API Key de Holded del cliente, ya configurada en `apps/api/.env`.
- Catálogo de Holded del cliente con **al menos 1 producto vendible** que
  cumpla:
  - `forSale === 1`
  - `stock > 0`
  - `sku` no vacío
  - `taxes[0]` parseable como `s_iva_<N>` (ej. `s_iva_21`)

  Si el catálogo no tiene ningún producto que pase el filtro, el backend
  arranca pero `GET /products` devuelve `[]` y el TPV avisará en pantalla.
  Es el caso documentado en `docs/spike-holded.md` §06.C y §07: productos
  con `sku: ""` no se pueden vender vía TPV.

## Cómo arrancar

Necesitas **dos terminales**.

**Terminal 1 — Backend (Fastify, puerto 3001):**

```bash
pnpm --filter @mipiacetpv/api dev
```

Al boot, hace `GET /invoicing/v1/products` a Holded y cachea hasta 5
productos en memoria. Verás en los logs algo como:

```
Catálogo cargado (2 productos vendibles):
  · Precinto de embalaje · sku=8430173203748 · 2.75 € (IVA 21%)
  · FLAUTA HOHNER · sku=sku339 · 12.00 € (IVA 21%)
```

**Terminal 2 — Frontend (Vite + React, puerto 5173):**

```bash
pnpm --filter @mipiacetpv/tpv-web dev
```

Abre http://localhost:5173 en el navegador.

## Cómo verificar end-to-end

1. El grid muestra los productos cacheados por el backend.
2. Click en una tarjeta → la línea entra al carrito.
3. Botón "Cobrar efectivo" → ~1,5 s de "Procesando…" → modal verde con
   `docNumber` fiscal (ej. `T260534`), total cobrado, ID Holded y external ID.
4. Verifica el ticket en https://app.holded.com/: aprobado, con
   `docNumber` asignado y `paymentsPending: 0`.

## Endpoints del backend

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Liveness. Devuelve `{ok: true}`. |
| GET | `/products` | Catálogo cacheado (subset filtrado del catálogo Holded). |
| POST | `/tickets` | Crea + aprueba + cobra un `salesreceipt` en Holded. |

Body de `POST /tickets`:

```json
{
  "lines": [
    { "productId": "<id del producto del GET /products>", "units": 1 }
  ]
}
```

Respuesta:

```json
{
  "externalId": "<uuid v4 generado por el backend>",
  "holdedDocumentId": "<id Holded del salesreceipt>",
  "docNumber": "T260534",
  "total": 2.75
}
```

## Flujo interno del POST /tickets

Implementación del flujo cerrado en `docs/spike-holded.md` "Flujo definitivo":

1. POST `salesreceipt` con `approveDoc: true` + `items[]` (cada item con sku).
2. GET-back y valida invariantes (ADR-010):
   - `docNumber != null`
   - `approvedAt != null`
   - `draft !== true`
   - `|total − Σ(price × units × (1 + tax/100))| < 0,05 €`
3. POST `.../pay` con `{date, amount, desc: "TPV efectivo"}` (sin `treasury`,
   usa la default).
4. GET-back y valida `paymentsPending == 0`.

Si cualquier invariante falla, devuelve HTTP 502 con `stage`, `message` y
`detail` legibles.

## Documentos creados durante el desarrollo

La cuenta sandbox tiene basura acumulada de los smoke tests del MVP:

| docNumber | Bloque | Notas |
|---|---|---|
| `T260533` | Paso 0 (§07 spike) | total=0 (sondeo `productId` fallido) |
| `T260534` | Bloque 3 | 1 × Precinto · 2,75 € · pagado ✓ |
| `T260535` | Bloque 3 | 1 × Precinto + 2 × FLAUTA · 26,75 € · pagado ✓ |
| (más) | Bloque 6 | tickets de la validación visual del usuario |

Mientras Veri*factu siga desactivado, todos son borrables desde el admin
de Holded sin consecuencias fiscales.

## Limitaciones conocidas

- Sólo el page 1 de productos de Holded (los primeros 500). Suficiente
  para que el filtro `sku !== ""` saque algo cuando el cliente tiene
  productos vendibles.
- Parseo de IVA por regex `^s_iva_(\d+)$` — no cubre recargo de
  equivalencia ni IVAs internacionales.
- Todo cobro va contra la tesorería default de Holded (`treasury` no se
  envía). Cuando Pedro mapee payment methods, se modifica.
- Si el frontend pierde la conexión al backend mientras procesa un
  ticket, no hay reintento ni reconciliación — el cajero ve modal rojo y
  puede acabar con un ticket en Holded sin saberlo. Aceptable para MVP
  local; lo resuelve la cola idempotente de Fase 1.
