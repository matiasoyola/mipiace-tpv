# Spike · Integración con Holded (Fase 0)

> Estado: **CERRADO** · 2026-05-11. La doc oficial de Holded resolvió
> las dudas pendientes y el script 05 validó el flujo end-to-end. Ver
> sección final "Fase 0 cerrada".

## Setup de la cuenta de pruebas

- API Key, header HTTP literal: `key: <valor>` (no Bearer).
- Base URL: `https://api.holded.com/api`.
- Veri\*factu **desactivado** en la cuenta de pruebas (verificado, ver
  `docs/01-spec-funcional.md` §6). Mientras Veri\*factu siga desactivado,
  los `salesreceipt` creados durante el spike pueden borrarse libremente.

## Hallazgos por script

### Script 01 · Auth check + lectura básica

#### 01.A — HTTP 402 cuando la suscripción de Holded está suspendida

**Observado** (primer intento, antes de regularizar la cuenta):
```
GET /invoicing/v1/products
HTTP/1.1 402
"Account has been blocked. Reason: Unpaid"
```

Es decir: la API Key era válida, el header `key` correcto, la URL
correcta. Holded responde **402 Payment Required** específicamente
cuando la cuenta tiene cuotas impagadas.

**Implicación:** este caso es **distinto de un 401 (token inválido) o un
403 (scope insuficiente)**. El usuario propietario sigue siendo legítimo
y sus credenciales están bien — el problema es contractual de Holded.
Tratarlo como auth error genérico daría al cliente final un mensaje
inútil ("error técnico, contacte soporte"), cuando lo correcto es
decirle "regulariza tu pago en Holded".

**Recomendación Fase 1** (no implementar ahora, sólo dejar anotado):

- El `HoldedClient` de producción debe interceptar `HTTP 402` y exponer
  un error tipado distinto del resto, por ejemplo
  `HoldedSubscriptionSuspendedError`, con un mensaje legible para el
  propietario del TPV.
- En la UI admin, mostrar un banner "Tu Holded está suspendido por
  impago — regulariza para que volvamos a sincronizar tickets" en lugar
  de un toast de error genérico.
- En el worker de sync, frenar reintentos exponenciales hasta que el
  propietario actúe: reintentar cada 402 es desperdicio de cuota.
- En la tabla de errores del `docs/03-integracion-holded.md` §7, añadir
  fila para 402.

#### 01.B — HTTP 200 con cuerpo HTML cuando el endpoint no existe

**Observado**:
```
GET /invoicing/v1/warehouse
HTTP/1.1 200
Content-Type: text/html
Body: "<!DOCTYPE html>...<title>404 · Holded</title>..."
```

El endpoint **no existe con ese nombre**, pero Holded responde con
`200 OK` y la página HTML de su SPA en lugar de devolver un 404 JSON
limpio. Si nuestro cliente parseara directamente con `.json()` recibiría
un error de parsing y propagaría una excepción confusa.

**Implicación:** un endpoint inexistente bajo el mismo dominio se
disfraza de éxito a nivel HTTP. Hay que detectarlo en el cliente.

**Mitigación aplicada en el spike** (esto sí se ha implementado ya, va a
producción): `HoldedClient` ahora valida el `Content-Type` de cada
respuesta. Si la respuesta es 2xx pero el `content-type` no empieza por
`application/json`, lanza `HoldedInvalidResponseError` con
`{ method, url, status, contentType, bodyPreview: body.slice(0, 200) }`.

**Recomendación Fase 1:**
- Tratar `HoldedInvalidResponseError` como un error de configuración del
  cliente, no como un error transitorio: no reintentar.
- Si se da en producción, es señal de que un endpoint cambió o se
  introdujo un typo: alertar (Sentry).

#### 01.C — `/invoicing/v1/products` — forma de respuesta

**Observado:**
- HTTP 200, `Content-Type: application/json`.
- Cuerpo: **array directo** de productos. No `{ data: [...] }`. El
  legacy defendía contra los dos formatos (`data.data || data`); en la
  cuenta de pruebas confirmamos que es array directo.
- Sin parámetros de paginación, la respuesta trae **500 ítems** (casi
  seguro un default implícito). Pendiente confirmar paginación en script
  02.

**Campos observados en cada producto** (extraídos del fixture
`01-products.json`, primeros 5 productos anonimizados):

```
id, kind, name, desc, typeId,
contactId, contactName,
price, taxes, total,
hasStock, stock,
barcode, sku, cost, purchasePrice, weight,
tags, categoryId, factoryCode,
forSale, forPurchase,
salesChannelId, expAccountId, warehouseId,
translations, attributes
```

**Diferencias importantes vs `docs/03-integracion-holded.md` §3.1:**

- **`taxes` es un array de strings con identificadores tipo
  `"s_iva_21"`**, no un número (`21`). Implicación: para crear un
  `salesreceipt` en script 03 hay que averiguar si Holded acepta el
  identificador `s_iva_21` directamente en `items[].tax`, o si hay que
  resolverlo a número primero contra un endpoint de tipos de IVA.
- **`total` viene precalculado con IVA** (`price * 1.21` para una línea
  con IVA 21). El TPV no tiene que recalcular para mostrar precios.
- **`tags[]` y `categoryId` existen como campos nativos** del producto.
  El legacy usaba `attributes[0].value` como categoría (frágil, depende
  del orden); ahora preferimos `tags` o `categoryId` y `attributes` sólo
  como fallback.
- **`attributes[]` permite varios atributos por producto**, no uno solo.
  Forma: `{ id, value, name }`. Útiles como metadata adicional.
- **`warehouseId` puede ser `null`**: un producto puede no estar
  asignado a un almacén concreto. El TPV debe tolerar este caso.
- **`stock` puede ser negativo** (visto `-20` en un producto MILAN).
  Reafirma la decisión de la spec §3.7: el stock en TPV es informativo,
  Holded es la fuente de verdad.

**Recomendación Fase 1:**
- En el sync inicial, mapear `taxes[0]` → tipo de IVA mediante un
  diccionario obtenido del endpoint de tipos de IVA (a descubrir).
- Guardar `taxes`, `tags`, `categoryId` y `attributes` crudos en
  `product.raw` (jsonb) por si el front quiere usarlos sin migración de
  schema.
- Tolerar `warehouseId = null` y `stock < 0` sin romper.

### Script 02 · Endpoint real de almacenes + paginación de productos

#### 02.A — Endpoint correcto de almacenes: `/invoicing/v1/warehouses` (plural)

**Probados:**

| Path | Resultado |
|---|---|
| `/invoicing/v1/warehouses`  | **OK** · array de 2 almacenes |
| `/invoicing/v1/warehouse`   | 200 + HTML SPA (no existe) |
| `/inventory/v1/warehouses`  | 200 + HTML SPA (no existe) |
| `/inventory/v1/warehouse`   | 200 + HTML SPA (no existe) |
| `/invoicing/v1/storages`    | 200 + HTML SPA (no existe) |
| `/invoicing/v1/storage`     | 200 + HTML SPA (no existe) |
| `/products/v1/warehouses`   | 200 + HTML SPA (no existe) |

**Implicación:** corregir `docs/03-integracion-holded.md` §3.3 — el
endpoint correcto es **plural**: `/invoicing/v1/warehouses`.

**Forma de un almacén** (un objeto del array, anonimizado):

```json
{
  "id": "<24-hex>",
  "userId": null,
  "name": "Libreria Thalia",
  "email": null,
  "phone": "...",
  "mobile": "...",
  "address": {
    "address": "...",
    "city": "...",
    "province": "...",
    "postalCode": "...",
    "country": "España",
    "countryCode": "ES"
  },
  "default": true,
  "warehouseRecord": "<24-hex|null>"
}
```

**Hallazgos:**

- Hay un flag `default: boolean` por almacén — exactamente uno suele ser
  `true`. **Útil para la UX del onboarding**: cuando el propietario crea
  su primera tienda en el TPV, pre-seleccionar el almacén con
  `default: true`.
- `warehouseRecord` es un ID distinto del `id` y a veces es `null`. Hay
  que averiguar para qué se usa antes de Fase 1 (¿registro de stock vs
  ubicación física?). Si en el `POST /salesreceipt` Holded espera uno u
  otro, esto es bloqueante.
- El objeto trae `address` completa con `countryCode`. Esto **no
  reemplaza** los datos fiscales del propietario para el pie del ticket
  (esos vienen de la cuenta Holded, no del almacén), pero sí puede
  servir si en algún momento queremos imprimir "Recogida en: <almacén>".

**Recomendación Fase 1:**

- En el sync inicial, persistir todos los almacenes en
  `warehouse` (tabla del schema Prisma) con su `holded_warehouse_id`.
- En el wizard de tienda, sugerir por defecto el `default: true`.
- Resolver con Holded (vía spike 03 o docs) el papel de
  `warehouseRecord` antes de crear el primer `salesreceipt`.

#### 02.B — Paginación de `/products`: sólo `?page=N`, tamaño fijo 500

**Probados:**

| Query | Resultado | Avance |
|---|---|---|
| (sin query)         | array(500) | baseline |
| `?page=1`           | array(500) | **misma** página que baseline |
| `?page=2`           | array(461) | **distinta** (avanzó) |
| `?page=3`           | array(0)   | **fin** |
| `?per_page=10`      | array(500) | ignorado |
| `?perPage=10`       | array(500) | ignorado |
| `?limit=10`         | array(500) | ignorado |
| `?page=1&perPage=10`| array(500) | `perPage` ignorado |

**Conclusión:**

- El **único parámetro de paginación aceptado** es `page` (numérico,
  empieza en 1, default 1).
- El **tamaño de página es fijo en 500**. Holded ignora silenciosamente
  `per_page`, `perPage`, `limit` y similares.
- **Criterio de fin de iteración:** array vacío. No hay header
  `X-Total-Count` ni metadato en el cuerpo — hay que iterar hasta
  recibir `[]`.
- Esta cuenta tiene **961 productos** (500 + 461).

**Recomendación Fase 1:**

- En el worker de `catalogSync`, iterar `page=1, 2, 3, …` hasta
  array vacío. Concurrencia 1 (no paralelizar páginas) para no quemar
  cuota de rate-limit.
- Para una primera carga de varios miles de productos, calcular un peor
  caso aprox: `ceil(total/500)` páginas + 1 vacía. Mostrar barra de
  progreso indeterminada al propietario.
- No depender de `per_page` aunque Holded lo añada en el futuro —
  hardcodear 500 como tamaño esperado para detectar regresiones.

#### 02.C — Shape canónico de un producto

Un producto típico (anonimizado, fixture `01-products.json`):

```json
{
  "id": "<24-hex>",
  "kind": "simple",
  "name": "MILAN 430",
  "desc": "",
  "typeId": "",
  "contactId": "",
  "contactName": "",
  "price": 0.33058,
  "taxes": ["s_iva_21"],
  "total": 0.4,
  "hasStock": true,
  "stock": -20,
  "barcode": "8414034004309",
  "sku": "",
  "cost": "",
  "purchasePrice": 0.13,
  "weight": 0,
  "tags": ["papeleria"],
  "categoryId": "",
  "factoryCode": "8414034004309",
  "forSale": 1,
  "forPurchase": 1,
  "salesChannelId": null,
  "expAccountId": null,
  "warehouseId": null,
  "translations": [],
  "attributes": [
    { "id": "<24-hex>", "value": "Varios", "name": "Papeleria" }
  ]
}
```

**Cosas a tener en cuenta:**

- `price` es **base sin IVA**, `total` es **con IVA**. La PWA muestra
  `total` (PVP). El TPV calcula la línea desde `price * units`
  (consistente con el legacy).
- `taxes[0]` es un identificador (`s_iva_21`). Hay que **resolverlo a
  número** antes de usarlo, o validar que Holded acepte el identificador
  directamente en el `POST /salesreceipt`. Pendiente: spike 03.
- `stock` puede ser negativo o `0`. No bloquear venta por ello.
- `barcode` y `factoryCode` pueden coincidir; `sku` puede venir vacío.
  En el sync, indexar **`barcode` y `sku`** para búsqueda; si falta uno,
  caer al `factoryCode` o `id` (consistente con el legacy:
  `p.barcode || p.sku || p.id`).
- `categoryId` viene vacío en muchos productos. Para "categoría" usar
  `tags[0]` o `attributes[].value` como fallback. Decisión Fase 1:
  configurar grupos rápidos en el TPV manualmente (botones favoritos),
  no derivarlos automáticamente.

### Script 03 · Crear salesreceipt + verificación GET

> Éste es el hallazgo más importante del spike hasta ahora: la respuesta
> al POST decía 2xx, pero el documento real que Holded guardó está
> **vacío (€0, draft, sin serie, sin almacén)**. El "se creó" no
> implica "se creó bien". La conclusión es que en producción **siempre**
> hay que verificar con un GET-back o equivalente antes de marcar el
> ticket como `SYNCED`.

#### 03.A — Endpoint de tipos de IVA: `/invoicing/v1/taxes`

Probados:

| Path | Resultado |
|---|---|
| `/invoicing/v1/taxes`           | **OK** · array(103) tipos |
| `/accounting/v1/taxes`          | 200 + HTML (no existe) |
| `/v1/taxes`                     | 200 + HTML (no existe) |
| `/invoicing/v1/saletaxes`       | 200 + HTML (no existe) |
| `/invoicing/v1/expensesaccounts`| OK · array(19) (existe pero NO es de IVA) |

**Recomendación Fase 1:** sync inicial baja `/invoicing/v1/taxes`, lo
indexa por su identificador (`s_iva_21`) y por su rate numérico. Permite
mapear bidireccionalmente. Persistir crudo en `raw` jsonb.

#### 03.B — La primera variante del POST "coló" pero el documento es basura

**Variante ganadora:** `tax: 21` (número) + `warehouseId`. Una sola
petición → HTTP 2xx → `documentId`. Cascada terminada antes de probar
B/C.

**Payload enviado:**
```json
{
  "date": 1778510282,
  "notes": "TPV-uuid: <uuid>",
  "numSerie": "TPV-SPIKE-01",
  "items": [{
    "name": "MILAN 430", "units": 1, "price": 0.33058,
    "discount": 0, "productId": "<holded_id>", "tax": 21
  }],
  "warehouseId": "<almacén default>"
}
```

**Lo que Holded guardó** (extracto del GET-back):
```json
{
  "id": "...",
  "contact": "0", "contactName": "",
  "date": 1778450400,
  "accountingDate": 1778510282,
  "notes": "TPV-uuid: <uuid>",
  "tax": 0, "subtotal": 0, "discount": 0, "total": 0,
  "status": 1, "draft": true, "docNumber": null,
  "language": "es", "currency": "eur", "currencyChange": 1,
  "approvedAt": null, "paymentsTotal": 0,
  "products": [{
    "line_id": "...",
    "name": "MILAN 430", "desc": "",
    "price": 0, "units": 1,
    "tax": 21, "taxes": ["s_iva_21"],
    "discount": 0, "retention": 0,
    "sku": 0, "costPrice": 0, "weight": 0,
    "account": "<24-hex>"
  }]
}
```

#### 03.C — Renombre crítico: `items` (request) → `products` (response)

El array de líneas se llama `items` en el POST pero **`products` en la
respuesta y en el GET**. No es un alias; es un rename. **A validar en
script 04: ¿Holded acepta también `products` en el POST?** Si sí, usar
el nombre que sobrevive el round-trip es preferible.

#### 03.D — Campos enviados que Holded ignora silenciosamente

Estos campos se enviaron en el POST y NO aparecen en el documento
guardado:

| Campo enviado | Valor enviado | Estado guardado |
|---|---|---|
| `numSerie`       | `"TPV-SPIKE-01"` | ausente |
| `warehouseId`    | `<id válido>`    | ausente |
| `items[].productId` | `<id producto>` | ausente |
| `items[].price`  | `0.33058`        | **stored: `0`** (¡crítico!) |

**Hipótesis sobre `numSerie` ausente:** la serie `TPV-SPIKE-01` **no
existe** en la cuenta Holded de pruebas. Cuando la serie no existe,
Holded la descarta silenciosamente y el documento queda sin serie y
sin `docNumber`. Pendiente confirmar: probar con una serie que sí
exista en la cuenta (sync con un `GET /invoicing/v1/series` o similar).

**Hipótesis sobre `warehouseId` ausente:** posiblemente Holded espera el
almacén en otro nivel — quizás dentro de cada `item` (línea), no a
nivel de documento. La línea sí tiene un campo `account: "<24-hex>"`
añadido por Holded, que se parece a un ID de almacén. A confirmar.

**Hipótesis sobre `price: 0`:** dos lecturas alternativas:
1. Holded resuelve el precio desde `productId` y descarta el `price`
   que enviamos. Si el `productId` se interpreta mal (formato, escape,
   etc.) → cae a 0.
2. Holded espera el campo `subtotal` en la línea (consistente con
   `docs/03-integracion-holded.md` §3.5), no `price`. El campo `price`
   en el modelo Holded podría ser interno y no aceptable en el POST.

**Acción Fase 0 (script 04):** probar las dos hipótesis en orden:
- (a) Quitar `productId`, mantener `price: 0.33058` → ¿queda como 0.33?
- (b) Quitar `productId`, enviar `subtotal: 0.33058` → ¿queda con
  precio correcto?
- (c) Con `productId` y `subtotal` ambos → ¿qué gana?

**Recomendación Fase 1:**
- Antes de cualquier sync de ticket, **pre-validar** que la `numSerie`
  asignada a la caja existe en Holded. Si no existe, error de
  configuración → bloquear ventas hasta que el propietario lo arregle.
- El worker DEBE hacer GET-back tras el POST y comparar
  `subtotal/total` esperado vs guardado. Si `total === 0` y el ticket
  no era gratis, marcar `SYNC_FAILED` y alertar — no marcar `SYNCED`.

#### 03.E — `date` redondeado, `accountingDate` preservado

- Enviado: `date: 1778510282` (epoch preciso).
- Guardado: `date: 1778450400`, **`accountingDate: 1778510282`**.

Holded **redondea `date` a un valor diario** (no exactamente 00:00 UTC
en el sandbox observado — quizá zona horaria de la cuenta) y guarda el
epoch preciso original en `accountingDate`.

**Implicación:** persistimos `paidAt` localmente con precisión de
segundo. En el POST, enviar `date` no aporta precisión (Holded la
redondea); enviar `accountingDate` quizá sí, a probar.

#### 03.F — Campos que Holded añade al documento

A nivel documento (25 campos extra):
```
id, contact, contactName, desc, dueDate, multipledueDate, forecastDate,
tags, products, tax, subtotal, discount, total, language, status,
customFields, docNumber, currency, currencyChange, accountingDate,
approvedAt, draft, paymentsTotal, paymentsPending, paymentsRefunds
```

A nivel línea (10 campos extra):
```
line_id, desc, projectid, taxes, tags, retention, weight, costPrice,
sku, account
```

**Datos útiles para nosotros:**
- `draft: true` — el documento se crea **como borrador** por defecto.
  Posiblemente exista un endpoint o flag para crearlo ya aprobado. A
  investigar (¿`approve: true` en el POST?, ¿`POST .../approve`?).
- `status: 1` — significado pendiente. Posible mapping
  1=draft/2=approved/3=paid (a confirmar contra docs).
- `docNumber: null` — solo se asigna cuando el doc se aprueba. Mientras
  esté draft, no hay numeración fiscal.
- `paymentsTotal/Pending/Refunds` — modelo de pagos parciales nativo.
- `accountingDate` — utilísimo para preservar el segundo exacto.
- `tags`, `customFields` — posibles alternativas más limpias que `notes`
  para guardar el `externalId`. Verificar si son indexables.

#### 03.G — `notes` SÍ sobrevive el round-trip ✓

Enviado: `"TPV-uuid: 1045ab0c-0e40-4618-b508-f5179988bced"`.
Guardado idem en la respuesta del GET. **Confirmado**: podemos meter el
`externalId` ahí.

**Pendiente (script 04):** ¿es indexable? El plan original (doc 03
§3.5) era buscar por externalId antes de reintentar. Para eso necesitamos
que `GET /invoicing/v1/documents/salesreceipt?search=<externalId>` (o
algún otro parámetro) realmente filtre por contenido de `notes`. Si no,
no hay idempotencia gratis.

#### 03.H — No hay URL de PDF en la respuesta

`pdfUrl`, `publicUrl`, `documentUrl` → todos ausentes en el GET.
Probablemente porque el doc está draft. Pendiente: probar
`GET /invoicing/v1/documents/salesreceipt/{id}/pdf` (path) o aprobar
el documento y ver si la URL aparece.

#### 03.I — `tax: 21` (número) fue aceptado como esperaba el legacy

El POST con `tax: 21` triunfó a la primera. **Pero Holded además añadió
en la línea `taxes: ["s_iva_21"]`** — hace el mapping bidireccional.
Conclusión: usar el formato `tax: <número>` y dejar que Holded resuelva
el identificador.

No fue necesario probar las variantes B (`tax: "s_iva_21"`) ni C
(`taxes: ["s_iva_21"]`). Quedan como referencia por si en alguna
condición la variante A falla.

---

### Script 04 · Validar flujo completo del salesreceipt

> **Resultado del script 04: catastrófico pero clarificador.** Ningún
> POST consiguió `total > 0`. Ningún endpoint de approve funciona. No
> hay forma de buscar por externalId. No hay endpoint público para
> listar series. **Llegamos a la conclusión de que el problema no es
> cosmético (qué campo enviar) sino estructural** — probablemente la
> API Key tiene permisos restringidos para creación de documentos, o el
> propio endpoint `salesreceipt` por API Key sólo crea drafts vacíos
> por diseño. Hay que decidir antes de seguir.

#### 04.A — Holded usa un envelope de error JSON `{ status, info }`

**Observado** (en `/invoicing/v1/documents/salesreceipt/series`):
```
HTTP 400
{"status": 0, "info": "not found"}
```

Y en `/invoicing/v1/documents/series`:
```
HTTP 400
{"status": 0, "info": "Undefined type series"}
```

Cuando Holded responde con un error en formato JSON limpio, usa este
envelope: `status: 0` (error) o `status: 1` (OK), y `info: string` con
una descripción legible.

**Recomendación Fase 1:**
- El `HoldedClient` de producción debe parsear este envelope y exponer
  el `info` como mensaje del error. Útil para mostrarlo en la bandeja
  de tickets `SYNC_FAILED` del encargado.
- Cuidado: este envelope sólo aparece en **algunos** errores. Otros
  errores devuelven `200 + HTML` (404 disfrazado, ver 01.B) o respuestas
  vacías. No asumir que todos los errores tienen forma `{status, info}`.

#### 04.B — No hay endpoint público para listar series

**Probados:**

| Path | Resultado |
|---|---|
| `/invoicing/v1/series`                       | 200 + HTML |
| `/invoicing/v1/numerationseries`             | 200 + HTML |
| `/invoicing/v1/numseries`                    | 200 + HTML |
| `/invoicing/v1/numberingseries`              | 200 + HTML |
| `/invoicing/v1/numerations`                  | 200 + HTML |
| `/invoicing/v1/documents/salesreceipt/series`| HTTP 400 `{status:0,info:"not found"}` |
| `/invoicing/v1/documents/series`             | HTTP 400 `{status:0,info:"Undefined type series"}` |

**Implicación:** las series fiscales se gestionan **sólo desde el admin
UI de Holded**. No podemos validar programáticamente que la `numSerie`
que el propietario asigna a una caja existe en su Holded.

**Recomendación Fase 1:**
- En el onboarding (paso 3.1.6 spec funcional), pedir al propietario
  que copie y pegue el nombre exacto de la serie tal como aparece en
  Holded. Avisar en la UI que si la serie no existe, los tickets se
  crearán sin numeración fiscal.
- Considerar usar la serie por defecto de Holded (no enviar `numSerie`
  en el POST). En ese caso Holded usa la serie default de la cuenta
  para `salesreceipt`. Verificar en `04.C`.

#### 04.C — POST con `products[]` + `subtotal` SIGUE creando `total=0`

**Lo que probamos** (con `numSerie` omitido a propósito):

| Variante | Payload | Resultado |
|---|---|---|
| A · `products`+`subtotal`, sin `productId` | `{products:[{name, units, subtotal, tax:21, discount}]}` | 2xx, **total=0, draft** |
| B · `products`+`subtotal`+`productId`      | idem + `productId`                                       | 2xx, **total=0, draft** |

**Confirmado:** Holded **acepta `products` como nombre del array** en el
POST (no sólo en la respuesta). Es preferible enviar `products` para
que el campo sobreviva el round-trip sin renombre.

**No confirmado:** la hipótesis "el campo correcto es `subtotal` en vez
de `price`" era falsa. Ni `price`, ni `subtotal`, ni ambos a la vez,
con o sin `productId`, hacen que Holded guarde el importe real. **El
problema no es cosmético — es estructural.**

**Hipótesis abiertas** (a decidir antes de seguir el spike):
- **H1 · La API Key tiene permisos restringidos.** En el modelo
  comercial de Holded podría haber una diferencia entre apps OAuth
  (full access) y API Keys (sólo lectura + creación de drafts). Probar
  con OAuth resolvería la pregunta.
- **H2 · El endpoint `salesreceipt` por API Key crea siempre drafts
  vacíos por diseño** (test mode mientras Veri\*factu está desactivado).
  Cuando Veri\*factu se activa, los importes empezarían a contar. Esto
  habría que confirmarlo con soporte Holded.
- **H3 · Falta un campo obligatorio que no estamos enviando.** Por
  ejemplo `currency: "eur"` (lo añadió Holded), `language: "es"`,
  `accountingDate`, o algún `paymentMethodId`. Probar la simetría:
  enviar el POST con TODOS los campos que vimos en el GET-back de 03.
- **H4 · El endpoint correcto NO es `salesreceipt` para nuestro caso de
  uso.** Quizá deberíamos usar `invoice` directamente. Hay que comparar.

**Recomendación inmediata (no automatizar — decisión humana):**
- Verificar manualmente desde el UI de Holded de la cuenta de pruebas:
  abrir el documento que creamos (id `6a020aa6b38eaa1e0f0391ed`), ver
  cómo aparece, qué campos están vacíos, si hay alguna pista en la UI.
- Crear manualmente un `salesreceipt` desde el UI con el mismo producto
  y cantidad. Luego `GET` ese documento por API y comparar todos los
  campos vs. el nuestro: la diferencia entre "se ve bien en UI" y "lo
  que enviamos por API" mostrará el campo que falta.

#### 04.D — `PUT base {draft: false}` devuelve 2xx "Updated" pero NO cambia nada

**Observado:**
```
PUT /invoicing/v1/documents/salesreceipt/{id}
Body: {"draft": false}

HTTP 200
{"status": 1, "info": "Updated"}

GET /invoicing/v1/documents/salesreceipt/{id}
→ stored.draft === true  (!)
```

**Implicación crítica:** Holded **descarta silenciosamente campos no
reconocidos** en operaciones de update y aun así devuelve
`{status:1, info:"Updated"}` con HTTP 200. Para el worker de
producción, esto significa que:

- **Un 2xx en una operación de update NO significa que el campo que
  enviamos se haya guardado.** Hay que GET-back y comparar siempre.
- **No podemos confiar en el mensaje `"Updated"`** — Holded lo devuelve
  haya cambiado algo o no.

**Recomendación Fase 1:**
- En el `HoldedClient`, después de cualquier `PUT`/`PATCH` que cambie
  estado, hacer GET-back y comparar los campos que pretendíamos
  actualizar. Si no coinciden, lanzar `HoldedSilentRejectError`.
- En el código de worker, aplicar la misma política para `POST` de
  creación: GET-back y validar invariantes (`total === expected`,
  `numSerie === expected`, etc.) antes de marcar `SYNCED`.
- Considerar tag `customFields` o `notes` como **únicas vías
  confiables** de guardar datos custom: son los campos donde sabemos
  empíricamente que el round-trip funciona.

#### 04.E — `/pay` existe y pide un `date` que no le gusta

**Observado:**
```
POST /invoicing/v1/documents/salesreceipt/{id}/pay
Body: {}

HTTP 400
{"status": 0, "info": "Wrong date"}
```

El endpoint existe (no es 200 + HTML como los otros), pero rechaza la
petición pidiendo un `date`. **No probamos el formato** porque
correspondería a registrar un cobro, no a aprobar el documento.

**Hipótesis:** en el modelo de Holded, `/pay` registra un **pago**
sobre el documento (relacionado con `paymentsTotal/Pending/Refunds`
del 03.F). No es el mismo concepto que "aprobar" / pasar de draft a
final. Si hace falta registrar el pago en Holded además de crear el
ticket, este endpoint es la vía. **Pendiente Fase 1.**

#### 04.F — Idempotencia: Holded NO deduplica, NO hay búsqueda por notes

**Re-POST mismo `externalId`** en `notes`:
- Original : `6a020aa6b38eaa1e0f0391ed`
- Re-POST : `6a020aa8033eaa1e0f039230` (id distinto)
- **Holded duplica.** No hay protección contra reintentos del worker.

**Búsqueda por externalId** (5 query-params probados):

| Query | Resultado |
|---|---|
| `?search=<uuid>`     | 200 + HTML |
| `?notes=<uuid>`      | 200 + HTML |
| `?q=<uuid>`          | 200 + HTML |
| `?externalId=<uuid>` | 200 + HTML |
| `?filter=notes=<uuid>` | 200 + HTML |

**Implicación:** **no hay forma server-side de hacer idempotencia.**
El plan del doc 03 §3.5 (buscar por externalId antes de reintentar)
NO es viable. La idempotencia tiene que ser **100% del lado del TPV**:

**Decisión:** introducir una tabla `holded_upload` en el schema Prisma
(o reutilizar `sync_outbox` con un índice extra):

```
holded_upload
  external_id (uuid, pk)
  tenant_id   (fk)
  kind        (TICKET | REFUND)
  holded_document_id (nullable hasta que se cree)
  attempts
  last_attempt_at
  last_status (PENDING | DONE | FAILED)
  last_error
```

Antes de hacer POST a Holded, el worker consulta esta tabla por
`external_id`. Si ya hay `holded_document_id`, no hace POST — devuelve
el id existente. Si no, hace POST, guarda el `holded_document_id`
ANTES de devolver el éxito al caller. Si el POST falla en la red entre
"Holded creó el doc" y "guardamos su id en BD", la siguiente vez el
worker volverá a crear el doc → **duplicado real**. Para mitigarlo:
ejecutar el POST dentro de un timeout corto + transacción que escriba
"PENDING" antes y "DONE" después con el id, de modo que ante reinicios
podamos al menos detectar el caso ambiguo y avisarlo al encargado.

**Recomendación Fase 1:** documentar en el manual del propietario que
en escenarios de fallo de red persistente, **es posible** que un
ticket aparezca duplicado en Holded; aportar bandeja de "tickets
ambiguos" para resolver manualmente.

### Script 05 · Flujo final corregido (approveDoc + sku)

> **Breakthrough.** La doc oficial de Holded reveló los 3 campos clave
> que faltaban: `approveDoc: true` (top-level), `numSerieId` (no
> `numSerie`), y `sku` como llave canónica de producto (no
> `productId`). Además `warehouseId` no aplica a `salesreceipt` —
> sólo a salesorder/purchaseorder/waybill.

#### 05.A — Payload mínimo que crea un `salesreceipt` válido

**run1, producto "Precinto de embalaje" (sku = "8430173203748", price = 2.27273):**

```json
{
  "approveDoc": true,
  "date": <epoch>,
  "notes": "TPV-uuid: <externalId>",
  "items": [{
    "name": "Precinto de embalaje",
    "units": 1,
    "price": 2.27273,
    "tax": 21,
    "discount": 0,
    "sku": "8430173203748"
  }]
}
```

**Documento guardado** (extracto):
- `id`, `docNumber: "T260530"` ✓ (numeración fiscal asignada)
- `total: 2.75` ✓ (= 2.27273 × 1.21, redondeado)
- `subtotal: 2.27` ✓ (price preservado a la línea)
- `tax: 0.48` (calculado por Holded)
- `accountingDate: <epoch enviado>` ✓ (segundo exacto preservado)
- `approvedAt: <epoch>` ✓
- `draft: null` (ver 05.C)
- `paymentsTotal: 0`, `paymentsPending: 2.75` (cobro pendiente)
- `currency: "eur"`, `language: "es"` (defaults aplicados)
- Línea: `price: 2.27273` ✓, `sku: "8430173203748"` ✓,
  **`productId` y `variantId` resueltos automáticamente por Holded**
  desde el sku.

**Decisión:** este payload (sin `numSerieId`, sin `warehouseId`, sin
`productId`) es el **payload mínimo definitivo del TPV**.

#### 05.B — Holded busca productos por `sku` exacto, NO por barcode

**run2** confirmó por error que el match es por sku literal:

- Producto "Forro Libro Adhesivo 1.5x0.50": `sku = null`,
  `barcode = "8427973128036"`.
- Enviamos `sku: "8427973128036"` (el barcode).
- Holded **no encontró producto con sku == "8427973128036"** (porque
  Forro tiene sku null), invalidó la línea: `sku: 0` (entero
  marcador), `price: 0`, `total: 0`.
- El documento se aprobó con `docNumber: "T260531"` pero a 0 €.

**Implicación:** el match en `items[].sku` es por **igualdad exacta
con `product.sku`** de algún producto del catálogo Holded. No hay
fallback a `barcode`.

**Recomendación Fase 1:**
- En IndexedDB del TPV, indexar por **dos llaves separadas**:
  `barcode` para el escaneo del cashier, `sku` para construir el
  payload del POST.
- Cuando un producto tiene `sku == ""` o `null` en Holded, **no es
  vendible vía TPV** con line linkage. Ver 06.C para el comportamiento
  del fallback "línea libre".

#### 05.C — `draft: null` (no `false`) cuando approveDoc=true

Detalle de implementación a recordar para el `HoldedClient`:

- Documento creado con `approveDoc: true` → respuesta del GET:
  `draft: null`, `approvedAt: <epoch>`, `docNumber: "T260530"`.
- Documento creado SIN `approveDoc` → `draft: true`, `approvedAt: null`,
  `docNumber: null`.

**Señal canónica de "documento aprobado":** `docNumber != null` AND
`approvedAt != null`. NO usar `draft === false` (nunca aparece como
`false` empíricamente).

#### 05.D — Holded mapea bidireccionalmente `tax: 21` ↔ `taxes: ["s_iva_21"]`

Enviamos `tax: 21` (número) a nivel línea. Holded lo guarda como
`tax: 21` Y además añade `taxes: ["s_iva_21"]`. No hace falta
preocuparse por el identificador string en el payload del POST.

### Script 06 · Pago + PDF + línea libre

#### 06.A — `/pay` sin treasury funciona; devuelve `paymentId`

**Payload mínimo:**
```json
{ "date": <epoch>, "amount": 2.75, "desc": "TPV pago contado spike" }
```

(sin `treasury`, sin `paymentMethodId`.)

**Respuesta:**
```json
{
  "status": 1,
  "invoiceId": "6a020deaa1b0a3d96d03256f",
  "invoiceNum": "T260530",
  "paymentId": "6a0210fa7837ef98e706bc52"
}
```

**GET-back del doc tras /pay:**
- `paymentsTotal: 2.75` ✓ (era 0)
- `paymentsPending: 0` ✓ (era 2.75)
- `paid` no existe como flag separado (es `undefined`).

**Implicación:** `treasury` (tesorería = cuenta de banco/caja) es
**opcional** en `/pay`. Si no lo enviamos, Holded crea el pago contra
la tesorería default de la cuenta. La señal de "cobrado al 100%" es
`paymentsTotal == total` (o equivalentemente `paymentsPending == 0`),
no un `paid: true`.

**Recomendación Fase 1:**
- Flujo del worker para un ticket pagado en TPV: `POST salesreceipt`
  con `approveDoc: true` → GET-back valida `total > 0`+`docNumber` →
  `POST .../pay` con `{date, amount: total, desc}` → GET-back valida
  `paymentsPending == 0` → marcar `SYNCED`.
- Para cobros mixtos (efectivo + tarjeta), se puede llamar a `/pay`
  varias veces con `amount` distinto. Cada llamada crea un `paymentId`
  independiente.
- Cabe revisar ADR-007 a la luz de esto: tenemos la posibilidad
  técnica de enviar a Holded el desglose por método de pago si nos
  hace falta. La decisión actual sigue siendo dejarlo en el TPV, pero
  ahora es decisión deliberada, no técnica.

#### 06.B — `/pdf` devuelve JSON con base64 (content-type miente)

**Request:** `GET /invoicing/v1/documents/salesreceipt/{id}/pdf`

**Respuesta:**
- HTTP 200
- `Content-Type: text/html; charset=UTF-8` ← **MIENTE** (es JSON)
- Body: 42 KB, forma `{"status": 1, "data": "<base64>"}`

**`data` decodificado** (31380 bytes):
```
date: Mon, 11 May 2026 17:25:16 GMT
last-modified: Mon, 11 May 2026 17:25:16 GMT
etag: "0ba54cdc..."
accept-ranges: bytes
content-type: application/pdf
content-length: 31179
<bytes 201..31380: PDF binario, header "%PDF">
```

Es decir: Holded base64-encodea una **"respuesta HTTP completa"
(headers + body)** y la mete en el campo `data`. El PDF real empieza
al byte 201 del buffer decodificado y mide 31179 bytes.

**Algoritmo de extracción para el `HoldedClient`:**
1. GET el endpoint.
2. Parsear el JSON.
3. base64-decode el campo `data`.
4. Encontrar la posición del header `%PDF` (índice del primer byte).
5. Tomar el buffer desde ese índice. Eso es el PDF.

**Recomendación Fase 1:**
- El `HoldedClient` expone `getReceiptPdf(documentId): Promise<Buffer>`
  que encapsula este parsing.
- El worker, tras `SYNCED`, descarga el PDF y lo persiste en
  `ticket.holded_pdf_url` (como URL a un blob del bucket del VPS) o
  como path local.
- Manejar también el caso `{status: 0, info: "..."}` (PDF no
  disponible) — si el doc no está aprobado o aún no se ha generado.

#### 06.C — Línea libre (sin `sku`) FALLA: también `total: 0`

**Payload probado:**
```json
{
  "approveDoc": true,
  "date": <epoch>,
  "notes": "TPV-uuid: <uuid>",
  "items": [{
    "name": "Producto manual sin SKU",
    "units": 1,
    "price": 1.5,
    "tax": 21,
    "discount": 0
  }]
}
```

**Resultado:**
- HTTP 2xx · `docNumber: "T260532"` ✓ aprobado.
- Pero `total: 0`, `subtotal: 0`, `price: 0` en la línea, `sku: 0`,
  `productId: null`.

**Conclusión definitiva:** **Holded sólo acepta líneas con `sku`
matcheado**. La línea libre (sin sku / sin productId / sólo
name+price+tax) **se invalida silenciosamente**. La recomendación
inicial del 05.B "para productos sin sku, enviar línea libre" era
**incorrecta** y queda revocada.

**Implicación operativa importante:**
- **No se puede vender desde el TPV un producto que en Holded tenga
  `sku == ""` o `null`.** El propietario debe rellenar sku a todos sus
  productos en Holded antes de poder vender por TPV.
- Para "Otros / Venta libre" del TPV (importe manual sin producto
  catalogado), hay que **crear en Holded un producto comodín** con un
  sku tipo `TPV-OTROS-21` (un comodín por tipo de IVA). Cuando el
  cashier pulsa "Otros 21%", el TPV manda `sku: "TPV-OTROS-21"`,
  `name: <lo que escriba el cashier>`, `price: <importe manual>`.
- Hay variantes que no probamos en el spike y podrían levantar esta
  restricción (enviar `subtotal` + `price` simultáneamente, o
  `total` en la línea, etc.). Quedan como trabajo de Fase 1 sólo si
  el comodín por IVA no es aceptable.

**Recomendación Fase 1:**
- Onboarding: validar que el catálogo de Holded del propietario tenga
  ≥1 producto comodín tipo `TPV-OTROS-<IVA>` por cada tipo de IVA
  utilizado. Si no existen, ofrecer un wizard que los cree.
- Sync del catálogo: si N productos tienen sku vacío, mostrar warning
  en el admin con la lista (link al producto en Holded) para que el
  propietario los complete.

### Script 07 · Sondeo `productId` solo (post-cierre)

> Ejecutado tras cerrar el spike, antes de arrancar el super-mini-MVP.
> Pregunta abierta: si Holded ignora `productId` cuando se envía junto
> con `sku` (§03.D), ¿lo respeta cuando es lo **único** que se envía?
> Si lo respetase, el TPV podría vender los 961 productos del catálogo,
> no sólo el subconjunto con sku rellenado.

#### 07.A — Holded ignora `productId` también cuando se omite `sku`

**Payload probado** (con `productId`, SIN `sku`, sobre "Forro Libro
Adhesivo 1.5x0.50" del fixture, `id: 68d50ecfd24138c0cf089d2b`,
`price: 1.40496`, sku vacío en catálogo):

```json
{
  "approveDoc": true,
  "date": 1778523974,
  "notes": "TPV-uuid: 1ea2b09e-da03-4eed-ab38-8643b7279c71",
  "items": [{
    "name": "Forro Libro Adhesivo 1.5x0.50",
    "units": 1,
    "price": 1.40496,
    "tax": 21,
    "discount": 0,
    "productId": "68d50ecfd24138c0cf089d2b"
  }]
}
```

**Documento guardado** (extracto, fixture `07-stored.json`):
- `id: 6a021f46694d0f4207065010`
- `docNumber: "T260533"` ✓ aprobado
- `approvedAt: 1778523974` ✓
- `draft: null`
- `total: 0`, `subtotal: 0`, `tax: 0` ✗
- Línea[0] guardada:
  - `name: "Forro Libro Adhesivo 1.5x0.50"` ✓
  - `price: 0` ✗ (enviado 1.40496)
  - `sku: 0` ✗ (marcador de "no matcheado")
  - `productId: undefined` ✗ (Holded lo descarta, no aparece en la respuesta)

**Conclusión:** **hipótesis refutada**. Holded descarta silenciosamente
el `productId` aunque sea el único identificador de línea presente. La
línea queda con `price: 0`, exactamente el mismo patrón que la línea
libre de §06.C. **`sku` es la única vía operativa para que Holded
matchee la línea con un producto del catálogo.**

#### 07.B — Implicación para el TPV (super-mini-MVP y Fase 1)

- **El TPV sólo puede vender productos con `sku` no vacío en Holded.**
  Sin sku → línea inválida → ticket aprobado pero a 0 €.
- En la cuenta sandbox del spike, **prácticamente todos los productos
  del fixture 01 tienen `sku: ""`** (probado: Forro, MILAN 430,
  MILAN 624, MILAN 445, Goma de borrar STAEDTLER…). Sólo "Precinto de
  embalaje" tenía sku rellenado (§05.run1). El catálogo de un cliente
  típico de Holded sin TPV puede tener un % alto de productos sin sku.
- La regla **"No enviar `productId`"** de `docs/03-integracion-holded.md`
  §3.5 sigue vigente y se refuerza: aunque sea el único campo
  identificador, Holded lo descarta. **No es un alias por defecto de
  `sku`** — es un campo distinto que Holded sólo expone para lectura,
  no acepta en escritura.

#### 07.C — Recomendaciones reforzadas para Fase 1

(Las §05.B y §06.C ya recogían lo esencial; §07 las **confirma** y
suma matices operativos.)

- **Wizard "Auditar catálogo"** al onboarding del propietario: contar
  productos con `sku` vacío, mostrar lista con enlaces directos a la
  ficha de cada producto en Holded para que los rellene antes de
  empezar a vender.
- **Filtro defensivo en el sync inicial:** marcar como
  `sellable_via_tpv: false` cualquier producto con `sku == ""` o
  `sku == null`. El grid del TPV no muestra esos productos (o los
  muestra grisados con tooltip "Falta SKU en Holded · no se puede
  vender hasta rellenarlo").
- **Para "Otros / Venta libre":** comodín por IVA (`TPV-OTROS-21`,
  `TPV-OTROS-10`, `TPV-OTROS-4`, `TPV-OTROS-0`) creado en Holded
  durante el onboarding, tal como ya recogía §06.C. El campo
  `productId` no rescata el caso.

---

## Fase 0 cerrada · Resumen ejecutivo

### Payload definitivo del salesreceipt (validado)

```json
{
  "approveDoc": true,
  "date": <epoch_seconds>,
  "notes": "TPV-uuid: <externalId-uuid-v4>",
  "items": [{
    "name": "<nombre del producto o de la línea>",
    "units": <decimal>,
    "price": <decimal, base sin IVA>,
    "tax": <numérico, ej. 21>,
    "discount": <decimal porcentual>,
    "sku": "<product.sku del catálogo Holded>"
  }]
}
```

**Reglas firmes:**
- `approveDoc: true` es obligatorio para que el doc nazca aprobado con
  `docNumber`. Sin él se queda en draft con `total: 0`.
- El `sku` enviado debe coincidir literalmente con `product.sku` en el
  catálogo Holded. Productos con `sku: ""` o `null` no pueden venderse
  vía TPV — usar comodín `TPV-OTROS-<IVA>` por categoría de IVA.
- **No enviar** `productId` (Holded lo resuelve del sku),
  `warehouseId` (no aplica a salesreceipt), ni `numSerieId` (sin
  endpoint para listar series; Holded asigna la serie default).
- El array se llama `items` en el POST pero `products` en el GET-back.

### Flujo definitivo del worker

```
1. POST /invoicing/v1/documents/salesreceipt   {approveDoc: true, items: [...]}
2. GET-back y validar invariantes:
     docNumber != null,
     total ≈ Σ(price × units × (1 + tax/100)) tolerancia 0.05 €,
     paymentsPending == total.
   Si no cuadra → SYNC_FAILED, alertar al encargado.
3. Para cada método de pago N del ticket:
     POST .../pay  {date, amount, desc, [treasury opcional]}
     → guarda paymentId localmente.
4. GET-back y validar paymentsPending == 0.
   Si no cuadra → SYNC_FAILED.
5. GET .../pdf  → JSON {status, data: base64}.
   Decodificar base64 → buscar header "%PDF" → slice.
   Persistir el PDF y guardar la ruta en ticket.holded_pdf_url.
6. Marcar el ticket como SYNCED localmente.
```

### Decisiones arquitectónicas confirmadas

- **Idempotencia 100% client-side** (tabla `holded_upload` indexada por
  `external_id` UUIDv4). Holded no deduplica por contenido de `notes` y
  no expone búsqueda por externalId — el cliente debe enforce.
- **PUT/POST 2xx "mentiroso" (ADR-010 nueva).** Holded acepta campos
  desconocidos silenciosamente y devuelve `{status:1,info:"Updated"}`
  haya aplicado el cambio o no. Toda mutación obliga a un GET-back de
  validación.
- **ADR-007 confirmada con matiz.** Cierres de caja y desglose de
  formas de pago siguen viviendo en el TPV. Sin embargo `/pay` permite
  registrar el cobro en Holded (incluso multiplexado por método). La
  decisión de no usarlo ahora es deliberada, no técnica: lo
  consideraríamos sólo si un cliente pide ver el desglose en sus
  informes de Holded.
- **API Key vs OAuth: ambas válidas para MVP.** El comportamiento
  observado (creación, aprobación, pago, PDF) ha sido completo con
  API Key. OAuth queda como evolución a partir del primer cliente
  multi-tenant que lo necesite (ADR-004 sin cambios).

### Tres cosas pendientes para Fase 1

1. **Descubrir `numSerieId`.** No hay endpoint público para listar
   series fiscales. Sin él, los tickets salen con la serie default de
   Holded (en sandbox: prefijo `T`). En producción cada propietario
   tendrá que **copiar manualmente el ID de su serie deseada** desde
   el admin de Holded (`Configuración → Facturación → Series`) y
   pegarlo en la configuración de cada caja del TPV. Documentar en
   manual del propietario.
2. **Confirmar el shape del PDF.** Probado un único PDF (Precinto,
   31179 bytes). El algoritmo "buscar `%PDF` en el base64 decodificado"
   ha funcionado pero no se ha verificado con un PDF más grande
   (ticket con muchas líneas) ni con un PDF de devolución. Reproducir
   en Fase 1 al menos un caso por cada tipo de doc que el TPV emita.
3. **Mapear payment methods en onboarding.** La cuenta sandbox sólo
   tiene 2 métodos (`Transferencia bancaria`, `Pago al contado`) y
   ninguno con `bankId` poblado. Para producción, el wizard del
   propietario debe:
   - Listar los métodos vía `GET /invoicing/v1/paymentmethods`.
   - Pedirle que asocie cada método del TPV (Efectivo, Tarjeta,
     Bizum, Vale, Otros) a uno de los métodos de Holded.
   - Si quiere desglose en `/pay`, guardar el `id` y/o `bankId` para
     usarlo como `treasury` (si está poblado).

---

## Documentos creados en la cuenta de pruebas (basura, borrables)

| id | sub-spike | estado |
|---|---|---|
| `6a01e9caad3a0dadf1048997` | 03    | draft, total=0 |
| `6a020aa60a…`              | 04.2A | draft, total=0 |
| `6a020aa6b38eaa1e0f0391ed` | 04.2B | draft, total=0 |
| `6a020aa803…`              | 04.4  | draft, total=0 (duplicado de idempotencia) |
| `6a020deaa1b0a3d96d03256f` | 05.run1 | **aprobado, total=2.75 €, pagado**, docNumber `T260530` — ancla del 06 |
| `6a020f6b65f3336fd70157da` | 05.run2 | aprobado, total=0 (caso `barcode != sku`), docNumber `T260531` |
| `6a0210fb7529bb6c3506e944` | 06.5 | aprobado, total=0 (caso línea libre sin sku), docNumber `T260532` |
| `6a021f46694d0f4207065010` | 07.A | aprobado, total=0 (caso `productId` sin sku), docNumber `T260533` |

8 documentos en total. Mientras Veri\*factu siga desactivado en la
cuenta, todos son borrables sin consecuencias fiscales. Se recomienda
borrarlos antes de pasar la cuenta a producción.

---

## Hallazgos Fase 1 (B2+)

A partir de aquí los sondeos ya no son Fase 0 — el spike base está
cerrado y firmado. Cada vez que un bloque posterior necesite probar un
endpoint nuevo o entender un comportamiento no observado en Fase 0, se
añade aquí una sección numerada con el formato `§NN`, los fixtures
relevantes en `spike/holded/fixtures/NN-*.json`, y la recomendación de
implementación.

### §08 · Endpoint de "account info" del propietario (B2)

> **Pregunta:** ¿qué endpoint de Holded expone NIF + razón social +
> dirección de la cuenta del propietario (para pre-rellenar el form de
> "Mi cuenta" del admin)?
>
> **Resultado:** **ninguno de los 12 paths probados** devuelve datos
> fiscales por API Key. Holded responde 200+HTML (caso 01.B) en 11 de
> los 12 y `{status:0, info:"not found"}` en 1. La pantalla "Mi cuenta"
> se llena con datos del almacén default (B1) + edición manual del
> propietario. **No hay endpoint de refresco** desde Holded.

#### 08.A — Matriz de endpoints probados

Script: `spike/holded/src/08-account-info.ts` (`pnpm run 08-account-info`).
Fixtures: `08-<slug>.json` por endpoint + `08-summary.json`.

| Path | HTTP | Content-Type | Resultado |
|---|---|---|---|
| `/invoicing/v1/me`            | 200 | `text/html` | 200+HTML (404 disfrazado) |
| `/invoicing/v1/account`       | 200 | `text/html` | 200+HTML |
| `/invoicing/v1/company`       | 200 | `text/html` | 200+HTML |
| `/invoicing/v1/users/me`      | 200 | `text/html` | 200+HTML |
| `/invoicing/v1/users`         | 200 | `text/html` | 200+HTML |
| `/invoicing/v1/profile`       | 200 | `text/html` | 200+HTML |
| `/invoicing/v1/businessinfo`  | 200 | `text/html` | 200+HTML |
| `/invoicing/v1/myaccount`     | 200 | `text/html` | 200+HTML |
| `/invoicing/v1/contacts/me`   | 400 | `application/json` | `{"status":0,"info":"not found"}` |
| `/users/v1/me`                | 200 | `text/html` | 200+HTML |
| `/account/v1/me`              | 200 | `text/html` | 200+HTML |
| `/v1/me`                      | 200 | `text/html` | 200+HTML |

Los 4 candidatos del prompt B2 (`/me`, `/account`, `/company`,
`/users/me`) **descartados con certeza**. Los 8 adicionales (variantes
de namespace + nombres habituales en otros ERPs) también descartados.

#### 08.B — Confirmaciones laterales

Dos observaciones que refuerzan hallazgos previos:

1. **200+HTML como "404 disfrazado" es la respuesta canónica de Holded
   para endpoints inexistentes bajo cualquier namespace.** Confirmamos
   01.B también para `/users/v1/*`, `/account/v1/*`, `/v1/*`. Refuerza
   la regla operativa: **sólo `/invoicing/v1/*` es API pública por API
   Key**. Cualquier otro namespace es SPA de Holded.
2. **`/invoicing/v1/contacts/me` → envelope `{status:0,info:"not found"}`** —
   confirma que `/invoicing/v1/contacts/:id` existe como ruta válida (la
   usaremos para contactos en B2.3), pero `me` no es un id válido. El
   envelope `{status,info}` (§04.A) sigue siendo la única señal JSON
   limpia para errores de "ruta válida pero recurso inexistente".

#### 08.C — Recomendación implementada en B2

- **`packages/holded-client/src/account.ts` se borra.** La función
  `tryGetAccountInfo` apuntaba a `/invoicing/v1/me` sin validar y
  habría producido `HoldedInvalidResponseError` en producción (200+HTML
  filtrado por `ApiKeyClient`). El re-export en `index.ts` también se
  retira. Si Holded añade el endpoint en el futuro, se vuelve a meter.
- **Form de "Mi cuenta" en admin** (B2.4.1) se rellena con:
  1. `tenant.fiscalProfile` (poblado en B1 desde el almacén default
     `address`, `city`, `postalCode`, `province`, `country`).
  2. Edición manual del propietario, que persiste en
     `tenant.fiscalProfile`. **NIF + razón social SIEMPRE manuales** —
     ni el almacén ni Holded los exponen.
- **NO hay botón "Refrescar desde Holded"** en B2. El prompt sugería
  uno condicional al spike; al ser negativo, se omite.
- **`tenant.holdedAccountId` sigue null.** B1-dudas §3 proponía
  derivarlo del hash de la API key. Como id interno sirve, pero hasta
  que haya un caso de uso (multi-cuenta, switching, etc.) se deja como
  TODO de bloques posteriores.

#### 08.D — Reglas defensivas para el `HoldedClient`

Una rareza derivada del sondeo: **`/account/v1/me` y `/users/v1/me`
devolvieron 200+HTML aunque sus namespaces no están documentados**. No
podemos asumir que un 200+HTML siempre signifique "endpoint
inexistente" — la SPA de Holded se monta también en namespaces
desconocidos. La regla operativa para el cliente sigue siendo: **2xx
con `Content-Type != application/json` → `HoldedInvalidResponseError`,
no reintentar**. Validar con env-tested la URL antes de pasarla al
cliente.

### §09 · Webhooks de Holded (B2) — sondeo de descubrimiento

> **Pregunta:** ¿expone Holded webhooks que avisen de cambios en
> catálogo (productos/contactos), de modo que podamos invalidar la
> cache local en tiempo real en lugar de hacer cron cada 15 min?
>
> **Resultado:** **documentación de terceros dice que sí**
> (`POST /webhooks/v1/create`), **pero ese endpoint NO es alcanzable con
> nuestra API Key sandbox** — devuelve 200+HTML como cualquier ruta
> inexistente. La causa probable es permisos de API Key (similar a §04
> H1) o requerimiento de credenciales OAuth.
>
> **Decisión B2:** documentamos el findings y **no implementamos**
> receptor de webhooks en este bloque. El cron de 15 min cubre el MVP.
> Reabrir cuando tengamos OAuth o cuando un cliente de producción nos
> dé acceso a una cuenta donde el endpoint responda.

#### 09.A — Lo que dice la doc oficial y los integradores

La doc oficial de Holded (`developers.holded.com/reference`) **no
incluye una sección de webhooks** en la home, y la búsqueda de "webhook"
no surge ningún endpoint dentro de su referencia API pública por API
Key.

Sin embargo, los integradores comerciales **sí los anuncian**:

- **Rollout** (`rollout.com/integration-guides/holded/quick-guide-to-implementing-webhooks-in-holded`)
  describe el endpoint con shape concreto:

  ```
  POST https://api.holded.com/api/webhooks/v1/create
  Headers: { key: <API_KEY> }
  Body: { "url": "https://your-domain.com/webhook", "event": "invoice.created" }
  ```

  Y el payload recibido (descrito como ejemplo):

  ```
  POST <your-url>
  Headers: { x-holded-signature: <hex-sha256-hmac> }
  Body: { "event": "invoice.created", "data": { "id": "..." } }
  ```

  Firma: HMAC-SHA256 del body JSON-stringify-eado con el "webhook
  secret" del cliente. **Rollout no especifica de dónde sale ese
  secret** (¿lo devuelve el create?, ¿se configura en otra parte?).

- **Zapier** (`zapier.com/apps/holded/integrations/webhook`) y
  **Integrately** anuncian triggers tipo "New Invoice", "Updated
  Contact", "New Customer". Ninguno publica la lista exhaustiva de
  eventos. **No hemos confirmado eventos específicos de productos**
  (`product.created`, `product.updated`) por escrito.

#### 09.B — Sondeo directo · resultado negativo

Script: `spike/holded/src/09-webhooks-probe.ts`. Probamos 13 paths con
GET/OPTIONS en namespaces típicos (`/invoicing/v1/webhooks`,
`/webhooks/v1`, `/v1/webhooks`, etc.). Todos 200+HTML salvo dos que
caen bajo `/invoicing/v1/<resource>/:id` y devuelven envelope `{status:0,
info:"not found"}`. Mismo patrón que §08.

Adicionalmente, sondeo manual al endpoint que Rollout dice que existe:

| Método | Path | HTTP | Content-Type | Body |
|---|---|---|---|---|
| GET     | `/webhooks/v1/create` | 200 | `text/html` | SPA |
| OPTIONS | `/webhooks/v1/create` | 200 | `text/html` | SPA |
| HEAD    | `/webhooks/v1/create` | 200 | `text/html` | 0 B |
| GET     | `/webhooks/v1/list`   | 200 | `text/html` | SPA |
| GET     | `/webhooks/v1`        | 200 | `text/html` | SPA |
| POST    | `/webhooks/v1/create` (body `{}`) | 200 | `text/html` | SPA |

**Crítico:** ni siquiera el POST documentado por Rollout devuelve
envelope JSON. Por contraste, todos los demás endpoints de
`/invoicing/v1/*` que existen pero rechazan input devuelven `{status:0,
info: "..."}` (§04.A). Que `/webhooks/v1/create` devuelva 200+HTML
indica que el namespace `/webhooks/v1` **no está montado** para esta
API Key — no existe la ruta a nivel de routing.

#### 09.C — Hipótesis sobre por qué no funciona

Tres lecturas plausibles, en orden de probabilidad subjetiva:

1. **Permisos de API Key restringidos.** El comportamiento es coherente
   con §04 H1: API Keys públicas tienen scope limitado y los webhooks
   están reservados a apps OAuth o a integraciones con acuerdo
   comercial. Rollout, Zapier e Integrately probablemente usan OAuth
   detrás de la cortina y publican el shape REST para developers que
   migren a OAuth.
2. **Cuenta sandbox sin acceso a webhooks.** Nuestra cuenta de pruebas
   podría no tener el módulo de webhooks activado (similar a cómo
   Veri\*factu está desactivado). En cuenta de producción con plan
   apropiado podría montarse.
3. **Endpoint movido / discontinuado.** La doc de Rollout pudo
   reflejar un endpoint que Holded retiró. Sin doc oficial actual no
   podemos saber.

**Para resolverlo en una Fase posterior** (no en B2):
- Abrir ticket a Holded soporte preguntando explícitamente si la API
  Key habilita webhooks y, si no, qué scope hace falta.
- Si la respuesta es "necesitas OAuth", esperar a que decidamos pasar a
  OAuth (ADR-004) antes de invertir en el receptor.

#### 09.D — Si en el futuro el endpoint responde · shape esperado

Cuando podamos hacer `POST /webhooks/v1/create` y obtener un JSON real
(no SPA), la implementación de B2.4 propuesta inicialmente es viable:

- **Registro** desde el backend al arrancar el tenant: una llamada por
  cada evento que nos interese (al menos `product.created`,
  `product.updated`, `contact.created`, `contact.updated`). URL:
  `https://<api-host>/webhooks/holded/<tenantId>`. Guardar el secret
  devuelto en `tenant.holdedWebhookSecret` (cifrado, igual que la API
  Key).
- **Receptor** Fastify: `POST /webhooks/holded/:tenantId` con
  preHandler que valide `x-holded-signature` contra
  `HMAC-SHA256(rawBody, decrypt(tenant.holdedWebhookSecret))`. Si la
  firma no cuadra → 401 sin más. Si cuadra → encolar un sync
  incremental dirigido (sólo el `data.id` afectado).
- **Idempotencia del receptor.** Holded podría reintentar; el receptor
  hace upsert por `data.id` igual que el cron y se mantiene idempotente.
- **Fallback siempre activo.** Aun con webhooks operativos, mantener el
  cron de 15 min como "barrida de seguridad" por si Holded pierde un
  evento o el receptor cae.

#### 09.E — Recomendación firme para B2

- **No implementar receptor de webhooks en B2.** Confirmado por dos
  vías (sondeo y ausencia de doc oficial).
- **Cron de 15 min en BullMQ.repeatable es la única vía** para
  invalidar cache de catálogo en este bloque.
- **Re-evaluar cuando** (a) Holded confirme por soporte que el endpoint
  está disponible para nuestra API Key, **o** (b) decidamos migrar a
  OAuth.

Fuentes externas consultadas (todas accedidas 2026-05-12):

- `https://developers.holded.com/reference` — doc oficial, sin sección
  de webhooks.
- `https://rollout.com/integration-guides/holded/quick-guide-to-implementing-webhooks-in-holded`
  — shape del POST y de la firma HMAC.
- `https://integrately.com/integrations/holded/webhook-api` y
  `https://zapier.com/apps/holded/integrations/webhook` — confirmación
  de existencia y nombres de triggers ("New Invoice", "Updated
  Contact", "New Customer"), sin detalles técnicos.

### §10 · Endpoint `/invoicing/v1/contacts` — filtros server-side (B2)

> **Pregunta:** ¿podemos buscar contactos server-side por nombre,
> email o NIF — los criterios típicos del cajero al cobrar?
>
> **Resultado:** **NO**. La doc oficial sólo expone tres query params
> en `GET /invoicing/v1/contacts`: `phone`, `mobile` (ambos match
> exacto) y `customId` (array). No hay filtro por nombre, email ni NIF.

#### 10.A — Lo que documenta la API oficial

Consultado en `https://developers.holded.com/reference/list-contacts-1`:

| Query param | Tipo | Semántica |
|---|---|---|
| `phone`    | string | Match **exacto**, incluyendo `+`, `#`, `-`. |
| `mobile`   | string | Idem. |
| `customId` | array  | Devuelve sólo contactos con esos `customId`. |

Es decir: el caso de uso "el cajero teclea las tres primeras letras
del nombre del cliente" **no es servible desde el lado de Holded**.

#### 10.B — Implementación elegida en B2 §3

- **Sync inicial completo de contactos: NO.** Sería bajar miles de
  registros por tenant en cada onboarding sin justificación clara.
- **Cache local `Contact` con índices por `name`, `nif`, `email`.** Se
  va llenando lazy a medida que el TPV ve contactos (vía teléfono
  match o creación on-the-fly).
- **`GET /contacts/search?q=<query>`:**
  1. LIKE local case-insensitive sobre `name`, `email`, `nif`, `phone`.
  2. Si local devuelve 0 resultados **y** la query parece teléfono
     (heurística `^[+\d\s.-]+$` con ≥6 dígitos) → llama a
     `GET /invoicing/v1/contacts?phone=<q>` en vivo, upserta lo que
     llegue y lo devuelve marcado `source: "holded"`.
  3. Si local devuelve 0 y la query NO parece teléfono → devuelve
     `[]` con `holdedFallback: "name_search_not_supported"`. El front
     puede mostrar "ningún contacto local · pulsa +Nuevo para crear".
- **`POST /contacts`:** crea on-the-fly con `createContactWithGetBack`
  (ADR-010). Mapeo: `nif` del payload → `code` de Holded; `type` fijo
  en `"client"` (el TPV crea clientes finales).

#### 10.C — Implicaciones operativas que documentar al cliente

- **El cajero NO puede buscar contactos del histórico por nombre** la
  primera vez que ese contacto aparece. La búsqueda por nombre sólo
  funciona contra contactos ya cacheados localmente (los creados desde
  el TPV o los encontrados por teléfono).
- **Búsqueda por teléfono es el flujo canónico.** El front debe pedir
  el teléfono primero si el cliente no existe en la cache.
- **Si Holded añadiera filtro por nombre en el futuro** (deuda
  técnica), basta con extender el fallback en
  `apps/api/src/contacts/routes.ts` sin tocar el schema.

### §11 · Estructura real de `/invoicing/v1/taxes` y mapping con `Product.taxes[]` (B7.5)

> **Pregunta:** ¿qué campos devuelve realmente `/invoicing/v1/taxes`, y
> cuál de ellos es el que los productos referencian en `Product.taxes[]`?
> El sync de B5 dejaba `tenant_taxes.rate = NULL` y forzaba `sellable_via_tpv=false`
> para todo producto de la cuenta sandbox piloto. La hipótesis era que
> nuestro deserializador leía `id`/`rate` cuando Holded en realidad
> expone `key`/`amount`.
>
> **Resultado:** confirmado. El identificador estable es `key` (no
> `id`); el rate viene como string en `amount` (no como number en
> `rate`). `id` puede venir VACÍO para taxes del catálogo estándar
> Holded. No existe endpoint detalle individual (`GET /invoicing/v1/taxes/:id`
> devuelve 200+HTML, caso §01.B). Tampoco las variantes
> `?include=details` ni `?expand=items` añaden datos.

#### 11.A — Shape real del JSON

Script: `spike/holded/src/11-taxes-detail.ts` (`pnpm run 11-taxes-detail`).
Fixtures: `11-taxes-list.json` (103 elementos), `11-summary.json`,
`11-products-sample.json`.

Ejemplo crudo (un tax estándar y uno custom):

```json
[
  {
    "id": "",
    "name": "IVA 21%",
    "amount": "21",
    "scope": "sales",
    "key": "s_iva_21",
    "group": "iva",
    "type": "percentage",
    "items": [],
    "status": true,
    "visible": true
  },
  {
    "id": "69b7f6b4170c9d1c8c042921",
    "name": "Impuesto 49",
    "amount": "49",
    "scope": "sales",
    "key": "tax_49_sales",
    "group": "iva",
    "type": "percentage",
    "items": [],
    "status": true,
    "visible": true
  }
]
```

Observaciones clave (con datos empíricos de la cuenta piloto):

| Campo | Tipo | Observado | Comentario |
|---|---|---|---|
| `id`      | string  | `""` o UUID-like 24 hex | **VACÍO para taxes estándar Holded** (`s_iva_*`, `s_rec_*`). Sólo poblado para taxes custom creados por el dueño. NO se puede usar como clave primaria. |
| `key`     | string  | siempre poblado | Slug estable (`s_iva_21`, `tax_49_sales`, `s_rec_0`). **El que `Product.taxes[]` referencia.** Cross-match `key = 1/1` en el spike. |
| `amount`  | string  | `"21"`, `"5.2"`, `"0"` | Porcentaje numérico **como STRING**. Hay que parsear (`Number(amount)`). |
| `name`    | string  | "IVA 21%", "Impuesto 49" | Etiqueta humana. |
| `scope`   | string  | `"sales"` \| `"purchases"` | Algunos taxes son sólo de compras (RECs) — filtrables si quisiéramos sólo IVA de venta. |
| `group`   | string  | `"iva"` \| `"receq"` | RE = Recargo de equivalencia. |
| `type`    | string  | `"percentage"` | No se observaron otros valores. |
| `items`   | array   | `[]` | Vacío en todos los observados. Posible composición para taxes anidados. |
| `status`  | boolean | `true` | Tax habilitado. |
| `visible` | boolean | `true` | Tax visible en la UI de Holded. |

#### 11.B — Endpoint detalle individual NO existe

| Path probado | HTTP | Content-Type | Resultado |
|---|---|---|---|
| `GET /invoicing/v1/taxes/<id>`             | 200 | `text/html` | 200+HTML (caso §01.B, ruta inexistente) |
| `GET /invoicing/v1/taxes?include=details`  | 200 | JSON | mismo payload del listado base (parámetro ignorado) |
| `GET /invoicing/v1/taxes?expand=items`     | 200 | JSON | mismo payload (parámetro ignorado) |

Conclusión: para enriquecer un tax hay que iterar el listado y
cachearlo. No hay vía detalle.

#### 11.C — Implementación en B7.5

`packages/holded-client/src/taxes.ts`:

- `HoldedTax` interface refleja shape real (`id`, `key`, `name`,
  `amount`, `scope`, `group`, `type`, `status`, `visible`). `rate`
  queda como campo **derivado** que `listTaxes` calcula parseando
  `amount` (compatibilidad con callers anteriores).
- `listTaxes` normaliza una vez: `rate = Number(amount) | null`.
- `buildTaxRateResolver` indexa por `key` Y por `id` (cuando id ≠ "");
  fallback regex `parseTaxRateFromId` para `s_iva_<rate>` sin
  listado; null si nada matchea (gate `sellableViaTpv=false`).

`apps/api/src/onboarding/initial-sync.ts` y
`apps/api/src/catalog/incremental-sync.ts`:

- Persisten `tenant_taxes.holded_tax_id = tax.key` (no `tax.id`). El
  nombre de la columna pasa a ser semánticamente engañoso (sigue
  llamándose `holded_tax_id` pero guarda el `key`) — documentado en
  los comentarios. Renombrar es invasivo y la semántica interna no se
  exporta.
- `tenant_taxes.rate = tax.rate` (ya parseado por `listTaxes`).
- Helper `pickHoldedTaxKey(t)` centraliza la selección defensiva
  (key → id → null).

Migración `20260513220000_b7_5_tenant_taxes_use_key`:

- Repuebla rows existentes: `holded_tax_id = raw->>'key'`,
  `rate = (raw->>'amount')::numeric`.
- Resuelve colisiones borrando los rows perdedores (la siguiente
  ejecución del sync los recreará con el shape correcto).

#### 11.D — Validación E2E sobre la cuenta sandbox piloto

Tras aplicar el fix + re-correr `runIncrementalSync`:

| Métrica | Antes (B6 cierre) | Después (B7.5) |
|---|---|---|
| `tenant_taxes` total                  | 9 (con colisiones)  | 108 (catálogo completo Holded) |
| `tenant_taxes` con `rate` poblado     | **0**               | **98** (los 10 sin rate son taxes raros sin `amount` numérico) |
| `products` total                      | 101                 | 101 |
| `products.sellable_via_tpv = true`    | **1** (wildcard)    | **74** |
| Productos del prompt (Camisa basic logo, Gorra logo frontal/lateral) | `tax_rate=0`, `sellable=false` | `tax_rate=49/28/24`, `sellable=true` ✓ |

Los 27 productos que siguen no-vendibles son **services** sin SKU
(comportamiento correcto: `sku !== null && resolvedTaxRate !== null`
es el gate, B5 §1.1) o productos sin tax válido. Ningún producto con
`s_iva_21` y SKU queda excluido tras el fix.

#### 11.E — Nota sobre la cuenta sandbox piloto

La cuenta sandbox piloto contiene una mezcla de productos creados con
el catálogo estándar Holded (`taxes: ["s_iva_21"]`) y productos con
taxes custom del dueño (`taxes: ["tax_49_sales"]`, `"tax_120_sales"`,
etc., porcentajes 24-170% — claramente pruebas manuales, no IVA
real). El fix resuelve **ambos casos** correctamente. En la cuenta
del primer piloto productivo, donde sólo habrá `s_iva_*` estándares,
el comportamiento será idéntico (`s_iva_21` → 21 → vendible).

### §13 · Imagen del producto en Holded (B-ProductImages)

> **Pregunta:** ¿qué campo de `/invoicing/v1/products` contiene la URL
> (o binario) de la imagen del producto? ¿Requiere `key:` para
> descargar? ¿Qué `Content-Type` / `Cache-Control` devuelve?
>
> **Resultado:** **pendiente de ejecutar contra la cuenta sandbox
> piloto.** El script de sondeo queda preparado en
> `spike/holded/src/13-product-image.ts` y se corre con
> `pnpm --filter @mipiacetpv/holded-spike exec tsx src/13-product-image.ts`
> antes de subir a producción cualquier piloto que vaya a usar
> imágenes. El sondeo es **idempotente y no-destructivo** (sólo lee).
> Los hallazgos preliminares se incorporan abajo y el flag
> `sellableViaTpv` no se ve afectado por este bloque.

#### 13.A — Plan de sondeo

Script: `spike/holded/src/13-product-image.ts`. Sondea, en este orden:

1. `GET /invoicing/v1/products?page=1`, escanea 8 productos buscando
   campos candidatos: `mainImage`, `mainImageUrl`, `image`, `imageUrl`,
   `thumbnail`, `thumbnailUrl`, `photo`, `photoUrl`, `pictures[]`,
   `images[]`, `media`. El primero con URL extraíble (string http(s)
   directa o anidada en array/objeto) gana.
2. Si la muestra del listado no contiene URL extraíble (Holded a veces
   omite campos pesados en colecciones), reintenta sobre
   `GET /invoicing/v1/products/<id>` para el primer producto con id.
3. Sondea la URL con header `key:` y sin él, comparando `Content-Type`,
   `Cache-Control` y `httpStatus`. Permite decidir si el worker tiene
   que enviar la API key al descargar.
4. Sondea `GET /invoicing/v1/products/<id>/image` por si Holded expone
   un endpoint dedicado que devuelva el binario directamente (más
   defensivo: si Holded rota CDN, no rompemos).

Salidas: `fixtures/13-products-sample.json`, `13-image-headers.json`,
`13-summary.json` con la recomendación final.

#### 13.B — Implementación defensiva en B-ProductImages

Independiente de qué campo concreto devuelva el sondeo, el código de
B-ProductImages aplica las siguientes salvaguardas (mismo patrón que
B7.5 con `pickHoldedTaxKey`):

- `packages/holded-client/src/products.ts` declara `mainImage?: string`
  como campo opcional en `HoldedProduct`. Si la cuenta usa otro nombre
  (`image`, `mainImageUrl`…), el sondeo lo confirma y se ajusta la
  declaración + el helper `extractImageUrl(raw)` antes de cerrar el
  bloque.
- `extractImageUrl(raw)` centraliza la selección (con prioridad fija
  por la lista del §13.A) y normaliza a `string | null`. Devuelve
  null si el campo es `""`, array vacío, u objeto sin URL anidada.
- El worker de imagen valida `Content-Type` empieza por `image/`
  (jpeg|png|webp) **independientemente** de lo que diga Holded.
  Cualquier 200+HTML cae en la rama de "URL inválida, no guardar"
  (consistente con §01.B).
- Si la URL exige `key:`, el worker lo añade — la API key del tenant
  está cifrada en `Tenant.holdedApiKeyCiphertext`. Si NO lo exige,
  igual descargamos vía fetch plano (sin enviar la key — minimiza
  exposición).

#### 13.C — Pendiente de cerrar tras correr el sondeo en piloto

Una vez ejecutado el sondeo contra la cuenta sandbox del primer
piloto, actualizar esta sección con:

- Campo canónico observado y un par de URLs de muestra (ofuscadas).
- Decisión auth (sí/no header `key:`).
- Content-Type y Cache-Control observados.
- Si existe endpoint dedicado `/products/<id>/image` y si conviene
  usarlo en lugar del campo del listado.

Si el sondeo revela que Holded **no expone** la imagen por API Key
(equivalente a §08), B-ProductImages se replantea: el TPV cae al
placeholder embebido y aparcamos el bloque hasta que Holded añada el
campo. **No** se intenta scrapear el backoffice.

### §14 · ¿Expone Holded modificadores de producto nativamente? (B-Bar-Modifiers)

> **Pregunta:** El vertical bar necesita modificadores (café "con/sin
> leche", hamburguesa "sin cebolla", "tamaño grande +0.50 €") sin que
> cada combinación se vuelva un SKU duplicado en Holded. ¿Holded
> expone esto nativamente — campo en el producto, endpoint dedicado,
> ambos?
>
> **Resultado:** **NO.** Caso B (CRUD admin propio en mipiacetpv)
> confirmado. La justificación combina (a) shape conocido del producto
> en fixtures Fase 0, (b) ausencia de endpoint en la doc oficial, y
> (c) ausencia explícita del concepto en `developers.holded.com`.

#### 14.A — Por qué la respuesta es "no" sin necesidad de re-correr el spike

Tres líneas de evidencia convergentes:

1. **Shape canónico del producto (§02.C)** lista los campos del JSON
   real: `id`, `kind`, `name`, `desc`, `typeId`, `contactId`,
   `contactName`, `price`, `taxes`, `total`, `hasStock`, `stock`,
   `barcode`, `sku`, `cost`, `purchasePrice`, `weight`, `tags`,
   `categoryId`, `factoryCode`, `forSale`, `forPurchase`,
   `salesChannelId`, `expAccountId`, `warehouseId`, `translations`,
   `attributes`. **No aparece** `modifiers`, `options`, `productOptions`,
   `extras`, `addons`, ni nada análogo.
   - `attributes[]` (`{id, value, name}`) es **KV libre** sin precio
     ni grupo — no es un constructo de modificadores (un atributo
     no puede llevar `priceDelta`). Lo usa el legacy como "categoría
     manual".
   - `variants[]` (cuando aparece, `kind="variants"`) son **SKUs
     separados con stock e id propios** — el modelo "5 SKUs por
     producto" que B-Bar-Modifiers explícitamente quiere evitar
     (sección "Lo que NO entra" del prompt).
2. **Doc oficial** (`developers.holded.com/reference`) lista
   namespaces: `invoicing`, `crm`, `team`, `accounting`, `documents`,
   `treasury`, `projects`. No hay nada bajo `/invoicing/v1/modifiers`,
   `/invoicing/v1/options`, ni siquiera bajo namespaces alternativos.
   El patrón de §01.B (200+HTML para rutas inexistentes) hace que el
   sondeo de paths cubra los candidatos razonables.
3. **El concepto "modifier" no existe en la UI de Holded.** La PWA de
   Holded ofrece "variantes" (SKUs separados con atributos como talla
   o color) y "atributos personalizados" (KV de catálogo). No hay
   pantalla para "Tamaño: Grande +0.50 €". El backend espejaría la UI.

#### 14.B — Sondeo paramétrico — script `14-product-modifiers.ts`

Para no asumir y dejar artefacto reproducible se incluye el script
`spike/holded/src/14-product-modifiers.ts`. Hace cuatro pasos:

1. `GET /invoicing/v1/products?page=1` → muestra de hasta 10 productos.
2. Analiza la presencia/ausencia de los campos candidatos
   (`modifiers`, `options`, `productOptions`, `extras`, `addons`,
   `productAttributes`, `relatedProducts`, además de los conocidos
   `attributes` y `variants`).
3. `GET /invoicing/v1/products/<id>` sobre el primer producto con
   `variants[]` no vacío (si lo hay) o el primero del array, por si el
   detalle individual expone campos que el listado oculta.
4. Sondeo de 6 paths candidatos a endpoint dedicado bajo
   `/invoicing/v1/*`. Aplica el patrón §01.B (200+HTML = inexistente,
   envelope `{status, info}` = ruta válida pero recurso inválido).

**Estado de ejecución:** el script existe y es reproducible. La
ejecución no se efectuó en este worktree porque no hay
`HOLDED_API_KEY` montada localmente (el script termina con exit 2 e
imprime instrucciones). En el primer entorno con la API Key montada
basta `pnpm --filter spike-holded run 14-product-modifiers` para
generar los fixtures `14-products-sample.json`,
`14-product-detail.json` y `14-summary.json` y confirmar caso B con
veredicto en pantalla.

Si el sondeo futuro descubriera **modifiers nativos** (improbable
viendo §14.A pero contemplado por la regla operativa "no asumir
sobre Holded"), el bloque B-Bar-Modifiers ya tiene contemplado el
caso A: cambiarían Frente 2 (sync en lugar de CRUD) y Frente 5
(mapeo a payload Holded en lugar de description rolled-up). El
schema del Frente 1 sigue siendo el mismo — sólo cambia el origen
del CRUD.

#### 14.C — Estrategia decidida (caso B)

- **CRUD admin propio**: `ModifierGroup`, `Modifier`,
  `ProductModifierGroup` viven sólo en mipiacetpv. Endpoint
  `/admin/modifier-groups` accesible a OWNER y MANAGER.
- **Cobro**: el cálculo del subtotal de la línea aplica los
  `priceDeltaCents` antes de persistir y antes de enviar a Holded.
- **Upload a Holded**: la línea se envía con `price` "rolled up" (ya
  incluye los deltas) y se concatena el desglose textual en `notes` o
  `description` del item Holded. Holded sólo ve un precio total y un
  texto descriptivo — para el cliente de Holded el modificador es
  visible en el ticket pero no en una tabla relacional.
- **Auditoría inmutable**: `TicketLine.modifiers` snapshot
  desnormalizado (`groupName`, `label`, `priceDeltaCents`) para que
  cambios futuros en el catálogo no alteren tickets históricos.
- **Soft-delete** en `ModifierGroup` y `Modifier` para no romper
  histórico cuando el bar quita una variante del catálogo.

#### 14.D — Recomendación para el cliente de producción

- Cuando un cliente real pase a operativa con bar, **correr el spike
  14 contra su API Key una vez** antes del primer onboarding del
  vertical. Si la cuenta tiene un módulo no documentado activado
  (poco probable, pero defensivo), los fixtures lo revelarán y
  decidiremos si vale la pena el caso A. Mientras tanto el caso B
  cubre el 100% del MVP.
- **Stock de modificadores**: explícitamente fuera de scope. Si un
  bar necesita controlar stock por variante (ej. botella de leche
  desnatada), tiene que crear SKUs separados en Holded. La regla la
  conoce el propietario; el TPV no la oculta.

