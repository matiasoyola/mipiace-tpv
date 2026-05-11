# 03 · Integración con Holded

> ⚠️ **Importante:** los endpoints y nombres de scopes/parámetros aquí
> listados son lo que necesitamos del catálogo público de Holded. **Antes de
> implementar, confirmar contra la documentación oficial vigente:**
> https://developers.holded.com/ — la API evoluciona y algunos detalles
> (especialmente el flujo OAuth y los `docType` admitidos) cambian con
> frecuencia. Mantener este doc como contrato vivo.

## 1. Autenticación

Holded ofrece históricamente dos vías:

1. **API Key por cuenta** — el usuario la genera en su panel y la pega. Sencillo, pero malo para SaaS multi-tenant.
2. **OAuth2 / Apps de Holded** — flujo `authorization_code` con consentimiento del usuario. **Es el camino que queremos.**

### 1.1 Flujo OAuth (a confirmar en docs oficiales)

```
GET https://api.holded.com/oauth/authorize
    ?client_id=...
    &redirect_uri=https://tpv.tudominio.com/api/oauth/callback
    &response_type=code
    &scope=read:products read:services read:contacts write:documents read:warehouses
    &state={csrf_token}
```

Al volver:

```
POST https://api.holded.com/oauth/token
    grant_type=authorization_code
    code=...
    client_id=...
    client_secret=...
    redirect_uri=...
→  { access_token, refresh_token, expires_in, token_type, scope }
```

Refresh:

```
POST https://api.holded.com/oauth/token
    grant_type=refresh_token
    refresh_token=...
```

> Si la app oficial de Holded para terceros no estuviera disponible para
> nuestro caso, **plan B:** modelo "API Key del cliente" — el propietario
> pega su API key en el onboarding. UX peor pero igual de funcional.
> **Decidir antes de implementar.**

## 2. URL base

```
https://api.holded.com/api/
```

Header común:

```
key: {api_key}            # si vamos por API Key
Authorization: Bearer ... # si vamos por OAuth
Accept: application/json
```

## 3. Endpoints que vamos a consumir

### 3.1 Productos

`GET /invoicing/v1/products`
- Devuelve catálogo de productos. Paginar con `page`.
- Campos relevantes: `id`, `name`, `sku`, `barcode`, `price`, `tax`, `kind`,
  `stock`, `variants[]`.

`GET /invoicing/v1/products/{id}`
- Detalle de un producto (para refrescar uno).

### 3.2 Servicios

`GET /invoicing/v1/services`
- Devuelve servicios facturables (sin stock).

### 3.3 Almacenes y stock

`GET /invoicing/v1/warehouses` *(plural — el singular `/warehouse`
devuelve 200 + HTML 404, ver `docs/spike-holded.md` §02.A)*
- Lista de almacenes del cliente. El propietario asigna un almacén a cada
  tienda del TPV.
- **Importante:** `warehouseId` **no se envía** en el POST de un
  `salesreceipt` — Holded lo ignora silenciosamente. Aplica sólo a
  `salesorder`, `purchaseorder` y `waybill`. Para tickets, Holded
  determina el almacén a partir del `sku` del producto en cada línea.

`GET /invoicing/v1/products/{id}/stock`
- Stock de un producto por almacén (verificar nombre exacto del endpoint).

### 3.4 Contactos

`GET /invoicing/v1/contacts`
- Para asociar cliente al ticket cuando se pida ticket nominal.

`POST /invoicing/v1/contacts`
- Crear cliente nuevo desde el TPV (cuando el cliente no exista en Holded).

### 3.5 Documentos de venta (ticket de venta)

> **Validado en Fase 0.** Ver `docs/spike-holded.md` §05 y §06 para el
> contexto empírico de cada decisión.

**Endpoint:** `POST /invoicing/v1/documents/salesreceipt`

**Payload mínimo definitivo:**

```json
{
  "approveDoc": true,
  "date": 1746979200,
  "notes": "TPV-uuid: {externalId}",
  "items": [
    {
      "name": "Camiseta XL azul",
      "units": 1,
      "price": 12.40,
      "tax": 21,
      "discount": 0,
      "sku": "CAM-XL-AZUL"
    }
  ]
}
```

**Reglas no obvias:**

- **`approveDoc: true`** (top-level, booleano) es obligatorio para que
  el documento se cree aprobado, con `docNumber` fiscal asignado. Sin
  él, Holded crea un draft con `total: 0` y `docNumber: null`.
- **`sku`** en cada línea es la llave canónica que Holded usa para
  resolver el producto. Debe coincidir literalmente con `product.sku`
  del catálogo Holded. **No enviar `productId`** — Holded lo resuelve
  automáticamente y `productId` enviado en el POST se descarta.
- Productos con `product.sku == ""` o `null` **no son vendibles** vía
  TPV con line linkage. Para "Otros / Venta libre", crear en Holded un
  producto comodín por tipo de IVA (ej. `TPV-OTROS-21`) y enviar su
  sku con el `name` y el `price` que el cashier introduce.
- **`numSerieId`** (top-level) admite el **ID interno** de una serie de
  numeración Holded. **No `numSerie`** (con `name`/`code`). Cuando se
  omite, Holded usa la serie default de la cuenta. **No hay endpoint
  público para listar series** — el propietario debe copiar el ID
  desde su admin Holded (`Configuración → Facturación → Series`).
- **`warehouseId` NO aplica a salesreceipt.** Si se envía, Holded lo
  ignora silenciosamente. Aplica sólo a `salesorder`, `purchaseorder`,
  `waybill`.
- **`tax`** en cada línea es numérico (ej. `21`). Holded además guarda
  internamente `taxes: ["s_iva_21"]` por su cuenta. No hace falta
  preocuparse por el identificador string.
- `date` (epoch en segundos) se redondea al día. Para preservar el
  segundo exacto, Holded guarda `accountingDate` con el valor original.
- El array se llama **`items` en el request** pero **`products` en la
  respuesta y en el GET**. Es un rename, no un alias.

**Respuesta importante** del GET-back:
- `id` (string), `docNumber` (string fiscal, ej. `"T260530"`),
  `total`, `subtotal`, `tax`, `approvedAt` (epoch), `draft: null`
  cuando está aprobado (no `false`).
- Señal canónica de "aprobado": `docNumber != null && approvedAt != null`.
- `paymentsTotal: 0`, `paymentsPending: <total>` hasta que registremos
  cobro vía `/pay`.

**Validación obligatoria con GET-back.** Por la "regla del 2xx
mentiroso" (ver `docs/04-stack-y-decisiones.md` ADR-010), el worker
hace GET inmediatamente después del POST y valida:
- `docNumber` asignado,
- `total ≈ Σ(price × units × (1 + tax/100))` con tolerancia 0.05 €,
- `notes` preservado (contiene nuestro externalId).

Si algo no cuadra, **no marcar `SYNCED`**: el doc se ha creado pero
con datos descartados.

**Idempotencia:** Holded **no deduplica** por contenido de `notes` ni
expone búsqueda por externalId (todos los `?search=`, `?notes=`,
`?q=`, `?externalId=`, `?filter=` devuelven 200 + HTML). La
idempotencia se hace **100% en el TPV** vía la tabla `holded_upload`
indexada por `external_id` UUIDv4 — antes de cada POST, el worker
consulta si ese externalId ya tiene un `holded_document_id` asociado;
si lo tiene, no reintenta.

### 3.6 Registro de cobro · `POST .../pay`

Tras crear el `salesreceipt` aprobado, registrar el cobro:

`POST /invoicing/v1/documents/salesreceipt/{id}/pay`

```json
{
  "date": 1746979200,
  "amount": 12.40,
  "desc": "TPV pago",
  "treasury": "{bankId_opcional}"
}
```

- `date` (epoch en segundos) es **obligatorio** (Holded responde
  HTTP 400 `{"status":0,"info":"Wrong date"}` si falta).
- `amount` es el importe del cobro.
- `desc` es libre.
- `treasury` es **opcional**: si se omite, Holded usa la tesorería
  default. Si se envía, debe ser el `bankId` del paymentmethod
  (cuando esté poblado; en muchas cuentas viene vacío).

**Respuesta:** `{status: 1, invoiceId, invoiceNum, paymentId}`.

**GET-back tras /pay** valida:
- `paymentsTotal == total` (pasó de 0 a `total`).
- `paymentsPending == 0` (pasó de `total` a 0).

Para cobros mixtos (efectivo + tarjeta) llamar `/pay` varias veces
con `amount` distinto. Cada llamada genera un `paymentId` independiente.

### 3.7 Descargar el PDF · `GET .../pdf`

`GET /invoicing/v1/documents/salesreceipt/{id}/pdf`

**Aviso:** el endpoint devuelve HTTP 200 con
`Content-Type: text/html; charset=UTF-8` (mentiroso). El cuerpo es
**JSON**:

```json
{
  "status": 1,
  "data": "<base64 de respuesta HTTP completa (headers + PDF binario)>"
}
```

Para extraer el PDF:
1. base64-decode el campo `data` → buffer.
2. Buscar la posición del header `%PDF` en el buffer.
3. El PDF binario es el slice desde esa posición hasta el final.

El bloque de "headers" que precede al `%PDF` lleva metadata útil
(`content-length`, `etag`, `last-modified`) en texto plano separado
por `\n` literales.

### 3.8 Abonos / devoluciones

Mismo endpoint `POST /invoicing/v1/documents/salesreceipt` con importes en
negativo, o tipo `creditnote` según lo que admita Holded. **Confirmar con
docs.**

### 3.9 Tipos de IVA

`GET /invoicing/v1/taxes` (confirmado en Fase 0 spike, ver §03.A)
- Array de objetos tipo `{ id: "s_iva_21", rate: 21, ... }`.
- 103 elementos en la cuenta sandbox (incluye tipos retenciones,
  exentos, internacionales).
- Se descarga en el sync inicial y se indexa por su `id` (identificador
  string como `s_iva_21`) y por su `rate` numérico. Permite mapeo
  bidireccional al construir el payload de líneas (TPV envía
  `tax: <número>`; Holded internamente reconcilia con `taxes: ["<id>"]`).

## 4. Mapeo de entidades TPV ↔ Holded

| Entidad TPV | Entidad Holded | Notas |
|---|---|---|
| Producto | `product` | El TPV tiene copia local con `holded_id` |
| Variante | `product.variants[]` | Cada variante tiene su propio `id` y `barcode` |
| Servicio | `service` | Sin stock |
| Cliente | `contact` (de tipo cliente) | Sólo si el ticket es nominal |
| Almacén | `warehouse` | Uno por tienda |
| Venta | `documents/salesreceipt` | Una por ticket cobrado |
| Devolución | `documents/salesreceipt` neg. o `creditnote` | A decidir |
| Cierre de caja | — | **No se sube a Holded.** Vive en el TPV. |
| Forma de pago detallada | — | No se sube (el `salesreceipt` lleva el total). Vive en el TPV. |
| Turno de cajero | — | No se sube. |

## 5. Sincronización del catálogo

Estrategia:

- **Inicial (al conectar OAuth):** descarga completa de productos + servicios
  + almacenes. Job en background, barra de progreso al propietario.
- **Incremental:** cada 15 min, `GET /products?updatedAfter={lastSyncAt}`.
  Si Holded no soporta `updatedAfter`, hacer paginado completo cada N min
  (peor, pero válido).
- **Manual:** botón "Sincronizar ahora" en el panel.
- **Webhook:** si Holded ofrece webhooks de cambios de catálogo, suscribirse
  para hacer push en lugar de pull. **Verificar disponibilidad.**

## 6. Límites y cuotas

Holded aplica rate limits por API key/token. Estrategia:

- Backoff con jitter ante 429.
- Cola con concurrencia limitada por tenant (ej. 4 jobs simultáneos máx).
- Métrica `holded_api_calls_per_minute_per_tenant`.

## 7. Errores y resolución

| Código | Significado | Acción del worker |
|---|---|---|
| 401 | Token caducado | Refresh y reintentar |
| 403 | Scope insuficiente / cuenta sin permiso | Notificar al propietario, parar reintentos |
| 404 | Recurso no existe | Marcar el ticket `SYNC_FAILED` con detalle |
| 409 | Conflicto (probable duplicado) | Buscar por externalId, vincular si existe |
| 422 | Validación (ej. IVA inválido, producto borrado en Holded) | `SYNC_FAILED`, mostrar al encargado |
| 429 | Rate limit | Backoff exponencial |
| 5xx | Error servidor Holded | Reintento exponencial |
