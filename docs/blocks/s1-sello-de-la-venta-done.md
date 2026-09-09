# Bloque S1 · El sello de la venta — DONE

Origen: `docs/code-prompts/bloque-s1-sello-de-la-venta.md`.
Manda: `docs/design/adr-015-sello-de-la-venta.md`.
Hallazgos: `docs/auditorias/2026-09-05-inalterabilidad-datos-venta.md`.
Frontera legal: `docs/legal/posicion-verifactu.md`.

**La premisa "nuestro TPV por definición no permite modificar los datos" era cierta para el
cajero y falsa fuera de la aplicación.** No había un solo trigger, `REVOKE` ni regla en ninguna
migración del repo: un `UPDATE tickets SET total = ...` desde el VPS pasaba sin dejar rastro.
Este bloque mueve la garantía de la disciplina de la aplicación al **motor de base de datos**.

Suite antes de empezar: **173 ficheros, 1534 tests** (+3 skipped legacy de Redis), e2e **12
tests**. Suite al cerrar: **176 ficheros, 1557 tests** (+3 skipped), e2e **22 tests**.
`tsc --noEmit` limpio en api, admin y tpv-web; `vite build` del admin verde.

Revisión posterior en Cowork (2026-09-09): tres arreglos aplicados sobre esta misma rama antes de
commitear — `shift_id` dentro del sello (§2.4), `archiveZReport` capturado en los dos cierres
(§2.8) y el `@@index` de `TicketCorrection` declarado en el modelo (§2.10).

---

## 1 · Lo que hay ahora

| Pieza | Dónde |
|---|---|
| Sello de la venta (`sealed_hash`, `sealed_at`) | `tickets` · cálculo en `apps/api/src/tickets/seal.ts` |
| Lista canónica de columnas económicas | `packages/db/src/sealed-fields.ts` |
| Triggers de Postgres | `packages/db/prisma/migrations/20260909000000_s1_sello_de_la_venta/migration.sql` |
| Vía de corrección | tabla `ticket_corrections` + `record_ticket_correction(...)` · cliente en `apps/api/src/tickets/corrections.ts` |
| Z congelado | tabla `shift_z_reports` · `apps/api/src/shift/z-seal.ts` |
| Vista de correcciones | `GET /admin/tickets/:id/corrections` + panel en `TicketsErrorsPage.tsx` |

Migración **aditiva**: no toca ni una fila existente, no necesita ventana de mantenimiento.

---

## 2 · Las decisiones, tomadas sin preguntarlas una a una

### 2.1 El mecanismo de la vía de corrección: función `SECURITY DEFINER` + coincidencia por `txid_current()`

El prompt dejaba elegir entre rol separado, `SECURITY DEFINER` u otro mecanismo. **Elegido:
una función `record_ticket_correction(...)` que hace las tres cosas en una sola llamada** — lee
el valor anterior del propio motor, inserta la fila de traza y ejecuta el `UPDATE`— y un trigger
que sólo abre la puerta si existe una fila de `ticket_corrections` con **el mismo
`txid_current()`** para esa tabla, esa fila y esa columna.

Por qué así y no de otra forma:

- **Rol separado, descartado por ahora.** Obliga a gestionar una segunda credencial en el VPS y
  a tocar el despliegue, y no compra nada que el `txid` no compre ya. La función queda declarada
  `SECURITY DEFINER` con `search_path` fijo precisamente para que el día que se despliegue un rol
  de aplicación sin `UPDATE` sobre las tablas económicas lo único que haga falta sea un
  `GRANT EXECUTE`. La frontera ya está donde tiene que estar; el `REVOKE` no entra en este bloque
  (ver §6).
- **La traza y el cambio son la misma transacción por construcción.** No es que el código
  "recuerde" escribir el log: es que sin la fila de log el `UPDATE` revienta, y si la transacción
  hace rollback se van las dos cosas juntas. No hay ventana en la que exista una sin la otra.
- **Granularidad por columna.** El trigger exige una corrección **por cada columna que cambia**.
  Una corrección no es un permiso general para tocar la fila.
- **La aplicación no escribe columnas selladas nunca.** `edit-line-sku` y `backfill-vuelta` llaman
  a la función; no queda ni un `ticketLine.update` ni un `ticketPayment.update` sobre datos
  sellados en todo el repo.

`ticket_corrections` es **append-only por trigger**: `UPDATE` y `DELETE` denegados. Una traza que
se puede editar vale lo mismo que no tenerla.

**El motivo es obligatorio en tres capas**: `CHECK (btrim(reason) <> '')` en la tabla, `RAISE
EXCEPTION CORRECCION_SIN_MOTIVO` en la función, y `required: ["reason"]` en el schema del endpoint
del admin. La de abajo es la que manda; las otras dos dan mensajes en el idioma del usuario.

### 2.2 Se corrige el dato, **no** se recalcula el sello

Después de una corrección, `sealed_hash` **ya no cuadra** con la fila. Es deliberado: el sello es
la prueba de cómo se cobró, y reescribirlo borraría exactamente lo que hay que poder demostrar.
La regla de lectura queda escrita aquí:

> hash que no cuadra **+ correcciones en la tabla** = corrección explicada.
> hash que no cuadra **y ninguna corrección** = alguien tocó la base por debajo del motor.

### 2.3 Orden determinista de líneas y pagos: **por `id` ascendente**

`TicketLine` no tiene columna de orden y este bloque **no cambia el modelo** (ADR-015 §4.1, y la
línea ya es un snapshot inmutable por diseño). De los criterios disponibles, la PK es el único a
la vez único, presente desde el `INSERT` e inmutable: ordenar por importe empata, por `sku` empata
en cuanto se venden dos cafés, y "el orden en que llegaron" no existe como dato. Con la PK, dos
verificaciones del mismo ticket en momentos distintos leen la misma secuencia.

Los importes entran en el hash **con la escala exacta de su columna** (`12.3` y `12.3000` son el
mismo dinero y tienen que dar el mismo sello), y los JSON anidados —`modifiers`, `meta`— se
canonicalizan con las claves ordenadas, porque Postgres los devuelve en el orden que le apetece.
La versión del formato (`v: 1`) va **dentro** del hash.

### 2.4 Qué entra en el sello

`internal_number`, **`shift_id`**, `total`, `total_tax`, `total_discount`, `cash_amount`,
`paid_at`, las `TicketLine` completas (incluido **`sku`**, que es lo que identifica qué se vendió,
y `modifiers`, que lleva los `priceDelta`) y los `TicketPayment` de la venta.

**`shift_id` es económico aunque no sea un importe** (revisión de Cowork). `loadShiftBreakdownSums`
agrupa los pagos por `ticket: { shiftId }`, así que un `UPDATE tickets SET shift_id` mueve la venta
entera de un Z a otro sin tocar un euro; y dejarlo fuera era incoherente con
`ticket_payments.collected_in_shift_id`, que sí estaba sellado. No estorba a nadie: la imputación
(`shift/impute.ts`) decide el turno **antes** de crear el ticket y no hay un solo `ticket.update`
en el repo que escriba esa columna — los seis sitios que la escriben son `ticket.create`.
Entra en el trigger **y en el hash**: si sólo estuviera en el trigger, la lista significaría dos
cosas distintas y una corrección del turno dejaría el sello cuadrando.

`credit_pending` **fuera** (ADR-015 §5.1). Y `notes`, `attended_by`, `contact_holded_id` y los
campos de intención tampoco: no son el dato económico, y meterlos convertiría cada corrección
tipográfica en un incidente.

### 2.5 Los tres caminos de entrada, y el cuarto que no lo era

- `POST /tickets` — venta rápida **y el ingreso diferido del outbox offline**. Es la misma puerta:
  el ticket que llega dos horas tarde se sella al llegar, con `sealed_at` de AHORA aunque
  `occurred_at` sea de hace dos horas.
- `POST /tickets/:id/checkout` — cobro de mesa. El sello va al final de la transacción, después de
  reescribir los pagos: eso sólo es legal mientras el ticket no está sellado, y por eso el orden
  importa.
- `POST /tickets/:id/credit-payments` — **el fiado se sella al SALDARSE, no al venderse.** Su
  `paid_at` es la fecha del saldo (variante B: es la fecha fiscal que recibe Holded), y `paid_at`
  es columna sellada. Mientras hay deuda viva la venta no está cobrada y no está sellada; los
  cobros parciales entran como filas nuevas sobre un ticket todavía sin sellar, que es exactamente
  lo que dice ADR-015 §5.1.

### 2.6 El trigger es distinto en `tickets` que en sus hijas

- **`tickets`**: la fila sigue viva después del cobro (`status`, `synced_at`, los tres de Holded,
  `email_failed_at`, los intents, `credit_pending`). El trigger mira **sólo** la lista generada.
  Pasarse de estricto aquí rompe el flujo de Holded, y ese es el fallo típico de esto —
  por eso el test canónico prueba las dos mitades en el mismo test.
- **`ticket_lines` / `ticket_payments`**: no tienen vida operativa. El trigger vigila la **fila
  entera** y también el `INSERT`: colar una línea en una venta sellada cambia lo vendido igual que
  editarla.
- **`DELETE` denegado sin vía de corrección.** Borrar una línea o un pago no es una corrección: una
  venta cobrada se anula por **devolución**, que crea un registro nuevo. La vía de corrección
  cubre valores de columna, no la desaparición de filas.

Dos excepciones al `DELETE`, las dos comprobadas **contra el estado real y no contra una promesa**:
el cajero técnico `TEST` (limpieza de implantación del superadmin) y la cascada del borrado del
tenant, que se detecta porque la fila padre ya no existe cuando salta el trigger.

### 2.7 La lista de columnas económicas vive en un solo sitio, y hay un test que lo demuestra

`packages/db/src/sealed-fields.ts` exporta la lista **y el generador del bloque SQL** que se pega
en la migración. `apps/api/test/sello-lista-columnas.test.ts` hace dos cosas:

1. parsea `schema.prisma` y exige que **toda** columna `@db.Decimal` de las tres tablas esté en la
   lista **o** en `NOT_SEALED_MONEY_COLUMNS` con el motivo escrito;
2. compara el bloque commiteado en el `.sql` con lo que genera el módulo, **byte a byte**.

Sin el punto 2, alguien podría cambiar la lista y dejar el trigger de producción vigilando otro
conjunto de columnas: el peor fallo posible de este bloque, porque no se notaría hasta que hiciera
falta.

### 2.8 El Z: una fila por Z, no una columna en el turno

El prompt pedía "congelar el desglose en la propia fila, no solo en el PDF". Se ha hecho con una
tabla, `shift_z_reports`, y no con columnas en `shifts`. El motivo es la otra mitad de la misma
frase del prompt: *"con el anterior conservado"*. Una columna en `shifts` no puede conservar el Z
anterior — sólo puede pisarlo, que es el problema que se venía a arreglar. Cada Z tiene su fila,
su desglose completo y su SHA-256; el correctivo es `sequence + 1` y marca al anterior con
`superseded_at` / `superseded_by_id`.

`Shift.zReportStale` **cambia de significado** y se queda con el nombre: ya no es "el PDF que
tienes puede estar caducado, apáñate" sino **"existe un Z posterior que corrige a este"**, y ahora
lleva a algún sitio (`GET /shift/...` devuelve `zReports[]` en el resumen del turno).

**El archivado del Z va capturado en los dos cierres.** Corre DESPUÉS del `update` que cierra el
turno, así que una excepción sin capturar devolvería un 500 sobre un cierre que sí ocurrió y el
reintento daría 409 con la caja bloqueada; en el corte de día abortaría la pasada y dejaría sin
cerrar los turnos de detrás. Se registra y se sigue, igual que ya se hacía con el fallo del PDF.
El turno cerrado es el dato que no se puede perder; el Z congelado se reconstruye después.

El Z correctivo **nace sin PDF a propósito**. El documento emitido —el que se le enseñó a alguien—
es el del cierre y no se reescribe; lo que faltaba y ahora existe es el número corregido. La tabla
es append-only por trigger: la única escritura permitida es marcar una fila como superada, y una
sola vez.

### 2.9 Convivencia pre-sello / sellado

No se sella retroactivamente (ADR-015 §5.2). El contrato lo dice en vez de dejar que cada
consumidor lo suponga: `serializeTicket` devuelve `sealedAt` y `sealedHash`, y el panel del admin
pinta **"Venta pre-sello"** con la explicación en vez de un hueco. Los agregados (arqueo, Z,
listados) no filtran por `sealed_at`: suman las dos poblaciones, y el e2e lo comprueba con un
`COUNT(*) FILTER` que exige que haya de las dos.

### 2.10 Cero drift de Prisma en lo que toca este bloque

La migración se escribe a mano (Prisma no expresa triggers ni funciones), así que todo lo que sí
modela Prisma tiene que coincidir con el `schema.prisma` o el siguiente `migrate dev` lo
"arreglaría" borrándolo. Comprobado con:

```
prisma migrate diff --from-migrations ./prisma/migrations \
                    --to-schema-datamodel ./prisma/schema.prisma \
                    --shadow-database-url ...
```

Dos cosas salieron y se corrigieron: el índice del trigger se llamaba `ticket_corrections_txid_idx`
y ahora se llama como lo nombraría Prisma
(`ticket_corrections_txid_table_name_row_id_field_idx`, declarado como
`@@index([txid, tableName, rowId, field])`), y a las dos claves ajenas nuevas les faltaba el
`ON UPDATE CASCADE` que Prisma siempre emite.

`ticket_corrections`, `shift_z_reports` y `tickets` ya no aparecen en el diff. El drift que queda
(`appointments`, `products`, `apk_download_codes`) **es anterior a este bloque** y se deja como
está: son tablas que S1 no toca.

---

## 3 · Sabotaje → test rojo

Los once sabotajes se **aplicaron de verdad sobre el código** (o sobre la migración), se corrió la
suite, y se revirtieron. Esto es lo que salió.

| # | Sabotaje aplicado | Tests que se pusieron rojos |
|---|---|---|
| 1 | Quitar la llamada a `sealTicket` en `POST /tickets` (el cobro deja de sellarse en el servidor) | e2e 1, 2, 3, 4, 5, 7, 10 — **7 rojos** |
| 2 | Quitar `total` de `SEALED_COLUMNS.tickets` y **regenerar** la migración | unit "cubre TODAS las columnas de importe" + **e2e 2 (canónico)** |
| 3 | Tocar la lista (`cash_amount` fuera) y **no** regenerar la migración | unit "cubre TODAS las columnas" + unit "la migración lleva EXACTAMENTE el bloque" |
| 4 | Pasarse de estricto: meter `status`, `holded_doc_number` y `synced_at` en la lista | **e2e 2 (canónico)** — el `UPDATE` de Holded revienta |
| 5 | Sellar sólo lo que llega en vivo (el ticket con `occurredAt` se queda sin sellar ≡ el sello lo pone el terminal) | e2e 5 y e2e 10 |
| 6 | Quitar el `CHECK` del motivo, el `RAISE CORRECCION_SIN_MOTIVO` y el guardia de TypeScript | e2e 6 |
| 7 | Borrar los triggers de `ticket_lines` y `ticket_payments` (el repo antes del bloque) | e2e 3, 4 y 7 |
| 8 | El Z correctivo pisa al anterior (reutiliza `sequence` y borra la fila vieja) | e2e 9 |
| 9 | Meter `credit_pending` DENTRO del sello (contra ADR-015 §5.1) | **e2e 8** (cobrar un fiado se cae) + 3 unit de la lista |
| 10 | `backfill-vuelta.ts` vuelve a hacer `ticketPayment.update` a pelo, sin motivo | e2e 7 |
| 11 | Borrar el trigger `tickets_sealed_guard` | **e2e 2 (canónico)** |
| 12 | Quitar `shift_id` de la lista (el estado que detectó la revisión de Cowork) | **e2e 2 (canónico)** |
| 13 | Hacer reventar `archiveZReport` | nada, **con** el `try/catch` (22 verdes) · **10 rojos** al quitarlo, entre ellos "un turno que falla no impide cerrar los demás" |

Correspondencia con la tabla del prompt:

| Fila del prompt | Cubierta por |
|---|---|
| `UPDATE tickets SET total = total + 1` por SQL directo | e2e 2 · sabotajes **11, 2, 1** |
| `UPDATE ticket_lines SET unit_price` | e2e 3 · sabotajes **7, 1** |
| `DELETE FROM ticket_payments` | e2e 4 · sabotajes **7, 1** |
| Actualizar `status` / `holded_doc_number` — **NO debe caer** | e2e 2 (misma prueba) · sabotaje **4** |
| `UPDATE tickets SET shift_id` (revisión de Cowork) | e2e 2 · sabotaje **12** |
| Quitar una columna de importe de la lista | unit `sello-lista-columnas` · sabotajes **2 y 3** |
| Sellar en el terminal en vez de en el servidor | e2e 5 · sabotaje **5** |
| `backfill-vuelta.ts` contra un ticket sellado sin motivo | e2e 7 · sabotaje **10** |
| Escribir una corrección sin motivo | e2e 6 · sabotaje **6** |
| Cobrar un fiado — **NO debe caer** | e2e 8 · sabotaje **9** |
| Cerrar turno y meter una venta después | e2e 9 · sabotaje **8** |

**El caso canónico** es el test 2 de `apps/api/test-e2e/sello-de-la-venta.e2e.ts`: el mismo ticket
sellado rechaza `UPDATE tickets SET total = total + 1` y `UPDATE tickets SET shift_id = ...` por
SQL directo **y acepta sin problema** pasar a `SYNCED` con `holded_document_id`, `holded_doc_number`, `holded_pdf_url`, `synced_at`,
`email_failed_at`, los tres intents. Los sabotajes 11 y 4 lo tumban por los dos lados opuestos:
quedarse corto y pasarse de estricto.

**El backfill se ejecuta de verdad en el e2e.** El test 7 no simula la lógica del script: lanza
`src/scripts/backfill-vuelta.ts` con `tsx` contra la base real, primero con `--motivo=` vacío
(sale con código ≠ 0, no escribe, no deja traza) y después normal (corrige, y deja la fila con
`old_value = 5.0000`, `new_value = 3.3000` y el motivo).

Todo lo que prueba que **el motor** rechaza algo entra por `$executeRawUnsafe`: SQL directo, como
lo escribiría alguien con acceso al VPS. Con un prisma falso se estaría probando exactamente lo
contrario de lo que cierra el bloque.

---

## 4 · Lo que la suite NO cubre

Escrito para que nadie lo confunda con lo que sí cubre.

1. **El dueño de las tablas puede desactivar los triggers.** La aplicación se conecta con el rol
   propietario, así que un `ALTER TABLE ... DISABLE TRIGGER` o un `DROP TRIGGER` desde el VPS
   sigue siendo posible. Lo que este bloque cierra es la escritura *casual* y la que va por la
   aplicación, y deja evidencia de la otra (el hash deja de cuadrar). El `REVOKE` sobre un rol de
   aplicación de menor privilegio **no entra en este bloque** — la función de corrección ya está
   preparada para él, pero el cambio de credenciales en el despliegue no se ha hecho ni probado.
2. **Nadie verifica los sellos periódicamente.** No hay job ni endpoint que recalcule los hashes y
   avise de los que no cuadran. La regla de lectura de §2.2 está escrita, no automatizada.
3. **El histórico pre-sello no está protegido y no lo estará nunca.** Es la decisión de ADR-015
   §5.2, y el e2e 10 comprueba que efectivamente se puede modificar. Sellarlo sería afirmar algo
   que no podemos verificar.
4. **Las devoluciones no están selladas.** `Refund` y `RefundLine` no tienen sello ni trigger. Una
   devolución es un registro nuevo (por eso anular no es editar), pero su propia fila se puede
   modificar como antes.
5. **`ticket_partial_payments` no está sellada ni vigilada.** Los cobros parciales viven en el
   DRAFT, antes del sello, pero sus filas sobreviven al cobro y se pueden editar después.
6. **El PDF del Z sigue siendo un fichero sustituible.** Lo que está congelado y con huella es el
   desglose en base de datos; nadie compara el PDF de disco contra ese hash. Y el Z correctivo no
   genera PDF (§2.8).
7. **No hay test de concurrencia.** Dos ventas tardías simultáneas sobre el mismo turno compiten
   por el `sequence` del Z; el `UNIQUE (shift_id, sequence)` hace que una falle, y fallar es
   preferible a dos Z que dicen ser el mismo — pero ese camino no está probado.
8. **La vía de corrección admite un segundo `UPDATE` de la misma columna en la misma transacción**
   una vez escrita la fila de corrección. La traza dice el valor que se pidió, no necesariamente
   el que quedó si alguien encadena escrituras a propósito dentro de la misma tx.
9. **Un ticket `TEST` sellado se puede borrar** (excepción explícita del trigger), y un ticket
   sellado se va con su tenant si se borra el tenant.
10. **`status` sigue siendo operativo, y eso tiene un filo.** Poner `VOIDED` a una venta sellada
    es un `UPDATE` que el trigger deja pasar sin traza, y la saca del `ticketsCount` del Z (los
    recuentos filtran `status NOT IN ('DRAFT','VOIDED')`). El **dinero sigue contando**: el
    desglose por método suma `ticket_payments` sin filtrar por `status`, así que el arqueo no se
    descuadra — lo que cambia es el número de documentos emitidos que declara el Z. No se ha
    sellado `status` a propósito: es la columna que escriben el worker de Holded, el cajero
    técnico y el flujo de anulación de DRAFT, y meterla rompería los tres (el sabotaje 4 lo
    demuestra). Cerrar este filo pide distinguir "anular un DRAFT" de "anular una venta cobrada"
    a nivel de esquema, y eso es otro bloque.
11. **El TPV no enseña el estado del sello.** Sólo el admin. No se ha tocado ni el modal de cobro
    ni la pantalla de "Ticket emitido" (son v1.16/v1.17/v1.18).
12. **No se ha medido el coste del trigger.** Cada `UPDATE` sobre `tickets` sellados hace un
    `to_jsonb(OLD)` y recorre la lista; cada escritura en las hijas hace un `SELECT` sobre
    `tickets`. En volúmenes de piloto no se nota, pero no hay número.
13. **El e2e no corre sin `E2E_DATABASE_URL`.** En local se salta con un mensaje; en CI falla a
    propósito (`test-e2e/e2e-env.ts`). Toda la verificación a nivel de motor depende de que esa
    variable esté puesta en CI.

---

## 5 · Frontera (no se ha cruzado)

- **Ni un encadenamiento de huellas entre registros.** El sello es por venta. Dos ventas idénticas
  producen el mismo hash, y hay un test que lo fija (`sello-payload.test.ts`, último caso). Es lo
  que nos mantiene fuera del ámbito SIF.
- Ni remisión a la AEAT, ni certificados, ni declaración responsable.
- **No se ha escrito "cumple Verifactu"** ni equivalente en ninguna parte del producto ni de la
  documentación. La única redacción admitida sigue siendo la de ADR-015 §2: *registro de ventas
  íntegro y no modificable, con trazabilidad de cualquier corrección.*
- No se ha partido `tickets` en dos tablas (ADR-015 §4).
- No se ha tocado la integración con Holded: el ticket sube exactamente igual, y el test canónico
  existe para garantizarlo.
- No se ha tocado el catálogo, el mapa de sala, el modal de cobro ni "Ticket emitido".

---

## 6 · Al desplegar

1. `pnpm --filter @mipiacetpv/db run migrate:deploy`. **La migración es aditiva pero SÍ bloquea
   `tickets` un instante, y conviene desplegarla con la caja parada.** Los `ALTER TABLE ... ADD
   COLUMN` de columnas nulables sin default no toman lock apreciable, pero:
   - `CREATE INDEX` sin `CONCURRENTLY` toma `SHARE` sobre `tickets`: bloquea escrituras (no
     lecturas) mientras construye el índice;
   - cada `CREATE TRIGGER` toma `ACCESS EXCLUSIVE` sobre su tabla: bloquea **todo**, incluidas las
     lecturas — y como Prisma corre cada migración en una sola transacción, el lock se mantiene
     hasta el final del fichero.

   Con los volúmenes del piloto es cuestión de segundos y no se nota. Con una tabla `tickets`
   grande, o con el TPV vendiendo, hay que darle ventana: un cobro que caiga dentro del
   `ACCESS EXCLUSIVE` espera, y si supera el `statement_timeout` del cliente falla.
   `CREATE INDEX CONCURRENTLY` no es alternativa dentro de esta migración (no se puede ejecutar en
   una transacción); si algún día hiciera falta, va en una migración aparte.
2. **El sello arranca en el momento del despliegue.** Todo lo vendido antes queda pre-sello. No hay
   backfill y no debe haberlo.
3. Si queda pendiente correr `backfill:vuelta` sobre algún tenant, ahora **exige motivo** y deja
   traza: `pnpm --filter @mipiacetpv/api backfill:vuelta -- --apply` usa el motivo por defecto
   (que cita v1.15 §2) y `--motivo="..."` lo sustituye. Sin `--apply` sigue siendo sólo informe.
4. Cambio de contrato del API: `POST /admin/tickets/:id/edit-line-sku` **requiere `reason`**. El
   admin ya lo manda; cualquier cliente que no lo haga recibe 400.
5. Aguas abajo (no entra aquí): el `REVOKE` + rol de aplicación de menor privilegio (§4.1) y un
   verificador periódico de sellos (§4.2).

---

## 7 · Ficheros

**Nuevos**

```
packages/db/src/sealed-fields.ts                     lista canónica + generador del SQL
packages/db/prisma/migrations/20260909000000_s1_sello_de_la_venta/migration.sql
apps/api/src/tickets/seal.ts                         cálculo del sello
apps/api/src/tickets/corrections.ts                  cliente de la vía de corrección
apps/api/src/shift/z-seal.ts                         congelado y correctivo del Z
apps/api/test/sello-payload.test.ts                  determinismo del payload (11)
apps/api/test/sello-lista-columnas.test.ts           la lista y la migración no se separan (6)
apps/api/test/z-sello.test.ts                        el hash del Z (4)
apps/api/test/support/fake-z-reports.ts              doble compartido de shift_z_reports
apps/api/test-e2e/sello-de-la-venta.e2e.ts           la tabla de sabotajes contra Postgres (10)
```

**Modificados**

```
packages/db/prisma/schema.prisma        Ticket.sealed*, TicketCorrection, ShiftZReport
packages/db/src/index.ts                exporta sealed-fields
apps/api/src/tickets/routes.ts          sella en las dos puertas de cobro; sealedAt en el contrato
apps/api/src/tickets/credit-routes.ts   sella el fiado al saldarse
apps/api/src/admin/tickets-errors.ts    edit-line-sku por la vía de corrección + GET corrections
apps/api/src/scripts/backfill-vuelta.ts por la vía de corrección; sin motivo no arranca
apps/api/src/shift/routes.ts            archiva el Z al cerrar (y extrae los recuentos)
apps/api/src/shift/day-cut-run.ts       archiva el Z del corte de día
apps/api/src/shift/impute.ts            la venta tardía emite Z correctivo
apps/api/src/shift/summary.ts           zReports[] en el resumen del turno
apps/admin/src/pages/TicketsErrorsPage.tsx  motivo obligatorio + panel "Sello de la venta"
```

**Dobles de prisma actualizados** (consecuencia directa de que ahora se sella dentro de la tx del
cobro; ningún cambio de expectativa salvo donde se dice):

```
apps/api/test/tickets-route.test.ts          + ticket.findUniqueOrThrow / update
apps/api/test/la-vuelta-existe.test.ts       + ticket.findUniqueOrThrow
apps/api/test/checkout-idempotency.test.ts   + ticket.findUniqueOrThrow
apps/api/test/tables-e2e.test.ts             findUniqueOrThrow ignoraba `select` (bug del doble)
apps/api/test/credit-flow.test.ts            + findUniqueOrThrow y pagos acumulados
apps/api/test/shift-close.test.ts            + shiftZReport
apps/api/test/shift-day-cut-run.test.ts      + shiftZReport
apps/api/test/admin-tickets-errors-route.test.ts  contrato nuevo de edit-line-sku (+2 tests)
```
