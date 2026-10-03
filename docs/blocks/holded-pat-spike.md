# holded-pat · paso 0, spike contra Holded real — PUERTA CERRADA

**Rama:** `holded-pat` (sale de `master` en `de4f915`) · **Fecha del spike:** 03-10-2026
**Token usado:** API Token (`pat_…`) de PRUEBAS MIPIACE, leído del llavero de macOS
(`HOLDED_PAT_PRUEBAS`). No aparece aquí, ni entero ni truncado. Sólo peticiones **GET**: no se ha
escrito nada en ninguna cuenta de Holded.

---

## 0 · Veredicto: la puerta del paso 0 se cierra. No se escribe código de producción.

El prompt del bloque dice: *«Si un `pat_` **sólo** funciona contra rutas v2 (otra forma de
respuesta, paginación por cursor), **para aquí**»*. Se cumplen las dos condiciones, medidas, no
supuestas:

1. Un `pat_` **no autentica contra `/invoicing/v1/…` con ningún esquema de cabecera**. No es que
   responda distinto: responde «clave rechazada» siempre.
2. v2 **no es v1 con otra cabecera**: rutas renombradas, envoltorio `{items, cursor, has_more}` y
   **paginación por cursor** — el `page` que usa el TPV lo ignora en silencio.

Por tanto **el alcance 1 del bloque (un cliente, dos claves) no es construible**: no hay «las dos
claves a la vez» contra las mismas rutas. Lo que queda es el bloque de migración a v2 (cola 8), y
eso lo decide Dirección. Los alcances 2–5 dependen del 1 y quedan en el aire con él.

---

## 1 · ¿Funciona un `pat_` contra las rutas v1 que usamos?

No, con ninguna cabecera. `GET https://api.holded.com/api/invoicing/v1/warehouses`:

| Cabecera enviada | Status | Cuerpo literal |
|---|---|---|
| `Authorization: Bearer <pat>` | `401` | `{"status":401}` |
| `Authorization: <pat>` (a secas) | `401` | `{"status":401}` |
| `key: <pat>` | **`400`** | **`{"status":0,"info":"Invalid key"}`** |
| `X-API-Key: <pat>` | `401` | `{"status":401}` |
| `Api-Key: <pat>` | `401` | `{"status":401}` |
| (ninguna cabecera de auth) | `401` | `{"status":401}` |

Mismo resultado en las demás rutas v1 del TPV, con `key: <pat>`, todas `400 {"status":0,"info":"Invalid key"}`:
`/invoicing/v1/products?page=1`, `/invoicing/v1/taxes`, `/invoicing/v1/documents/salesreceipt`.

**Esto reproduce exactamente el fallo del 13-09**: el alta de PRUEBAS MIPIACE mandó la clave en
`key:` y Holded contestó `400 {"status":0,"info":"Invalid key"}`. Confirmado: el 400 no era una
rareza del día, es la respuesta estable de v1 a un token `pat_`.

Dato fino, útil para el traductor del alcance 3: v1 **distingue** entre una clave con forma de v1
que no existe y un `pat_`.

| Clave en `key:` | Status | Cuerpo |
|---|---|---|
| 32 hex inventados (forma de v1) | `401` | `{"status":401}` |
| `pat_…` (real o inventado) | `400` | `{"status":0,"info":"Invalid key"}` |

Es decir: el 400 «Invalid key» es específico de la **forma** del token, no de que la clave sea
desconocida. Cualquier traductor único tiene que tratar **401 y 400-con-`info:"Invalid key"`** como
«clave rechazada» en v1.

## 2 · Inventario de rutas que llama el código, y qué pasa con `pat_`

Sacado por grep sobre `packages/holded-client/src` en `de4f915`, no de memoria. **Ninguna** funciona
con `pat_`: todas viven bajo `/invoicing/v1/`, y v1 rechaza el token entero (no hay ruta que vaya
«a medias»). La columna v2 es el equivalente documentado, con su ámbito, para el bloque de cola 8.

| Ruta v1 que usa el TPV | Método | Dónde | Equivalente v2 | Ámbito v2 |
|---|---|---|---|---|
| `/invoicing/v1/warehouses` | GET | `warehouses.ts:27` (valida la clave en alta y rotación) | `/api/v2/warehouses` | `inventory:warehouses.read` |
| `/invoicing/v1/taxes` | GET | `taxes.ts:41` | `/api/v2/taxes` | `accounting:taxes.read` |
| `/invoicing/v1/products?page=N` | GET | `products.ts:156` | `/api/v2/products` | `inventory:products.read` |
| `/invoicing/v1/products/{id}` | GET | `products.ts:185`, `:439` | `/api/v2/products/{id}` | `inventory:products.read` |
| `/invoicing/v1/products/{id}/image` | GET binario | `products.ts:317` (`fetchBinary`) | `/api/v2/products/{id}/image` | `inventory:products.read` |
| `/invoicing/v1/products/{id}` | PUT | `products.ts:434` (bandeja SKU) | `PUT /api/v2/products/{id}` | `inventory:products.write` |
| `/invoicing/v1/products` | POST | `products.ts:483` | `POST /api/v2/products` | `inventory:products.write` |
| `/invoicing/v1/services?page=N` | GET | `services.ts:21` | `/api/v2/services` | `sales:services.read` |
| `/invoicing/v1/contacts` (+ filtros, `/{id}`) | GET | `contacts.ts:75,107,115,129,135` | `/api/v2/contacts`, `/contacts/search` | `contacts:contacts.read` |
| `/invoicing/v1/contacts` | POST | `contacts.ts:155` | `POST /api/v2/contacts` | `contacts:contacts.write` |
| `/invoicing/v1/contacts/{id}` | PUT | `contacts.ts:186` | `PUT /api/v2/contacts/{id}` | `contacts:contacts.write` |
| `/invoicing/v1/documents/salesreceipt` | POST | `salesreceipt.ts:133` (tickets y abonos) | `POST /api/v2/sales-receipts` | `sales:receipts.write` |
| `/invoicing/v1/documents/salesreceipt/{id}` | GET | `:147`, `:233`, `:251`, `:279` (GET-back) | `/api/v2/sales-receipts/{id}` | `sales:receipts.read` |
| `/invoicing/v1/documents/salesreceipt/{id}/pay` | POST | `:246` | `POST /api/v2/sales-receipts/{id}/payments` | `sales:receipts.write` |
| `/invoicing/v1/documents/salesreceipt/{id}/pdf` | GET | `:297` | `/api/v2/sales-receipts/{id}/pdf` | `sales:receipts.read` |

Las escrituras no se han ensayado contra ninguna cuenta (decisión de Matías, 03-10): su columna v2
sale del `openapi/api2.json` oficial, endpoint por endpoint.

### Hallazgo que corrige el prompt: la cabecera se fija en **tres** sitios, no en dos

El prompt localiza `request` (`client.ts:82`) y `fetchBinary` (`:185`). Hay un tercero:
`getReceiptPdf` (`salesreceipt.ts:287-300`) **no usa el cliente**, monta su propio `fetchImpl` con
`headers: { key: apiKey, Accept: "application/json" }`. Cualquier cambio de esquema de autenticación
que se haga «en un único sitio» del cliente **deja el PDF fuera**. Vale igual para la migración a v2.

## 3 · Qué responde Holded cuando falta un ámbito

Medido con el token de PRUEBAS, que resultó **no** tener los nueve ámbitos (ver §3.1). v2 distingue
los dos casos con el **mismo status 403** y cuerpo `application/problem+json` distinto:

| Caso | Status | Cuerpo literal |
|---|---|---|
| Falta el ámbito | `403` | `{"type":"https://api.holded.com/problems/forbidden","title":"Forbidden","status":403,"detail":"Insufficient permissions: inventory:warehouses.read required."}` |
| Token inválido o revocado | `403` | `{"type":"https://api.holded.com/problems/forbidden","title":"Forbidden","status":403,"detail":"Access denied."}` |

Dos cosas que importan para cualquier diseño futuro:

- **El 403 nombra el ámbito que falta**, con el identificador exacto (`area:recurso.read|write`).
  Una sonda de lectura por recurso no sólo detecta la falta: dice cuál es.
- **Token revocado también es 403, no 401.** Tratar «403 ⇒ faltan permisos» a secas confundiría una
  clave muerta con un permiso sin marcar. El discriminante es `detail`, no el status.

No hay endpoint de introspección: de las 221 rutas del `openapi/api2.json` ninguna devuelve los
ámbitos de un token. Lo más cercano, `GET /api/v2/usage`, exige su propio ámbito
(`developers:usage.read`) y no lista permisos. Así que la vía (a) del prompt (introspección) **no
existe**; sólo la (b), sonda de lectura por recurso.

### 3.1 · El token de PRUEBAS no tiene los nueve ámbitos

Se dijo que los tenía; la API dice otra cosa. `GET /api/v2/<recurso>?limit=1` con el token real:

| Recurso | Status | Lectura |
|---|---|---|
| `taxes` | `200` | tiene `accounting:taxes.read` |
| `contacts` | `200` | tiene `contacts:contacts.read` |
| `invoices` | `200` | tiene `sales:invoices.read` (que el TPV no usa) |
| `usage` | `200` | tiene `developers:usage.read` |
| `warehouses` | `403` | **falta** `inventory:warehouses.read` |
| `products` | `403` | **falta** `inventory:products.read` |
| `services` | `403` | **falta** `sales:services.read` |
| `sales-receipts` | `403` | **falta** `sales:receipts.read` |

No cambia el veredicto (la puerta se cierra en v1, donde el token se rechaza entero, ámbitos
aparte), pero sí dos cosas: ya no hace falta el segundo token «sin un ámbito» para ver el 403 real
—está arriba—, y **el token de PRUEBAS habrá que rehacerlo con los ámbitos marcados** antes de
ensayar el bloque de v2.

Nombres tal como los ve el cliente en el panel (Configuración → Desarrolladores → Credenciales): no
verificados contra la pantalla; lo de arriba son los identificadores que devuelve la API y que
publica el spec. Si el panel los rotula en castellano, hay que mapearlos mirando la pantalla.

## 4 · Token inválido o revocado, y clave v1 inválida

- `pat_` inventado, contra v2: `403` `{"…","detail":"Access denied."}`. Indistinguible de un token
  revocado por la respuesta.
- `pat_` (real o falso) contra v1 con `key:`: `400 {"status":0,"info":"Invalid key"}`.
- Clave con forma de v1 (32 hex) que no existe, contra v1: `401 {"status":401}`.
- **Sin comprobar:** que una clave v1 **válida** siga funcionando hoy. Haría falta la v1 de PRUEBAS,
  que no se ha pedido. Es la hipótesis sobre la que descansa que las cajas sigan cobrando, y está
  **sin medir**.

## 5 · Fecha de apagado de v1

No hay fecha publicada. La referencia dice literal: *«The previous version is deprecated but still
available for existing integrations»*. El panel de Holded habla de acceso «temporal» sin fecha.

Lo que sí aparece, y es nuevo: **v1 está medida y contabilizada como legado contra una cuota
mensual**. `GET /api/v2/usage` del token de PRUEBAS, hoy:

```json
{"type":"automation_token","period":"2026-10","usage":2006,"limit":5000,"count":1,
 "secondary_usages":{"api_v1_legacy_1":1994,"api_accounting_taxes_list_1":1,
 "api_contacts_contacts_list_1":8,"api_sales_invoices_list_1":1,"api_developers_usage_get_1":2},
 "user_usages":{},"next_plan":"freelancer_pro","next_limit":500}
```

1994 de las 2006 llamadas del mes son `api_v1_legacy_1`. **Hay un techo de 5000 llamadas al mes** en
esta cuenta, y el `next_limit: 500` del plan siguiente apunta a que el techo depende del plan del
cliente. Una caja que sube tickets y sincroniza catálogo puede acercarse a eso. Dirección debería
mirarlo antes de la migración: no es un detalle de implementación, es un límite de negocio por
cuenta. Aparte, el límite por minuto documentado es 100 peticiones.

## 6 · v2 no es v1 con otra cabecera

Respuestas reales, token de PRUEBAS, `GET /api/v2/contacts`:

- Envoltorio: `{"items":[…],"cursor":"69295ff942d5a6791004ee55","has_more":true}`. v1 devuelve el
  array pelado.
- **`page` se ignora.** `?limit=2&page=1`, `page=2` y `page=3` devuelven **los mismos dos ids**.
  Ningún error: silencio. El `products.ts:156` y `contacts.ts:75` del TPV paginan con `page` y, con
  v2, se quedarían dando vueltas sobre la primera página para siempre.
- La paginación es **por cursor** y el cursor es un ObjectId: `?cursor=abc` →
  `400 {"…/problems/bad-request","title":"Bad request","status":400,"detail":"Error parsing ObjectId string: abc"}`.
  `?cursor=` (vacío) → `{"items":[],"cursor":null,"has_more":false}`.
- Rutas renombradas: `/invoicing/v1/documents/salesreceipt` → `/api/v2/sales-receipts`;
  `/pay` → `/payments`.
- Errores en `application/problem+json` (`{type,title,status,detail}`) frente al
  `{"status":0,"info":"…"}` de v1.

**Ojo con la documentación oficial:** la guía de Getting started dice *«Pagination: Use `page` and
`limit` query parameters»*. La API real pagina por cursor e ignora `page`. La doc miente; manda la
respuesta.

---

## 7 · Lo que este spike NO cubre

- Que una clave v1 **válida** siga funcionando (§4). Sin medir.
- Las **escrituras**: nada se ha ejecutado contra Holded (ni en PRUEBAS). Sus ámbitos v2 salen del
  spec, no de una respuesta.
- Los nombres de los ámbitos **tal como los rotula el panel** en castellano (§3.1).
- Si el techo de 5000/mes (§5) aplica igual a los planes de los ~40 clientes.
- Que el PDF (`getReceiptPdf`) tenga equivalente v2 probado: la ruta existe en el spec, no se ha
  llamado.

## 8 · Qué pide esto a Dirección

1. **No hay «dos claves a la vez».** El bloque `holded-pat` tal como está escrito no se puede
   construir: migrar a v2 (cola 8) es el único camino, y arrastra cursor, rutas nuevas, envoltorio
   nuevo, errores nuevos y el tercer sitio de autenticación (`getReceiptPdf`).
2. Lo que **sí** sobrevive del bloque y se puede hacer sobre v1, si Dirección lo quiere como peldaño
   suelto: el **alcance 3** (una sola traducción, y que `400 {"status":0,"info":"Invalid key"}` deje
   de leerse como «Holded no responde»). Hoy un implantador que pega un `pat_` ve un error de red
   que no existe; eso se arregla sin tocar el esquema de autenticación y es el bug que destapó el
   13-09. También el **alcance 4** (ver qué tipo de clave tiene cada tenant), que es la herramienta
   con la que se migrarán las cuentas y no depende de que v2 esté montada.
3. Medir si una v1 válida sigue viva (§4) antes de prometer que las cajas aguantan.
4. Rehacer el token de PRUEBAS con los ámbitos marcados (§3.1) para el bloque de v2.
