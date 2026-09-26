# Bloque abonos-holded · un abono llega a Holded con su importe, o no llega

Rama `abonos-holded`, desde `origin/master` (12980de). Sin push, sin merge, sin desplegar.

**Lo primero, porque cambia el diagnóstico del bloque:** el fallo no tenía una causa, tenía dos, y
la segunda es peor que la que veníamos a arreglar.

1. La que el prompt suponía y era cierta: la línea de un SERVICIO iba con `sku` en vez de
   `serviceId`. El arreglo de las ventas (v1.3-hotfix8) nunca se portó a las devoluciones.
2. La que apareció al probar contra Holded de verdad: **Holded ignora el campo `price` del item de
   un `salesreceipt`. El precio unitario que lee es `subtotal`.** Sin `subtotal`, Holded pone el
   precio de SU catálogo si la línea trae un identificador que allí resuelve, y 0 si no trae
   ninguno. Nunca hemos mandado `subtotal`, ni en las ventas ni en los abonos.

Las ventas funcionan por casualidad: el catálogo se sincroniza DESDE Holded, así que el precio de
allí coincide con el nuestro. En cuanto una línea lleva el lápiz del cajero (`unitPriceOverride`) o
un modificador con recargo, Holded emite el documento **al precio de catálogo** y el descuadre se
lo come el `silent_reject`. Hoy no ha pasado porque en producción no hay ni una línea con override
ni con modificadores (0 de 402 líneas vendidas), pero el TPV tiene las dos funciones encendidas.

Y una tercera, que por sí sola ya impedía todo: el GET-back exigía `total > 0`. Un abono nace con
total NEGATIVO, así que **ningún abono podía pasar la validación jamás**, ni con el identificador
bueno ni con el precio bueno. Cuadra con el inventario: en producción no hay un solo abono
sincronizado. Cero, de siempre.

---

# 1 · El inventario de lo que está roto

Sobre la copia real de producción `~/Backups/mipiacetpv/prod-2026-09-24.dump` (`pg_dump -Fc`,
631 KB, la más reciente), restaurada en una base aparte y **sólo leída**:

```bash
docker exec mipiacetpv-postgres psql -U mipiacetpv -d postgres \
  -c 'CREATE DATABASE mipiacetpv_abonos_copia;'
docker exec -i mipiacetpv-postgres pg_restore -U mipiacetpv -d mipiacetpv_abonos_copia \
  --no-owner --no-acl < ~/Backups/mipiacetpv/prod-2026-09-24.dump
```

## 1.1 Por comercio

| Comercio | Abonos OK | Abonos en `SYNC_FAILED` | € atascados | Ventas en `SYNC_FAILED` |
|---|---:|---:|---:|---:|
| Cafetería Sirope | 0 | 0 | 0,00 € | 0 |
| Fouzia Attaoui Batah | 0 | 0 | 0,00 € | 0 |
| Frutos Secos Cachitos | 0 | 0 | 0,00 € | 0 |
| Librería Thalia | 0 | 0 | 0,00 € | 0 |
| **Peluquería Sole** | **0** | **6** | **23,00 €** | 0 |
| PRUEBAS MIPIACE | 0 | 0 | 0,00 € | 0 |

Dos lecturas que conviene no pasar por alto:

- **Ningún comercio ha subido nunca un abono.** No es que a Sole le fallaran seis: es que los seis
  abonos reales que existen en toda la vida del sistema son esos seis, y fallaron todos. El resto
  de comercios no ha devuelto nada todavía.
- **Cero ventas en `SYNC_FAILED`**, y cero ventas `SYNCED` sin `holded_document_id`. El fallo
  gemelo de las ventas (junio, hotfix8) está cerrado en la base; lo único que puede quedar de él
  está al otro lado, en Holded, y de eso habla el punto 1.3.

## 1.2 Los seis abonos de Peluquería Sole, uno a uno

Todos del **10-09-2026**, todos en efectivo, todos de una línea de **SERVICIO** con SKU `AUTO-*`,
todos con el mismo error: `{"reason":"silent_reject","mismatches":[{"field":"total","actual":0,...}]}`.

| Abono | Hora (Madrid) | Importe | Servicio | SKU enviado | `serviceId` que debía ir | Ticket original | `holded_document_id` |
|---|---|---:|---|---|---|---|---|
| R-000219 | 10:00 | 3,00 € | CHAMPU TRATAMIENTO | `AUTO-67d737a6e4` | `67d737a6e40a87be3b0a4858` | 000218 · T261123 | **vacío** |
| R-000220 | 10:01 | 3,00 € | CHAMPU TRATAMIENTO | `AUTO-67d737a6e4` | `67d737a6e40a87be3b0a4858` | 000217 · T261122 | **vacío** |
| R-000221 | 10:02 | 3,00 € | CHAMPU TRATAMIENTO | `AUTO-67d737a6e4` | `67d737a6e40a87be3b0a4858` | 000216 · T261121 | **vacío** |
| R-000222 | 10:02 | 2,20 € | ESPUMA | `AUTO-67d737927b` | `67d737927bfb0ff8650a51b4` | 000215 · T261120 | **vacío** |
| R-000223 | 10:03 | 2,20 € | ESPUMA | `AUTO-67d737927b` | `67d737927bfb0ff8650a51b4` | 000214 · T261119 | **vacío** |
| R-000227 | 10:57 | 9,60 € | CORTAR NIÑOS | `AUTO-696777c96a` | `696777c96aace215d9063740` | 000226 · T261131 | **vacío** |

**Total: 23,00 €** que salieron del cajón de Sole y que en su contabilidad de Holded no existen con
su importe. Ninguna de las seis líneas tenía override ni modificadores, así que el importe guardado
en el abono es el correcto: lo único mal es lo que se mandó a Holded.

`attempts = 0` en los seis `holded_uploads`: el worker del abono nunca contaba los intentos
(`upload-ticket` sí). Corregido en este bloque, por eso la bandeja enseñará los reintentos.

## 1.3 Lo que hay al otro lado, en el Holded de Sole

Los seis documentos **existen allí**, aprobados y numerados. Lo sabemos porque el `silent_reject`
que guardó producción viene del GET-back: para poder comparar el total, Holded tuvo que devolver un
documento. Lo que no sabemos es su número, porque el id se perdía antes de guardarse — que es
exactamente el punto 2 del bloque.

Para averiguarlo hay un script **de solo lectura**, probado contra PRUEBAS MIPIACE:

```bash
pnpm --filter @mipiacetpv/api exec tsx ../../scripts/holded-orphan-docs.ts \
  --key <API_KEY_DE_SOLE> --from 2026-09-10 --to 2026-09-10 \
  --uuid 492a8c07-b0bc-47e0-91af-3c700ee79153 \
  --uuid 8b060780-a564-4ee8-be52-50e0e3bed387 \
  --uuid 2daad459-8cc7-4183-8b35-08201380c195 \
  --uuid 92b0f1a4-4d95-4225-9ea9-0729eb0b758e \
  --uuid 6908dd60-d1a0-4f79-83f8-8492a66eb1de \
  --uuid 3f02a454-508c-47da-a4da-364b6e72bc30
```

Lo lanza Matías. **Yo no lo he ejecutado contra ningún Holded de cliente**, sólo contra PRUEBAS
MIPIACE. Busca en las notas las dos etiquetas que escribe el TPV (`TPV-refund-uuid:` para abonos,
`TPV-uuid:` para ventas) y devuelve fecha, tipo, número, total, pendiente, id y uuid, marcando:

- `CERO` → el documento está a 0 € (los seis de Sole deberían salir así),
- `DUPLICADO` → hay más de un documento con el mismo uuid (un huérfano más un reintento),
- `SIGNO` → un abono en positivo o una venta en negativo,
- `SIN DOCUMENTO` → el uuid que se pidió no tiene ningún documento en Holded.

Salida real contra PRUEBAS MIPIACE (los documentos del ensayo del punto 4 y de las pruebas):

```
Documentos leídos de Holded: 18
Con etiqueta del TPV en las notas: 1
uuid pedidos: 2 · sin ningún documento en Holded: 1
  SIN DOCUMENTO  3f02a454-508c-47da-a4da-364b6e72bc30

fecha      tipo   número            total      pend. id                         uuid                                 marcas
2026-09-26 abono  T2614949           0.00       0.00 6ab8258fb5fcc0f6d00b9b95   7bedcb44-8ede-4b58-b9f7-2556d270a825 CERO

A revisar: 1 documento(s) a 0 € · 0 uuid con más de un documento
```

**Lo mismo hay que mirar para las VENTAS de junio.** El incidente del hotfix8 (Sole, 10-06-2026,
ticket 000022) fue un `silent_reject` de venta: aquel documento a 0 € también se quedó en Holded y
el reintento posterior creó un segundo documento, el bueno. En la base no queda rastro (al
sincronizar se limpia `lastError`), así que el censo sólo se puede hacer desde Holded:

```bash
pnpm --filter @mipiacetpv/api exec tsx ../../scripts/holded-orphan-docs.ts \
  --key <API_KEY_DE_SOLE> --from 2026-06-01 --to 2026-06-30
```

y mirar las filas con `CERO` o `DUPLICADO`.

---

# 2 · La regularización · escrita, NO ejecutada

Nada de esto se ha hecho. Son los pasos, en orden, para los seis abonos de Sole.

## 2.0 Qué permite Holded con un ticket ya aprobado

Probado el 26-09-2026 contra PRUEBAS MIPIACE, no deducido:

```
DELETE /invoicing/v1/documents/salesreceipt/6ab825b879d3be353a0ea321
→ 200 {"status":1,"info":"Sucessfully deleted"}

GET del mismo documento después
→ HTTP 400 {"status":0,"info":"not found"}
```

- **Un `salesreceipt` aprobado y numerado SE PUEDE BORRAR**, por API y (igual) desde la pantalla de
  Holded. No hay "anular" ni rectificativa para este tipo de documento: se borra.
- **El número no se recicla y queda un hueco.** El documento borrado era el `T2614950`; el
  siguiente que creó Holded fue el `T2614951`. La serie no se renumera.
- Sole **no emite todavía por VeriFactu** (verifactu-1b: ninguno de los seis comercios lo tiene
  encendido), así que el hueco no rompe ninguna cadena de registros fiscales. Es un hueco en la
  numeración interna de sus tickets de Holded.

**Recomendación:** borrarlos. Un ticket aprobado de 0 € miente sobre los ingresos del día; un hueco
en la numeración no dice nada falso. Dicho esto, es decisión de quien lleva la contabilidad de
Sole: si prefiere no tocar la numeración, la alternativa es dejarlos y anotar los seis en el cierre
del mes como documentos anulados sin efecto. Lo que NO vale es dejarlos y no decirlo.

## 2.1 El procedimiento, paso a paso

Para cada uno de los seis abonos (R-000219, R-000220, R-000221, R-000222, R-000223, R-000227):

1. **Encontrar el documento a 0 €** con el script del punto 1.3, que devuelve su número y su id.
   Apuntar la lista de números antes de tocar nada.
2. **Borrar en Holded ese documento** (pantalla de Holded, con la lista delante). Sólo los
   marcados `CERO` y cuyo uuid sea uno de los seis. Nada más.
3. **Darle a «Reintentar» en la bandeja de errores del panel** (Panel → Errores de sincronización →
   la devolución → Reintentar). Con los arreglos de los puntos 1-3, eso hace:
   `POST salesreceipt` con `serviceId` + `subtotal` → GET-back con total −3,00 € (o el que toque) →
   `POST /pay` con importe negativo → GET-back con pendiente 0 → el abono queda `SYNCED` con su
   `holdedDocumentId` y su número guardados.
4. **Comprobar** que la devolución sale de la bandeja y que en Holded hay un abono con su importe.

**Sí: el reintento desde el panel es el camino, y es seguro.** Los seis tienen
`holded_document_id` vacío en la base, así que el reintento crea el documento bueno de cero; no hay
que teclear ningún abono a mano. Y aunque alguien reintente antes de borrar el documento de 0 €, el
arreglo del punto 3 lo protege: no se crea un segundo documento, el abono se queda en
`SYNC_FAILED` y la bandeja dice `Holded creó el documento T26xxxxx con total 0,00 € en vez de
-3,00 €. Hay que anularlo en Holded (borrarlo) y volver a darle a Reintentar`. El orden correcto es
borrar primero, pero equivocarse no rompe nada.

**El orden importa en un punto:** los pasos 2 y 3 de cada abono, juntos, antes de pasar al
siguiente. Así, si algo sale raro, hay un solo abono a medias y no seis.

## 2.2 Si algún día aparece uno con documento guardado

A partir de este bloque, un `silent_reject` guarda el `holdedDocumentId`. El circuito es el mismo y
está automatizado: al borrar el documento en Holded, Holded contesta `not found` al GET, el worker
lo detecta, **olvida el id guardado** y crea el documento bueno. O sea: borrar en Holded +
Reintentar, siempre, sin tener que limpiar nada en la base a mano.

---

# 3 · Lo que Holded hace de verdad (ensayo del punto 4)

Cuenta **PRUEBAS MIPIACE** y sólo ella. Comprobado antes de escribir nada: el contacto
`69b7f76d890837a2ae0adf6a` que devuelve esa API key es el mismo que nuestra base tiene registrado
para el tenant PRUEBAS MIPIACE. Ningún Holded de cliente se ha tocado en todo el bloque.

## 3.1 La tabla del precio unitario

| # | Item enviado | `price` almacenado | `total` | Qué demuestra |
|---|---|---:|---:|---|
| A | SERVICIO, `serviceId`, `units:-1`, `price:10` | **500** | −605,00 | Con identificador y sin `subtotal`, Holded usa el precio de SU catálogo (500 €) |
| B | PRODUCTO, `sku:"Camisa01"`, `units:-1`, `price:8` | 8 | −9,68 | Coincidía con el catálogo: por eso las ventas parecían ir bien |
| C | SERVICIO con `sku:"AUTO-67d737a6e4"`, `price:2.4793` | **0** | **0,00** | **El fallo de Sole, reproducido**: sku que no resuelve → precio 0 |
| E | Línea libre, sin `sku` ni `serviceId`, `price:10` | 0 | 0,00 | `price` solo nunca vale |
| F | `sku` inexistente, `price:8` | 0 | 0,00 | Un sku que Holded no conoce es igual que no mandar nada |
| I | PRODUCTO `sku` válido, `price:3.3333`, `discount:10` | **8** | −17,42 | **`price` se ignora también en productos**: se perdería el override |
| J | Línea libre + `unitPrice:10` | 0 | 0,00 | No es ese el nombre del campo |
| **K** | **Línea libre + `subtotal:10`** | **10** | **−12,10** | **`subtotal` ES el precio unitario** |
| P | PRODUCTO `sku` + `subtotal:3.3333`, `units:-2`, `discount:10` | 3.3333 | −7,26 | `subtotal` gana al catálogo, y el descuento se aplica encima |
| Q | SERVICIO `serviceId` + `subtotal:10` | 10 | −12,10 | Idem en servicios: identificador Y precio nuestro |
| S | Línea libre + `subtotal:2.4793` | 2.4793 | **−3,00** | El abono de Sole, bien hecho, al céntimo |

Además: `desc` se respeta tal cual; `discount` y `tax` van en porcentaje; los 4 decimales del
precio llegan intactos (`subtotal: 2.4793` → `price: 2.4793`).

## 3.2 El signo, confirmado

**Unidades negativas y precio positivo.** El payload lo construye
`buildRefundSalesreceiptPayload`, sin tocar nada a mano:

```json
{
  "approveDoc": true,
  "date": 1790454524,
  "notes": "TPV-refund-uuid: b0a10f31-8499-4b13-b568-6103677cdefb · original: T-ORIGINAL-PRUEBA",
  "items": [
    {
      "name": "Mejores prácticas visuales",
      "units": -1,
      "subtotal": 10,
      "price": 10,
      "tax": 21,
      "discount": 0,
      "serviceId": "69b7f8be522458c48a0ef627"
    }
  ]
}
```

Respuesta del POST y GET-back (abono de un SERVICIO cuyo precio de catálogo en Holded son 500 €, y
que aun así sale a 10 €):

```json
POST → {"status":1,"id":"6ab82b283b201c0a6501b29b","invoiceNum":"T2614967","contactId":""}

GET  → {
  "id": "6ab82b283b201c0a6501b29b",
  "docNumber": "T2614967",
  "approvedAt": null,
  "draft": null,
  "total": -12.1,
  "subtotal": -10,
  "tax": -2.1,
  "paymentsTotal": 0,
  "paymentsPending": -12.1,
  "notes": "TPV-refund-uuid: b0a10f31-8499-4b13-b568-6103677cdefb · original: T-ORIGINAL-PRUEBA",
  "products": [
    { "name": "Mejores prácticas visuales", "price": 10, "units": -1, "tax": 21,
      "taxes": ["s_iva_21"], "discount": 0, "sku": 0,
      "serviceId": "69b7f8be522458c48a0ef627" }
  ]
}
```

Y el cobro negativo, que tampoco se había probado nunca:

```json
POST /invoicing/v1/documents/salesreceipt/6ab82b283b201c0a6501b29b/pay  {"amount": -12.1, ...}
GET  → { "total": -12.1, "paymentsTotal": -12.1, "paymentsPending": 0 }
```

Abono de un PRODUCTO, mismo ensayo (catálogo 8 €, cobrado 3,3333 €, 2 unidades):

```json
items: [{ "name":"Camisa de manga corta","units":-2,"subtotal":3.3333,"price":3.3333,
          "tax":21,"discount":0,"sku":"Camisa01" }]

GET  → { "docNumber":"T2614968","total":-8.07,"subtotal":-6.67,"tax":-1.4,
         "paymentsPending":-8.07,
         "products":[{"price":3.3333,"units":-2,"sku":"Camisa01",
                      "productId":"69b7f6b4170c9d1c8c042922"}] }
/pay −8.07 → { "paymentsTotal": -8.07, "paymentsPending": 0 }
```

**Conclusión: la convención de signos del MVP era la correcta** (unidades negativas), y ahora está
probada en vez de supuesta. Lo que estaba mal era el campo del precio y la validación del total.

## 3.3 Un aviso que salió del ensayo: `approvedAt`

En PRUEBAS MIPIACE, **los 340 `salesreceipt` de la cuenta devuelven `approvedAt: null`** —también
los que no son míos—, aunque nazcan con `docNumber` y `draft: null`. Por eso el ensayo hace el POST
a pelo: `createSalesreceiptApproved` corta antes por esa invariante.

En las cuentas de los clientes no pasa (273 ventas `SYNCED` en producción), así que es una
diferencia de cuenta, no de nuestro código, y **no he tocado esa invariante**. Pero conviene
saberlo: si un comercio nuevo se comportara como PRUEBAS MIPIACE, TODAS sus ventas caerían en
`silent_reject` con `approvedAt` como único mismatch. Hoy eso se detecta a la primera venta y,
desde este bloque, sin dejar documentos perdidos.

---

# 4 · Lo que cambia en el código

## 4.1 Un solo constructor de líneas (punto 1)

**Nuevo `apps/api/src/tickets/holded-line.ts`.** La línea de Holded se construye en UN sitio y la
venta y el abono se diferencian en UNO:

```ts
const units = sign * Math.abs(Number(line.units));   // SALE_SIGN = 1 · REFUND_SIGN = -1
```

Dentro viven, ya para los dos: el precio cobrado (`resolveChargedUnitPrice`: override del lápiz +
deltas de modificadores, 4 decimales), el desglose textual de modificadores (`desc`), el
identificador (`serviceId` para servicios, `sku` para productos, incluidos los `AUTO-*`) y el
`subtotal`/`price` con el mismo número.

- `buildTicketSalesreceiptPayload` (venta) pierde sus 90 líneas de lógica propia y llama al
  constructor. `formatLineForHolded` y `round4` se han ido de `upload-ticket.ts`.
- `buildRefundSalesreceiptPayload` (abono) llama al mismo constructor con `REFUND_SIGN`.

**De dónde salen los datos del abono.** La `RefundLine` no guarda ni el override ni los
modificadores ni si la línea era servicio o producto, y añadir columnas obligaría a rellenar hacia
atrás los seis abonos roto. En su lugar, el abono lee el precio, el override, los modificadores y
el producto del **`TicketLine` original**, que es un snapshot fiscal inmutable (igual de
reproducible), y de la `RefundLine` sólo las unidades devueltas, el nombre y el `sku` — el `sku`
porque el panel permite corregirlo antes de reintentar. Sin migración.

**El `unitPrice` del snapshot de `RefundLine` era el precio de CATÁLOGO** (`POST /refunds` hacía
`Number(original.unitPrice)` a secas). Arreglado en `apps/api/src/tickets/routes.ts`: ahora guarda
el precio cobrado, override y modificadores incluidos, y el total de la línea sale de ahí. Es
dinero, no sólo payload: una devolución de una línea con el lápiz devolvía al cliente el precio de
catálogo, de menos o de más. En producción no había ninguna línea así (0 de 402), así que no hay
nada que rectificar hacia atrás.

**Y la pantalla del TPV decía lo mismo mal** (`RefundPage.tsx` calculaba con `unitPrice`, que la
API sirve sin override ni deltas). Ahora usa el total cobrado de la línea. Sin esto, el cajero
habría visto en pantalla un importe distinto del que el servidor apunta en el abono.

**La puerta del importe.** Antes del POST, `uploadRefund` compara lo que suman las líneas al precio
cobrado con el `total` guardado del abono. Si no cuadra (un abono viejo, hecho con el precio de
catálogo), corta con `refund_snapshot_total_mismatch` **sin dejar nada en Holded** y con el motivo
escrito en la bandeja. Mismo espíritu que la puerta del producto LOCAL: el fallo se ve, no se
emite.

## 4.2 El `documentId` no se pierde nunca (punto 2)

- `HoldedSilentRejectError` lleva un campo nuevo: `document: { id, docNumber }`. Lo rellena
  `createSalesreceiptApproved` cuando el POST **sí** creó el documento y es el GET-back el que lo
  desmiente.
- `uploadRefund` y `uploadTicket` guardan ese id y ese número **antes** de marcar el fallo, y meten
  en `syncError` un `message` que el panel enseña tal cual:
  `Holded creó el documento T2600123 con total 0,00 € en vez de -3,00 €. Hay que anularlo en Holded
  (borrarlo) y volver a darle a Reintentar: entonces se crea el documento bueno.`
- El total del GET-back se compara **en signo y en valor** (`packages/holded-client/salesreceipt.ts`).
  La comprobación anterior, `!(storedTotal > 0)`, daba por roto cualquier abono correcto.
- El pre-check idempotente del `/pay` mira `Math.abs(paymentsTotal) > 0`: en un abono ya cobrado
  `paymentsTotal` es negativo y con `> 0` el pre-check no disparaba nunca, así que un reintento
  duplicaba el pago negativo.

## 4.3 Un reintento no duplica (punto 3)

**Nuevo `apps/api/src/tickets/holded-document.ts`.** Si hay un `holdedDocumentId` guardado, antes
de dar un paso más se mira qué hay al otro lado. Tres casos, los tres en la venta y en el abono:

| Veredicto | Qué se hace |
|---|---|
| `usable` (el total cuadra) | se salta el POST y se va al `/pay`. **Cero documentos nuevos.** |
| `gone` (Holded dice `not found`) | se olvida el id guardado y se crea el documento bueno. Es el camino de la regularización. |
| `total_mismatch` (existe, con otro total) | no se toca nada: ni POST nuevo ni `/pay` sobre un documento equivocado. `SYNC_FAILED` con el número delante. |

Holded contesta al GET de un documento borrado con **400 y `{"status":0,"info":"not found"}`**, no
con 404 — comprobado borrando uno de verdad. `isDocumentGoneError` reconoce las dos formas.

## 4.4 La bandeja del panel

- `summarizeError` enseña el `message` del documento vivo en Holded cuando lo hay, antes que el
  resumen genérico de mismatches.
- El preview del payload del abono (`/admin/refunds/:id/holded-payload-preview`) usa **el mismo
  `include`** que el worker, con `refundLineInclude()`: el propietario ve exactamente lo que se va a
  mandar.
- El filtro por tipo de error acepta los dos motivos nuevos y, de paso,
  `local_product_in_holded_payload`, que catalogo-local dejó fuera del `enum`: filtrar por él
  devolvía 400 aunque la bandeja lo mostrara.
- `uploadRefund` cuenta los intentos (`bumpAttempts`), como la venta.

## 4.5 Comentarios que habían dejado de ser verdad

`upload-ticket.ts`, puerta del producto LOCAL: decía que una línea sin identificador se va a 0 € y
que por eso se pierde el dinero. Con `subtotal` el importe ya no se pierde; la puerta se queda
igual (un producto que no existe en la contabilidad del comercio no entra ahí en silencio), pero el
comentario ahora dice la razón verdadera. Igual en `salesreceipt.ts` con la nota del hotfix8: su
diagnóstico era cierto pero incompleto.

---

# 5 · Tabla de sabotaje

Cada sabotaje se aplicó, se corrió la suite, se apuntó el resultado y se revirtió.

| # | Sabotaje | Qué se tocó | Resultado |
|---|---|---|---|
| 1 | El abono de un servicio vuelve a mandar `sku` | `resolveHoldedLineIdentifier`: `{ serviceId }` → `{ sku }` | 🔴 **8 fallos** · `SERVICIO → la línea lleva serviceId y nunca sku`, las 6 de Sole, y el test del hotfix8 de la VENTA (la prueba de que ya no pueden divergir) |
| 2 | El producto deja de mandar su `sku` (incluido `AUTO-*`) | rama `!isService && line.sku` desactivada | 🔴 **3 fallos** · `PRODUCTO con SKU AUTO-* → la línea lleva ese sku` + los dos del hotfix1 de la venta |
| 3 | El constructor se «arregla» sólo en el lado del abono | `buildRefundSalesreceiptPayload` pisa el precio con el del catálogo | 🔴 **1 fallo** · `los dos builders de payload coinciden línea a línea` |
| 4 | El `documentId` se guarda después del GET-back (o sea, no se guarda) | se quita el `saveDocument` de la rama `silent_reject` | 🔴 **1 fallo** · `guarda holdedDocumentId y número, y el panel puede contarlo` |
| 5 | Se quita la comprobación del documento guardado (FASE 0) | `if (documentId)` → `if (false && documentId)` | 🔴 **3 fallos** · el que importa es `documento guardado con total 0 → cero POST y motivo legible`; los otros dos caen porque sin FASE 0 la secuencia de llamadas a Holded ya no es la que el test espera |
| 6 | La línea deja de llevar `subtotal` | se borra `subtotal` del item | 🔴 **9 fallos** · las 6 de Sole, el test de `subtotal`, el del signo y el de venta-vs-abono |

Honestidad sobre el 5: de sus tres fallos, sólo el primero es una aserción sobre la invariante
(cero POST de creación con un documento a 0 € guardado). Los otros dos se ponen rojos porque quitar
la FASE 0 cambia el número de GETs y descoloca la cola del mock. Lo digo porque un rojo que no
prueba lo que parece probar es peor que no tenerlo.

Y el punto 6 del criterio, en detalle: las seis devoluciones reales se reconstruyen en
`apps/api/test/abonos-holded.test.ts` desde la copia (nombre de servicio, sku, `serviceId`, neto e
importe; sin nada personal). Cada una se comprueba dos veces: contra el constructor **de antes**
—conservado en el test— que manda `sku` y no manda `subtotal`, y contra el de ahora, que manda
`serviceId` + `subtotal` y cuyo total cuadra al céntimo con el importe del abono (3,00 / 2,20 /
9,60 €). Que el payload de antes produce un documento a 0 € no es teoría: es el probe C del punto
3.1, con esos mismos datos, contra Holded.

---

# 6 · Suite

```
pnpm vitest run
  Test Files  253 passed (253)
       Tests  2750 passed | 3 skipped (2753)

E2E_DATABASE_URL=...mipiacetpv_abonos_e2e pnpm test:e2e
  Test Files  20 passed (20)
       Tests  298 passed (298)
```

Typecheck en verde en los diez paquetes/apps (los siete `packages/*`, `apps/api`, `apps/admin`,
`apps/tpv-web`). El e2e corre sobre su propia base (`mipiacetpv_abonos_e2e`), que la suite borra.

Tests nuevos: `apps/api/test/abonos-holded.test.ts` (23) y cuatro en
`packages/holded-client/test/salesreceipt.test.ts` (abono con total negativo, abono a 0 € que sigue
siendo `silent_reject` y trae el documento, venta con total negativo que sigue siendo rechazada,
pre-check idempotente del `/pay` con `paymentsTotal` negativo).

---

# 7 · El cruce con `holded-desconectar`

Las dos ramas tocan tres archivos comunes: `apps/api/src/tickets/upload-refund.ts`,
`apps/api/src/tickets/upload-ticket.ts` y `apps/api/src/admin/tickets-errors.ts`.

**No hay conflicto.** Probado, no supuesto, con un merge en seco que no toca ningún árbol:

```
$ git merge-tree --write-tree --name-only abonos-holded holded-desconectar
3043161edb6ff2910e44daa4c032fa6f4b2f9624      ← sólo el árbol, ninguna ruta en conflicto
$ echo $?
0
```

El árbol resultante no tiene ni un marcador `<<<<<<<` y lleva las piezas de las dos ramas. Esto es
el `include` del `findUnique` de `uploadRefund` en el resultado del merge, que es el sitio donde las
dos ramas escriben más cerca la una de la otra —línea contigua—:

```ts
    include: {
      lines: refundLineInclude(),                    // abonos-holded
      originalTicket: { select: { id: true, holdedDocumentId: true, holdedDocNumber: true } },
      tenant: {
        select: {
          id: true,
          holdedApiKeyCiphertext: true,
          // holded-desconectar (ADR-020) · ver la nota gemela de
          // `upload-ticket.ts`.
          holdedEnabled: true,                       // holded-desconectar
          holdedDisconnectedAt: true,                // holded-desconectar
        },
      },
      register: { select: { numSerieHolded: true } },
    },
```

Dónde escribe cada una, para que quien mergee sepa qué mirar:

| Archivo | `holded-desconectar` | `abonos-holded` |
|---|---|---|
| `upload-refund.ts` | `tenant: { select }` del `include`; la puerta del corte (`holdedDisconnectedAt != null → SKIPPED`) entre `already_synced` y `no_holded_key` | `lines: refundLineInclude()` en el `include`; todo lo que viene DESPUÉS de construir el cliente (FASE 0, la puerta del importe, el guardado del documento) |
| `upload-ticket.ts` | su puerta del corte, arriba | FASE 0 y `saveDocument`, después del `bumpAttempts` |
| `tickets-errors.ts` | un `import` y `ensureHoldedVivo` en el `preHandler` de los dos `retry-sync` | el `enum` de `errorType`, el `include` del preview del abono y `summarizeError` |

Son hunks distintos y git los junta solo. Lo único que conviene repasar a ojo después del merge es
lo que ninguna herramienta comprueba: que la puerta del corte de `holded-desconectar` siga **antes**
de la FASE 0 de este bloque —un comercio que dejó Holded no debe ni hacerle un GET— y que el
typecheck de `apps/api` siga en verde, porque el `include` del `findUnique` ahora tiene dos dueños.

Ninguna de las dos ramas toca `packages/holded-client`, `holded-line.ts`, `holded-document.ts`,
`routes.ts`, `RefundPage.tsx` ni `TicketsErrorsPage.tsx`, así que ahí no hay nada que revisar.

# 8 · Lo que queda fuera, dicho en voz alta

- **Los 21 documentos de prueba que dejé en PRUEBAS MIPIACE**: `T2614947`–`T2614968` menos el
  `T2614950`, que es el que borré para comprobar el DELETE (el `T2614966` es el intento que abortó
  por `approvedAt`). Están sólo en la cuenta demo. Se pueden borrar o dejar; no los he limpiado
  para que el ensayo se pueda revisar.
- **No he ejecutado nada contra ningún Holded de cliente.** Ni el script, ni un POST, ni un GET.
- **`approvedAt` en PRUEBAS MIPIACE** (punto 3.3): aviso, no arreglo. Tocar esa invariante no es de
  este bloque.
- **La `RefundLine` sigue sin columnas de snapshot propias** para override, modificadores y tipo de
  producto: se leen del `TicketLine` original. Si algún día el `TicketLine` deja de ser inmutable,
  esto hay que revisarlo.
- **Nada de Verifactu ni de `holded-desconectar`** se ha tocado.
