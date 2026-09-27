# holded-desconectar · un comercio vivo deja Holded sin perder nada — DONE

**Rama:** `holded-desconectar` (sale de `master` en 12980de) · **Estado:** hecho, **sin push, sin
merge, sin desplegar**.

Escalón 3 de la independencia de Holded. ADR-016 resolvió la empresa sin caja; ADR-017, la que
**nace** sin Holded; éste, la que **lo deja**. La decisión de producto y el ADR nuevo están en
[ADR-020](../design/adr-020-dejar-holded-es-un-camino.md); aquí está lo que se hizo, lo que se
midió y lo que falla.

---

## 0 · Lo primero, porque cambia cómo se lee todo lo demás

**Peluquería Sole no puede dejar Holded hoy.** Lo dice la previsualización corriendo contra la
copia de producción del 24-09-2026:

```
puedeArrancar: False
 BLOQUEO ABONOS_EN_VUELO (6) — Hay 6 devolución(es) sin cerrar con Holded. El dinero ya salió
 del cajón, así que el abono TIENE que existir en su contabilidad…
```

Son las seis devoluciones del **10-09-2026**, todas en `SYNC_FAILED` con el mismo error:

```json
{"reason":"silent_reject","mismatches":[{"field":"total","actual":0,"expected":-9.6}]}
```

Holded aceptó el abono y le puso **total 0** en vez del negativo. Es un fallo del camino de
subida de abonos que **ya está en producción** y que este bloque no arregla: lo que hace es
impedir que el corte lo entierre. §9.1 dice qué hay que hacer con ellas antes de dar el corte.

Y arrastra además **dos filas `HoldedUpload` PENDING del 26-05** cuyo ticket ya no existe (los
purgó la activación del comercio). El sweeper las re-encola cada cinco minutos desde hace cuatro
meses. Ésas sí las cierra la acción sola.

---

## 1 · Lo que hay ahora

Una acción del super-admin en dos rutas:

```
GET  /super-admin/tenants/:id/dejar-holded   → el plan, de consultas reales
POST /super-admin/tenants/:id/dejar-holded   → lo aplica, recalculando el plan dentro
                                                de su propia transacción
```

El POST exige teclear el nombre del comercio. No es teatro: es la confirmación de un `DROP
DATABASE`, y lo que está en juego es el catálogo y la contabilidad de un negocio que está
vendiendo.

### 1.1 La forma final del dato

```prisma
model Tenant {
  holdedDisconnectedAt DateTime? @map("holded_disconnected_at")  // ADR-020 §3
}
```

Más dos cosas que Prisma no sabe declarar y viven en
`20260926000000_holded_desconectar/migration.sql`:

```sql
-- No se puede estar «a medio dejar».
ALTER TABLE tenants ADD CONSTRAINT tenants_holded_desconectado_ck CHECK (
  holded_disconnected_at IS NULL
  OR (holded_enabled = false AND holded_api_key_ciphertext IS NULL));

-- Y ninguna subida nace viva después del corte. REESCRIBE, no lanza (ADR-020 §6).
CREATE TRIGGER holded_uploads_no_tras_el_corte BEFORE INSERT ON holded_uploads …
```

### 1.2 Lo que hace el corte, en orden

Todo en **una** transacción de Postgres:

1. **Los SKU acuñados**, ANTES de convertir. Ése es el orden y no otro: el índice parcial sólo
   mira las filas `LOCAL`, así que mientras el catálogo sea de Holded los repetidos conviven y se
   arreglan de uno en uno. Al revés, la primera fila duplicada tumbaría la transacción con un
   P2002.
2. **`source = HOLDED → LOCAL`** con `updateMany`. Nunca `DELETE` + `INSERT`: de cada `id`
   cuelgan líneas de ticket, agenda, recursos, citas, modificadores y habilidades — seis claves
   ajenas, y `ticket_lines.product_id` es `ON DELETE SET NULL`.
3. **`sellableViaTpv` recalculado** sólo para las que ganan SKU (§4.2).
4. **`needsSkuReview = false`**: esa bandeja habla de Holded y ya no hay Holded.
5. **Las subidas huérfanas a `SKIPPED`.**
6. **El tenant**: interruptor apagado, clave y OAuth **borrados**, `initialSyncStatus =
   NOT_APPLICABLE`, fecha del corte puesta.

Y **después** del commit, fuera de la transacción porque Redis no hace rollback con Postgres:
quitar el repeatable del sync incremental y barrer los jobs vivos de ese comercio en seis colas.
Re-ejecutable: relanzar la acción sobre un comercio ya cortado no repite nada de la base —lo ve
por `holded_disconnected_at`— y vuelve a barrer.

---

## 2 · Las mediciones, sobre la copia real de producción

Copia `pg_dump -Fc` del **24-09-2026** restaurada en `mipiacetpv_ensayo_holded`. Todo agregado;
ningún dato personal sale de aquí.

### 2.1 El catálogo, y el bug del SKU

| Comercio | Fichas | Sin SKU | **SKU repetidos** | Grupos |
|---|---|---|---|---|
| Peluquería Sole | 86 | 0 | **0** | — |
| Librería Thalía | 974 | 1 | **55** | 8 (el mayor, **13**) |
| PRUEBAS MIPIACE | 101 | 0 | **26** | 3 (el mayor, **20**) |
| Cafetería Sirope | 191 | 0 | **6** | 3 (los tres, **del cliente**) |
| Frutos Secos Cachitos | 176 | 0 | 0 | — |
| Fouzia Attaoui Batah | 52 | 0 | 0 | — |

La causa es nuestra y está en ADR-020 §4.1: `buildAutoSku` toma los **ocho** primeros caracteres
del id de Holded, y esos ocho hex de un ObjectId **son el timestamp**. Todo lo creado el mismo
rato comparte SKU.

**Sole se salva por suerte**: 86 SKU distintos, ninguno vacío, así que su corte no acuña ni uno.
Los grupos de Thalía y PRUEBAS los re-acuña la acción sola. **Los tres de Sirope no**: `SKU215`
en la Coca-Cola y la Coca-Cola zero, `CAF-DES-03` y `CAF-DES-04` duplicados. Los escribió el
cliente y el corte de Sirope **no arrancará** hasta que los arregle.

### 2.2 Sole, comercio a comercio

| | |
|---|---|
| Fichas que se convierten | **86** (32 productos + 54 servicios), las 86 conservan su enlace |
| Líneas de ticket colgando de esos `id` | **399** |
| IVA sin resolver / archivados | 0 / 0 |
| Tickets | 270 `SYNCED`, 0 en vuelo · 8.333,95 € |
| Devoluciones | **6, todas `SYNC_FAILED`, todas el 10-09** |
| Subidas | 270 DONE, **2 PENDING huérfanas**, 6 FAILED |
| Contactos espejo de Holded | **41** |
| Fichas de cliente del CRM | **0** (`crmEnabled = false`) |
| Citas / servicios con agenda | **0 / 0** (`agendaEnabled = false`) |
| Fiado abierto | **0 €** |
| Turnos abiertos | 0 |
| Suelo fiscal | NIF `04165994G` + «Peluquería Sole» → **OK** |
| Terminales activos | 1, sin latido de A5 (APK desconocida) |

### 2.3 Las devoluciones de Sole, **en rojo**

El prompt pedía medir su patrón. Es éste:

| Mes | Tickets | Devoluciones |
|---|---|---|
| 2026-05 | 5 | 0 |
| 2026-06 | 103 | 0 |
| 2026-07 | 53 | 0 |
| 2026-08 | 28 | 0 |
| 2026-09 | 82 | **6** |

**Su patrón SÍ pisa el hueco del §6, y peor de lo que parece la media.** No devuelve «una y pico
al mes»: devuelve **cero durante cuatro meses y seis en una mañana**. El día que le vuelva a
pasar, Ana tendrá seis abonos seguidos sin documento, los seis de facturas que emitió Holded, y
los seis habrá que hacerlos a mano en Holded. La pantalla «Devoluciones · asesor» los lista, pero
**alguien tiene que mirarla**, y por eso el guion de despliegue (§9.4) lo pone por escrito en la
conversación con Sole.

---

## 3 · Decisiones tomadas sin preguntar

Las de dato y gobierno están en ADR-020. Aquí las de implementación.

### 3.1 Un módulo de silencio, no diecinueve `if`

El inventario de caminos que hablan con Holded dio **diecinueve**. Casi todos ya se protegían
solos con `if (!holdedApiKeyCiphertext)`, y el corte BORRA la clave: la llamada no sale ni con
guarda ni sin ella. Lo que la guarda añade en esos es el **motivo**, y el motivo importa porque
es lo que se lee:

```
[catalog-incremental] skip <tenant> (no-api-key)    ← mentira
[catalog-incremental] skip <tenant> (desconectado)  ← verdad
```

«no-api-key» en un comercio que dejó Holded dice «le falta la clave», que es un pendiente, e
invita a ponérsela. `holded/silencio.ts` tiene los tres motivos (`desconectado`, `no_lo_usa`,
`sin_clave`), su frase y su código HTTP, y falla hacia **cerrado** con 503 si no puede leer la
fila — al revés que `caja-gate.ts`, y por lo mismo que `catalogo-local-gate.ts`: ninguno de estos
caminos está en el de cobro, y fallar hacia abierto sería escribir en el ERP de un cliente que lo
dejó.

### 3.2 La carrera del corte, que sí necesitaba código

En `uploadTicket` y `uploadRefund` la guarda **no** es redundante. Un job puede estar
ejecutándose justo cuando la transacción hace commit: entra con clave y llega sin ella. Sin la
rama nueva caería en `no_holded_key` y `markFailed` pondría el ticket en `SYNC_FAILED` — un
ticket que estaba bien acabaría en la bandeja de errores del panel a los dos segundos de dejar
Holded, con nada que nadie pueda arreglar. Con ella, el upload queda `SKIPPED` y el ticket **no
se toca**.

En el abono importa más: un abono en `SYNC_FAILED` bloquea las devoluciones legítimas de esas
líneas hasta que alguien lo anule a mano (v1.5-consistencia-A §3.c).

### 3.3 El fiado vivo bloquea, y no estaba en la lista

El prompt nombra `PENDING_SYNC`, `SYNC_FAILED` y `HoldedUpload` pendiente. Un fiado con deuda
viva tiene la **misma** consecuencia y no estaba: variante B, un fiado no sube a Holded hasta que
se salda, así que si se salda después del corte su factura no llega nunca a la contabilidad. Es
un bloqueo más, con su mensaje. Sole tiene 0 €, pero Cafetería Sirope no será el único.

### 3.4 `sellableViaTpv` se recalcula, y con una regla que no adivina

Ni copiarlo ni ponerlo a `true` a lo bruto:

- Copiarlo dejaría **invisible para siempre** la ficha cuyo único problema era el SKU vacío, justo
  después de que la acción le diera uno. Y desde el panel no hay arreglo: `sellableViaTpv` no
  está entre los campos que acepta `PATCH /catalog/products/:id`.
- Ponerlo a `true` pondría a la venta **al 0 %** las fichas cuyo IVA el sync no pudo resolver.
  Ésas cobran de menos en cada ticket y el papel no lo canta.

La firma de «IVA sin resolver» es comprobable y sale de `upsertCatalogEntry`: cuando
`resolveTaxRate` devuelve null escribe `taxRate = 0` **y fuerza** `sellableViaTpv = false`. Un
exento real queda vendible, así que el par `(0, false)` sólo lo produce ese camino. Medido: 9
fichas en toda la copia, ninguna de Sole. Los archivados de Holded no se tocan.

### 3.5 Los contactos se conservan; qué ve Sole después (respuesta al §4 del prompt)

| Qué | Después del corte | Por qué |
|---|---|---|
| **Fichas de `Contact`** (41) | **Se conservan** | De ellas cuelga el pasado: `Ticket.contactHoldedId` resuelve el nombre del deudor en el listado de deudas y en la leyenda «PENDIENTE DE PAGO» del papel. Borrarlas dejaría fiados vivos sin nombre |
| **Buscar un contacto** (`GET /contacts/search`) | **Sigue** | Su rama local no llama a Holded; el *fallback* por teléfono sólo se dispara con clave. Los 41 históricos siguen encontrándose |
| **Crear contacto** (`POST /contacts`, import CSV) | **409** | Los dos crean el contacto **en Holded** antes de espejarlo. El del CSV es el que más engaña: suena a local y no lo es |
| **Fichas de cliente del CRM** | **Intactas**. Sole tiene 0 | `Client` es nuestro y su `holdedContactId` es un enlace perezoso (ADR-R2). No se toca ninguno |
| **Agenda** | **Intacta**. Sole tiene 0 citas | Cuelga del `id` del producto, y el `id` no cambia |
| **Fiado y listado de deudas** | **Intactos** | Los nombres salen de `Contact`, que se conserva. Y el corte no arranca con un fiado vivo, así que no queda ninguno a medias |
| **Email del ticket, AUTOMÁTICO** | **Deja de salir** | Depende de `contactHoldedId` (`email-trigger.ts:50`) y el cajero ya no puede asignar contacto: el panel no se monta (catalogo-local §14) |
| **Email del ticket, MANUAL** | **Sigue igual** | No depende del contacto. Y el PDF lo generamos nosotros desde B-Print, no Holded |

**Medido en Sole**: de sus 4 envíos de email en cinco meses, **uno** era automático y tres
manuales; y de sus 271 tickets, **uno** llevaba contacto. La pérdida es real y es de 1 entre 271.

### 3.6 `initialSyncStatus → NOT_APPLICABLE`

Es el estado que ADR-016 §4 inventó para «esto no aplica a este comercio», y además el que
`registerAllExistingRepeatables` y los checks `requires: "holded"` de la salud del onboarding ya
saben leer. Lo que el comercio sí sincronizó en su día sigue escrito en `lastIncrementalSyncAt`.

### 3.7 `TenantTax` y `SyncOutbox` no se tocan

`TenantTax` es el espejo del catálogo fiscal de Holded. Después del corte nadie lo lee —el
`taxRate` del producto ya es un decimal concreto (ADR-017 §3.2) y el alta local usa una lista
fija— y borrarlo no gana nada. `SyncOutbox` está **muerta**: 0 filas en producción y ni una
referencia en el código.

---

## 4 · Los cuatro fallos que este bloque encontró y arregla

Ninguno estaba en el prompt.

### 4.1 La barra roja del TPV le mentía al comercio sin Holded

`catalogo-local` §2.15 dice que arregló «la barra roja "Holded está desconectado"». Arregló **la
del admin** (`AdminShell.tsx::HoldedHealthBanner`, gateada por `cajaEnabled && holdedEnabled`).
**La del TPV se quedó sin gatear**, y es la que ve la cajera todo el día:

> **Holded desconectado ·** La cuenta de Holded no está conectada. Puedes seguir cobrando: los
> tickets se guardan y se subirán solos cuando el propietario la reconecte. Avísale cuanto antes.

Las cuatro afirmaciones son falsas en el comercio de este bloque —y lo eran ya en el de
catalogo-local, que lo hereda sin haberlo estrenado. Se arregla en `getTenantHealthStatus`, no en
el componente: el endpoint lo consumen el TPV y el panel, y arreglar sólo uno dejaría la misma
pregunta contestada de dos maneras. Nace el motivo `no_aplica` con `level: "ok"`.

### 4.2 El propietario podía resucitar Holded él solo

`POST /auth/me/rotate-holded-key` es `requireOwner` y **no tenía ninguna guarda**. Ana podía
pegar una clave y el sync le desharía los precios que acababa de poner. Se comprueba **antes** de
validar la clave contra Holded: no se gasta ni una llamada.

### 4.3 El sweeper no filtraba por comercio

`upload-sweeper.ts` barría `status = PENDING` de **toda la base**, sin ningún filtro de tenant.
En la copia de producción eso son las dos filas del 26-05 de Sole, sin ticket detrás,
re-encoladas cada cinco minutos desde hace cuatro meses. Ahora filtra
`tenant: { holdedDisconnectedAt: null }` — y NO por «tiene clave», a propósito: el comercio que
todavía no la ha conectado sí tiene que seguir barriéndose, porque su clave puede llegar mañana.

### 4.4 Un botón que mentía, y lo encontró el bucle visual

Después del corte, la consola pintaba **«Encender Holded» habilitado** y el servidor lo rebotaba
con un 409. Ahora sale deshabilitado, y la métrica «Holded» distingue «Lo dejó · 26/9/2026» de
«No lo usa». No lo cazó ningún test: lo cazó la captura `06-cortado-ap12.png`.

---

## 5 · El inventario del criterio 3, los diecinueve caminos

| # | Camino | Qué lo calla | Test |
|---|---|---|---|
| 1 | Sync inicial (`runInitialSync`) | `motivoSilencio` + `InitialSyncSkippedError` nuevo | silencio |
| 2 | Sync incremental (`runIncrementalSync`) | `motivoSilencio` | silencio |
| 3 | Conciliación de catálogo (`runCatalogReconcile`) | `motivoSilencio` | silencio |
| 4 | Conciliación diaria (`reconcileTenant`) | `motivoSilencio` + línea de log | silencio |
| 5 | Subida de ticket (`uploadTicket`) | rama `holdedDisconnectedAt` → `SKIPPED` | silencio |
| 6 | Subida de abono (`uploadRefund`) | ídem | silencio |
| 7 | Sweeper de huérfanos | filtro por tenant | silencio |
| 8 | Caché de imágenes (`processImageCacheJob`) | salida temprana | silencio |
| 9 | Backfill de imágenes | filtra `source = HOLDED`: tras el corte no hay candidatos | e2e (implícito) |
| 10 | Repeatable de 15 min | `unregisterTenantRepeatable` en el vaciado | colas + ensayo |
| 11 | `POST /catalog/sync-now` | `ensureHoldedVivo` | e2e |
| 12 | `POST /catalog/sku-review/:id/assign` (PUT a Holded) | `ensureHoldedVivo` | e2e |
| 13 | `POST /contacts` | `ensureHoldedVivo` | — |
| 14 | `POST /admin/contacts/import` | `motivoSilencio` | — |
| 15 | `GET /contacts/search` | sin clave no hay *fallback*; la rama local **sigue viva a propósito** | — |
| 16 | `POST /super-admin/tenants/:id/resync` | `motivoSilencio` | ensayo |
| 17 | `PATCH /super-admin/tenants/:id/holded-api-key` | puerta de la vuelta | e2e |
| 18 | `POST /auth/me/rotate-holded-key` | puerta de la vuelta | e2e |
| 19 | `PATCH /super-admin/tenants/:id` con `holdedEnabled: true` | puerta de la vuelta | e2e |
| — | Bandeja de errores · `retry-sync` (×2) | `ensureHoldedVivo` | — |
| — | `dedupe-tags` | **no toca Holded**: normaliza `products.tags` en local. Se deja | — |
| — | Conciliación y corte de día (repeatables globales) | no se desregistran: son globales y dejarían sin conciliación a los otros cinco | — |
| — | `ticket-email` | **no toca Holded** desde B-Print: el PDF lo generamos nosotros. Un envío pendiente sigue su curso, y debe | — |

Y por debajo de todo, dos cosas que no son `if`: la **clave borrada** y el **CHECK** que impide
que vuelva sin limpiar la fecha.

---

## 6 · Las devoluciones después del corte (criterio 5)

Los dos casos, leídos en el código y comprobados sobre la copia real.

**(a) Un ticket cobrado ANTES del corte.** Lo facturó Holded (`holded_document_id` poblado) y
sigue en `SYNCED`, que es uno de los dos estados que `POST /refunds` acepta. La devolución
**funciona**: nace `PAID` (`paidTicketStatus(NONE)`), con su método y su turno, **sin fila
`HoldedUpload`** y sin encolar nada. El dinero sale del cajón y el arqueo cuadra.

**(b) Un ticket cobrado DESPUÉS del corte.** Es una factura simplificada VERI*FACTU nuestra. Su
abono sería una **factura rectificativa**, y las rectificativas son V3 (verifactu-1-done §9): no
existen. `POST /refunds` no toca nada fiscal, así que tampoco se cae — el ticket está en `PAID`,
que también acepta.

**Ninguno acaba en `SYNC_FAILED` eterno ni en un 500.** Lo comprobado en el ensayo, sobre la
copia real:

```
ticket original: 000278 | doc Holded: T261183 | total 19.2
POST /refunds → 201
abono: {"internalNumber":"R-000280","status":"PAID","total":"19.2","method":"CASH","shiftId":"…"}
fila HoldedUpload del abono: NINGUNA
arqueo: grossSales 7.43 · refundsTotal 19.20 · netSales −11.77 · cashTheoretical −11.77
```

**Lo que falta, y falta de verdad:** el documento de abono. En (a) tiene que ir a Holded y
mipiacetpv ya no escribe allí; en (b) sería una rectificativa que no existe. Eso no se puede
tapar con código, así que se pone delante de quien tiene que hacerlo:

`GET /admin/devoluciones/para-el-asesor` y la pantalla **«Devoluciones · asesor»**, que sólo
aparece en un comercio que dejó Holded. Clasifica cada abono en tres, y los tres son derivables
sin ninguna columna nueva:

- `holded` — el ticket tiene `holded_document_id`. El asesor crea el abono allí, contra ese
  número.
- `mipiacetpv` — el ticket tiene su `FiscalRecord` de ALTA. Falta la rectificativa.
- `sin_registro` — **ni una cosa ni la otra**: cobrado después del corte y sin registro fiscal.
  Es un terminal con APK anterior a verifactu-1, y el asesor tiene que verlo **como lo que es**,
  no como «una factura nuestra».

El orden de las tres preguntas es la decisión: primero Holded, porque una venta anterior al corte
no **puede** tener registro fiscal (`emiteMipiacetpv` era false entonces); la ausencia de los dos
es el tercer caso y no «el segundo por defecto».

---

## 7 · Tabla de sabotaje

Cada fila: se rompe la guarda a mano, se corre el test que la cubre y se mira que se ponga rojo.
**Las 27 están verificadas**, una a una, con el script del scratchpad: rompe, corre, mira el rojo y restaura.

| # | Sabotaje | Test que cae |
|---|---|---|
| 1 | El catálogo NO cambia de dueño (`data: {}` en vez de `source: LOCAL`) | e2e · criterio 1 |
| 2 | Quitar la guarda de ventas en vuelo | e2e · «un ticket en PENDING_SYNC bloquea» |
| 3a | Quitar `motivoSilencio` del sync incremental | silencio · motivo `desconectado` |
| 3b | …de la conciliación de catálogo | silencio |
| 3c | …del sync inicial | silencio |
| 3d | …de la conciliación diaria | silencio · la línea del log |
| 3e | Quitar la rama del corte de `uploadTicket` | silencio · el ticket no acaba en SYNC_FAILED |
| 3f | …de `uploadRefund` | silencio |
| 3g | Quitar el filtro por tenant del sweeper | silencio |
| 3h | Quitar la salida temprana del worker de imágenes | silencio · no sale ni un `fetch` |
| 4a | Acuñar el SKU con los **8** primeros caracteres (el bug original) | plan · dos ids del mismo segundo chocan |
| 4b | No bloquear el SKU duplicado del cliente | plan |
| 5 | `holdedProductId: null` al convertir | e2e |
| 6 | Recrear las fichas (`delete` + `create`) en vez de actualizarlas | e2e · agenda, modificadores y líneas |
| 7 | Encolar la devolución pese a no haber destino | e2e |
| 8 | Quitar el filtro por tenant al convertir el catálogo | e2e · el vecino |
| 9 | Relanzar mueve la fecha del corte | e2e |
| — | No crear el trigger de `holded_uploads` | e2e · la subida forzada nace PENDING |
| — | Quitar el CHECK de «a medio dejar» | e2e |
| — | Quitar `ensureHoldedVivo` de `sync-now` | e2e |
| — | Dejar reencender el interruptor | e2e · la puerta de la vuelta |
| — | Dejar pegar una clave nueva (super-admin) | e2e |
| — | Dejar al propietario rotar la clave | e2e |
| — | No recalcular `sellableViaTpv` | e2e |
| — | Quitar la rama `no_aplica` de la salud | salud |
| — | Dejar de quitar el repeatable | colas |
| — | Barrer jobs de otro comercio | colas |

### 7.1 Los cuatro que salieron VERDES, que es el hallazgo

Cuatro sabotajes **no pusieron nada en rojo** a la primera, y eso es lo que el método existe para
cazar:

- **3a, 3b y 3d.** Quitar `motivoSilencio` de los dos syncs y de la conciliación diaria no rompía
  nada, y **no era un fallo del test**: esos tres ya se protegían solos con
  `if (!holdedApiKeyCiphertext)`, y el corte borra la clave. Lo que la guarda añade ahí es el
  **motivo**, no el silencio. Los tests se reescribieron para afirmar el motivo
  (`reason: "desconectado"`, y para la conciliación diaria la **línea del log**, que es lo único
  observable). Ver la nota larga en la cabecera de `holded-desconectar-silencio.test.ts`.
- **«No recalcular `sellableViaTpv`».** El unitario probaba la función pura y nadie probaba que
  la **acción** la aplicara. Se añadió un e2e con las tres fichas: la que gana SKU, la del IVA sin
  resolver y el exento real.
- **«La puerta de la vuelta».** Los tres caminos de reconexión sólo estaban comprobados a mano en
  el ensayo. Se añadieron tres e2e que afirman el **código y el mensaje**, no sólo «no pasó»: sin
  la guarda, el CHECK lo impediría igual pero como un 500 de Prisma que nadie sabría leer.

### 7.2 Lo que el nº 6 enseña de paso

El sabotaje «recrear en vez de actualizar» se escribió como `delete` + `create` conservando todos
los campos menos el `id`. Cae **antes** de llegar al assert: `appointment_items.service_id` es
`ON DELETE RESTRICT`. La base ya defendía la mitad de este criterio; lo que el test añade es la
otra mitad — que la agenda, los modificadores y la línea de ticket sigan apuntando al **mismo**
`id`.

---

## 8 · El ensayo general, sobre la copia REAL

Copia de producción del 24-09 en `mipiacetpv_ensayo_holded`, API levantada contra ella, y
**Holded simulado**: un proceso en `127.0.0.1:4599` que anota en un fichero cualquier petición que
le llegue y contesta 503. Que exista ese centinela es lo que permite afirmar «no sale ni una
llamada»: si saliera, estaría escrita.

### 8.1 Lo que pasó, en orden

1. **La precondición de verifactu-1 ABORTÓ la migración**, a propósito y como su done §7.2 avisa:
   `Cafetería Sirope` tiene **5** terminales activos en la misma caja y `Frutos Secos Cachitos`
   **3**. Sole tiene 1. Es un hallazgo del despliegue de **verifactu-1**, no de éste, y §9.1 lo
   pone como paso previo.
2. Resuelto (un terminal por caja, el de último latido), las dos migraciones entran limpias.
3. **La previsualización de Sole bloquea** por los 6 abonos rotos (§0).
4. Se resuelven como los resolverá el implantador: crear el abono en Holded y cerrarlo desde la
   bandeja con `POST /admin/refunds/:id/mark-resolved` pegando el id del documento. Bandeja a 0.
5. **El corte**, por HTTP, con el nombre mal escrito primero (`409 CONFIRMACION_NO_COINCIDE`) y
   bien después:

```json
{"ok":true,"cortado":true,"productosConvertidos":86,"skuAcunados":[],
 "subidasHuerfanasCerradas":2,
 "colas":{"porCola":{...todas 0},"repeatableQuitado":true,"errores":[]}}
```

### 8.2 La foto antes → después

El `diff` completo de las doce consultas de `foto.sql` es **exactamente** esto y nada más:

- Sole: `holded_enabled f`, sin clave, `holded_disconnected_at` puesto, sync `NOT_APPLICABLE`.
- Sus 86 fichas pasan de `HOLDED` a `LOCAL`. **Todo lo demás idéntico**: 32/54 por tipo, 0 sin
  SKU, 32/54 activas, 32/54 vendibles, 0 archivadas, 32/54 con enlace, 32/54 SKU distintos.
- Sus 2 subidas huérfanas: `PENDING → SKIPPED`.
- Tickets: **sin un solo cambio** (270 `SYNCED`, 8.333,95 €). Contactos: 41. Turnos: 0.

Y el md5 del catálogo de cada comercio, calculado campo a campo:

| Comercio | Antes | Después del ensayo completo |
|---|---|---|
| Cafetería Sirope | `40aec975…` | `40aec975…` |
| Fouzia Attaoui Batah | `70ae6854…` | `70ae6854…` |
| Frutos Secos Cachitos | `40d23824…` | `40d23824…` |
| Librería Thalía | `ef67e345…` | `ef67e345…` |
| PRUEBAS MIPIACE | `caef8ae4…` | `caef8ae4…` |
| **Peluquería Sole** | `0a054939…` | `d64cfe27…` |

Los cinco vecinos, **idénticos al byte** después del corte, de una edición de precio, de una
venta, de una devolución, de cinco rutas rechazadas y de un job rezagado. Criterio 8.

### 8.3 Después del corte, sobre la misma copia

```
1 · Ana edita el precio      AMPOLLA PLACENTA (source LOCAL) 4,64 → 6,14 · PATCH 200
2 · el TPV lo ve             86 fichas · priceGross esperado 7,43 · recibido 7,43
    la salud                 {"level":"ok","reason":"no_aplica"}      ← la barra roja, fuera
3 · /tpv/fiscal/head         {"emite":true,"nif":"04165994G","serie":"C1",…}
    cobro                    ticket 000279 PAID 7,43 €
    registro fiscal          C1/000001 · chainStatus OK · huella B827B8FB…
    HoldedUpload             NINGUNA
4 · devolución del 000278    R-000280 PAID 19,20 € CASH, en su turno · HoldedUpload NINGUNA
5 · listado del asesor       1 abono, origen `holded`, contra el documento T261183
6 · arqueo                   7,43 − 19,20 = −11,77 · cashTheoretical −11,77
```

### 8.4 Y el centinela de Holded, al final de todo

```
2026-09-26T18:43:58.078Z GET /probe     ← mi propia comprobación de que el centinela escucha
```

**Una sola línea, la mía.** Ni una llamada a Holded en todo el ensayo, con estas cinco rutas
rechazadas por el camino, cada una con su frase:

| Ruta | Respuesta |
|---|---|
| `POST …/resync` (super-admin) | `409 HOLDED_DESCONECTADO` |
| `POST /catalog/sync-now` (propietario) | `409 HOLDED_DESCONECTADO` — y **no** «Conecta tu cuenta…» |
| `POST /auth/me/rotate-holded-key` | `409` **antes** de validar la clave: ni una llamada gastada |
| `PATCH …/holded-api-key` | `409` con la fecha del corte en el mensaje |
| `PATCH …` con `holdedEnabled: true` | `409` con la fecha del corte |

Y el repeatable: **5 en Redis, no 6.** El de Sole ya no está. Un job rezagado encolado a mano
después del corte:

```
[catalog-incremental] skip e3803db0-… (desconectado)
[catalog-incremental] job ensayo-rezagado-… (manual) ok      ← «ok», no «falló»
```

---

## 9 · El guion de despliegue

**Nada de esto se ha desplegado.** Este bloque necesita que **verifactu-1 esté desplegado
antes**: el corte enciende al comercio como emisor y sin su migración no hay serie ni número de
instalación.

### 9.1 Antes de tocar nada (días antes)

```bash
# 1 · La precondición de verifactu-1. Si devuelve filas, la migración ABORTA.
psql "$DATABASE_URL" -f docs/blocks/holded-desconectar-ensayo/precondicion-verifactu.sql
#    → hoy: Sirope 5 terminales, Cachitos 3. Se revoca desde el admin, uno por caja.
#      Sole tiene 1: no le afecta.

# 2 · La foto ANTES, entera. Se guarda.
psql "$DATABASE_URL" -f docs/blocks/holded-desconectar-ensayo/foto.sql > antes.txt
```

**Y lo de Sole en particular:** sus **6 devoluciones del 10-09 en `SYNC_FAILED`**. El dinero salió
del cajón en septiembre, así que su abono tiene que existir en su contabilidad. Para cada una:

1. Crear el abono a mano en Holded contra la factura original.
2. Cerrarlo en el panel → «Holded» (bandeja de errores) → **Marcar resuelto**, pegando el id del
   documento de Holded.

Hasta que la bandeja esté a 0, «Dejar Holded» no arranca. **Y está bien que no arranque.**

### 9.2 El despliegue

```bash
# 3 · Migraciones. La de verifactu-1 puede abortar: ver el paso 1.
pnpm --filter @mipiacetpv/db run migrate:deploy
#    Si aborta y hay que relanzarla después de revocar terminales:
#      packages/db/node_modules/.bin/prisma migrate resolve --rolled-back 20260924000000_verifactu_1_registro
#    (el `npx prisma` de la raíz se baja la v8 y no entiende `migrate`)

# 4 · Se comprueba que el corte todavía NO se ha dado en nadie.
psql "$DATABASE_URL" -c "select name, holded_disconnected_at from tenants order by 1"
#    → todas NULL.
```

Servidor y APK: el corte **no** necesita APK nueva por sí mismo, pero la factura simplificada sí
(verifactu-1 §7.1). El terminal de Sole tiene que tener la APK con verifactu-1 **antes** del
corte, o cobrará sin generar registro. La previsualización enseña su versión y su último latido.

### 9.3 El corte, con la tienda cerrada

1. Super-admin → la ficha del comercio → **Dejar Holded**.
2. **Leer la previsualización entera.** Si hay bloqueos, no hay botón: se resuelven y se vuelve a
   comprobar.
3. Teclear el nombre del comercio y confirmar.
4. Comprobar, en este orden:
   ```bash
   psql "$DATABASE_URL" -f docs/blocks/holded-desconectar-ensayo/foto.sql > despues.txt
   diff antes.txt despues.txt
   ```
   **Se para y se llama a soporte si** el diff toca a cualquier comercio que no sea el del corte,
   si el md5 del catálogo de un vecino cambia, o si quedan filas `PENDING` en `holded_uploads`.
5. En el panel del cliente → **Catálogo**: sus fichas salen con «Editar» y sin «De Holded».
6. Cambiar un precio y verlo en el TPV.
7. Cobrar **una** venta de prueba y comprobar que el ticket lleva su registro fiscal
   (super-admin → la ficha → Facturación (VERI*FACTU) → la caja con 1 registro y «Íntegra»).
8. Mirar el TPV: **no** debe haber barra roja de Holded.

Si el paso de las colas dio errores (Redis caído), el corte **ya está hecho**: se vuelve a pulsar
«Dejar Holded», que es idempotente, y remata.

### 9.4 Lo que hay que decirle a Sole ANTES

Por escrito, y con acuse:

1. **La numeración de sus facturas cambia.** Desde el corte, cada ticket es una **factura
   simplificada VERI*FACTU** emitida por mipiacetpv con serie propia (`C1`) y numeración que
   empieza en 1. La numeración de Holded se queda donde está.
2. **Deja de usar Holded para facturar.** Sus ventas ya no aparecen allí. Lo anterior al corte
   sigue en Holded, intacto.
3. **Sus precios los cambia ella**, desde Catálogo, y llegan al TPV al momento. Es lo que pidió el
   25-09.
4. **Las devoluciones necesitan un paso a mano.** Cuando devuelva algo, el dinero sale de la caja
   y el arqueo cuadra, pero **el documento de abono lo tiene que hacer su asesor**. La pantalla
   «Devoluciones · asesor» le da la lista para pasársela. Y hay que decirle que revise esa
   pantalla, porque su patrón es de cero durante meses y seis en una mañana (§2.3).
5. **No hay vuelta atrás desde el panel.** Volver a Holded es una operación que hoy no existe.

---

## 10 · Estado de la suite

```
pnpm test  (desde la raíz)   255 ficheros · 2.765 tests · 3 skipped · TODO VERDE
pnpm --filter @mipiacetpv/api test:e2e   21 ficheros · 331 tests · TODO VERDE
```

La e2e se corrió contra **su propia base**, `mipiacetpv_dh_e2e` (la suite hace `DROP SCHEMA
public`; no se comparte entre worktrees):

```bash
docker compose exec -T postgres psql -U mipiacetpv -c "CREATE DATABASE mipiacetpv_dh_e2e;"
E2E_DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@127.0.0.1:5432/mipiacetpv_dh_e2e' \
  pnpm --filter @mipiacetpv/api test:e2e
```

### 10.1 Dos tests ajenos que este bloque tuvo que tocar, y por qué

- **`h1-caja-gate.test.ts`** cuenta las rutas con `ensureCajaEnabled` buscando
  `/, ensureCajaEnabled\]/`, es decir, exigiendo que sea **la última** del array. Al añadir
  `ensureHoldedVivo` detrás, `catalog/routes.ts` «cayó» de 5 a 3 sin que ninguna ruta perdiera su
  puerta. El patrón pasa a `/, ensureCajaEnabled[\],]/`: lo que ese guardia vigila es que la
  puerta esté puesta, no en qué orden.
- **`admin-tickets-errors-route.test.ts`** no tenía modelo `tenant` en su doble de Prisma.
  `cajaIsDisabled` es tolerante y se lo tragaba; `comprobarSilencio` no lo es y devolvía 503 —
  que es su fallo **correcto**, hacia cerrado, pero aquí escondía el test. El doble ahora dice
  quién es el tenant.

---

## 11 · Qué NO cubre la suite

1. **El hierro.** Ni AP11 ni AP12. La rejilla del TPV, la pantalla de «Dejar Holded» y el papel
   de una factura simplificada de Sole no se han visto en un terminal real.
2. **Holded de verdad.** Todo el ensayo va contra el centinela. Que Holded no reciba nada está
   probado por ausencia de tráfico desde nuestro lado, no por mirar su panel.
3. **El corte con tráfico real encima.** La transacción toma `SELECT … FOR UPDATE` sobre el
   tenant, pero nadie ha cobrado *mientras* se ejecutaba. La carrera que sí está cubierta es la
   otra: un job de subida ejecutándose en el momento del commit (§3.2), y en unitario.
4. **El vaciado de colas contra Redis de verdad.** Los tests usan colas falsas; el ensayo lo
   ejecutó contra Redis pero con las colas ya vacías. Lo que sí se comprobó con Redis real es que
   el **repeatable** desaparece (5 en vez de 6).
5. **La consola super-admin a 320 px.** No cabe, y no por este bloque: ver el README de las
   capturas.
6. **El listado del asesor con volumen.** Tope de 1.000 filas y sin paginar. Con el patrón de
   Sole sobran; con un comercio que devuelva a diario, no.

---

## 12 · Lo que este bloque deja preparado para la vuelta a Holded

Está escrito aparte porque es el bloque siguiente:

- **`holded_product_id` intacto** en todas las fichas, con `source = LOCAL`. Es el casamiento
  directo, sin pasar por el SKU.
- **El SKU final de cada ficha**, y el anterior de las re-acuñadas, en el `metadata` de la fila de
  auditoría `dejar_holded`.
- **`holded_disconnected_at`**, que es la frontera: lo cobrado después es de mipiacetpv y no debe
  subir nunca (forward-only, ADR-017 §6).
- **La puerta cerrada por los tres caminos** (ADR-020 §5), para que nadie reconecte sin ese
  bloque. Lo primero que tendrá que hacer es decidir qué hace con esa columna: limpiarla borraría
  la frontera del abono.

Y lo que tendrá que resolver y aquí no se ha tocado: qué pasa con las fichas locales que el
comercio haya creado **después** del corte (ésas sí necesitan el casamiento por SKU), y qué se
hace con el periodo local en la contabilidad.

---

## 13 · Frontera (no se ha cruzado)

No se ha tocado el camino de cobro salvo las dos ramas del §3.2. No se ha borrado ni fusionado
ninguna ficha, ningún contacto, ningún ticket y ningún abono. No se ha tocado `TenantTax`. No se
ha hecho la vuelta a Holded. No se han emitido registros Verifactu de nada anterior al corte. No
se ha renombrado nada a `ErpAdapter`. No se ha hecho responsive la consola super-admin.

---

## 14 · Commits

```
3534bb4 feat(holded-desconectar): la fecha del corte, su CHECK y su trigger
9b0926f feat(holded-desconectar): la acción, con su previsualización
dd60698 feat(holded-desconectar): Holded se calla, por los diecinueve caminos
52496ed feat(holded-desconectar): la barra roja del TPV, y el listado del asesor
b15127e feat(holded-desconectar): la pantalla de «Dejar Holded» y la del asesor
569050b test(holded-desconectar): 27 sabotajes, y los cuatro que salieron verdes
4eb3232 docs(holded-desconectar): el done, el ensayo sobre prod y 23 capturas
```

---

## 15 · Relación con otros documentos

- [ADR-020](../design/adr-020-dejar-holded-es-un-camino.md) · las decisiones de dato y gobierno,
  y qué cambia de ADR-017.
- [ADR-017](../design/adr-017-el-catalogo-tiene-autoridad-local.md) · `source`, el interruptor y
  el índice parcial del SKU. Su §4.1 queda **enmendado** por ADR-020 §5.
- [ADR-019](../design/adr-019-cada-caja-es-un-sif.md) y
  [verifactu-1-done](./verifactu-1-done.md) · quién emite la factura desde el corte. Su §9 dejaba
  anotado «desconectar Holded en un comercio que ya lo tiene (bloque aparte)»: esto es ese bloque.
- [catalogo-local-done](./catalogo-local-done.md) · el comercio que NACE sin Holded. Su §14 quitó
  el panel de contacto y el fiado del TPV; §3.5 de aquí dice qué queda de eso en el que lo deja.
- [`holded-desconectar-shots/`](./holded-desconectar-shots/) · el bucle visual.
- [`holded-desconectar-ensayo/`](./holded-desconectar-ensayo/) · el SQL del ensayo y del
  despliegue.

**Ni push ni merge a master: eso lo hace Matías.**
