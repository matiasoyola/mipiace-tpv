# ADR-020 · Dejar Holded es un camino, no un interruptor

_2026-09-26. Decide cómo un comercio que **ya vende con Holded conectado** deja de usarlo sin
perder nada, y qué cambia de lo que [ADR-017](./adr-017-el-catalogo-tiene-autoridad-local.md)
daba por cierto. Es el escalón 3 de la independencia de Holded: ADR-016 resolvió la empresa sin
caja, ADR-017 la que **nace** sin Holded, y éste la que **lo deja**._

---

## 0. Tesis en una frase

Pasar de `holdedEnabled = true` + clave a `holdedEnabled = false` sin clave no es mover un
booleano: es **convertir un catálogo de dueño**, y por eso necesita una acción propia, atómica,
con previsualización — y una columna, `holded_disconnected_at`, que distingue para siempre al
comercio que **dejó** Holded del que **nunca lo tuvo**.

## 1. Contexto

ADR-017 §4.1 dejó una puerta cerrada a propósito:

> Apagarlo en un tenant que ya está subiendo tickets dejaría documentos a medias en su
> contabilidad y ventas sin subir sin que nadie se enterara. **409 con el motivo**, no un toggle
> que obedece.

La guarda era correcta y **sigue estando**. Lo que faltaba era el camino que la atraviesa, y el
25-09-2026 se volvió urgente: Ana, de Peluquería Sole, quiso cambiar el precio de un servicio y
no pudo. En un comercio con Holded el catálogo manda desde Holded y el panel marca sus fichas
«De Holded», no editables. La decisión de producto (Matías, 23 y 26-09) es que los comercios
autónomos van sin Holded hasta que Verifactu les obligue, y Sole es el primero.

Este ADR es de **datos y de gobierno**. La mecánica está en
`docs/blocks/holded-desconectar-done.md`.

## 2. Lo que NO se decide aquí (frontera dura)

**La vuelta a Holded** — reconectar un comercio que lo dejó y casar su catálogo por SKU. Es otro
bloque, y §5 explica por qué este ADR tiene que cerrarle la puerta mientras no exista. Las
**rectificativas** de una factura simplificada (V3 de verifactu). El renombrado a `ErpAdapter`.
Y la **decisión de producto** de a qué comercio se le hace y cuándo: eso es de Matías.

## 3. Decisión: una columna, `holded_disconnected_at`, y no un booleano más

**Alternativas descartadas:**

| Alternativa | Por qué no |
|---|---|
| Deducirlo de `holdedEnabled = false` | Lo contestan igual DOS comercios que no se parecen en nada: el que nació sin Holded (ADR-017) y el que lo dejó con 270 facturas emitidas y 86 fichas con `holded_product_id` vivo. El asesor necesita distinguirlos para saber quién emitió cada abono. |
| Deducirlo del registro de auditoría | La auditoría es una traza, no un estado. Consultarla en el camino de una decisión la convierte en dato operativo y ata el comportamiento a que nadie la purgue. |
| Una tabla `holded_disconnections` | Una fila por comercio y como mucho una vez en su vida. Una tabla para eso es una junta más en cada consulta. |
| Un `enum HoldedRelacion { NUNCA, PREVISTO, CONECTADO, DEJADO }` | Sería lo limpio si empezáramos hoy. Colapsar `holdedEnabled` + clave + fecha en un enum es una migración de datos sobre tres columnas que el resto del código lee por separado, en el mismo despliegue que el corte. No se paga. |

**Decisión:** `Tenant.holdedDisconnectedAt DateTime? @map("holded_disconnected_at")`, NULL en
todos los demás. Tres cosas la necesitan y ninguna se deduce de las otras dos columnas:

1. **La frontera del abono.** Una devolución posterior al corte puede ser de una factura de
   Holded o de una factura simplificada nuestra, y el asesor las trata distinto.
2. **La reanudación.** La acción es una transacción de Postgres **más** un vaciado de colas de
   Redis, que no es transaccional. Si el proceso muere entre las dos, relanzarla ve esto puesto,
   no repite la parte hecha y termina la que falta.
3. **La puerta de la vuelta** (§5).

### 3.1 Su invariante vive en la BASE

```sql
ALTER TABLE tenants ADD CONSTRAINT tenants_holded_desconectado_ck CHECK (
  holded_disconnected_at IS NULL
  OR (holded_enabled = false AND holded_api_key_ciphertext IS NULL)
);
```

No se puede estar «a medio dejar». El corte son tres cosas —interruptor apagado, clave borrada,
fecha puesta— y el CHECK es lo que impide que se separen **después**, en un `UPDATE` que nadie
revisó. Es lo que convierte «Holded se calla» en una propiedad del dato y no en una lista de
`if` que alguien tiene que acordarse de escribir.

## 4. Decisión: la clave se BORRA, y el enlace se CONSERVA

Son las dos caras de la misma decisión y van juntas.

**La clave (`holded_api_key_ciphertext`, `holded_oauth_*`) se borra.** Un secreto que no hace
falta no se guarda. Y mientras el ciphertext esté ahí, cualquier camino que se olvide de mirar
el interruptor puede llamar a Holded: de los diecinueve caminos inventariados, casi todos se
protegen solos con `if (!holdedApiKeyCiphertext)`. Borrarla es lo que hace que ese `if` baste.

**`holded_product_id` NO se borra.** Es el hilo de la vuelta en 2027: sin él, casar 86 fichas
con las de Holded habría que hacerlo a mano. Se conserva en `products.holded_product_id`, con
`source = LOCAL`.

### 4.1 Y por eso el SKU se acuña, no se hereda

Tras el corte todo el catálogo es `source = LOCAL`, así que el índice único parcial de ADR-017
§3.1 —`UNIQUE (tenant_id, sku) WHERE source = 'LOCAL'`— pasa a gobernarlo **entero**. El
catálogo que llega de Holded no lo cumple, y el motivo es nuestro:

`buildAutoSku` compone `AUTO-` + los **ocho** primeros caracteres alfanuméricos del id de
Holded, y un id de Holded es un ObjectId de Mongo cuyos ocho primeros hex **son el timestamp**.
Todo lo que el cliente creó el mismo rato comparte SKU. Medido en la copia de producción del
24-09-2026: Librería Thalía tiene 55 fichas en 8 grupos (el mayor, trece); PRUEBAS MIPIACE, 26
en 3 grupos (el mayor, veinte). Sole se salva por suerte: 86 SKU distintos.

La regla tiene dos mitades opuestas a propósito:

- **Lo que inventamos nosotros se re-acuña.** Un `AUTO-<8>` repetido trece veces no era la llave
  de nada: ya estaba degenerado en Holded el día que se subió. Se re-deriva del
  `holded_product_id` **completo**, que es UNIQUE por tenant, con prefijo propio: `CORTE-`.
- **Lo que escribió el cliente no se toca nunca.** `SKU215` en la Coca-Cola y en la Coca-Cola
  zero de Cafetería Sirope es un error suyo en su ERP. Decidir cuál se queda no es cosa de una
  acción automática: sale listado en la previsualización, la acción **no arranca**, y se resuelve
  en Holded o en el panel.

Tres prefijos y tres significados que no se mezclan: `AUTO-` («lo subió `runAutoSku` con GET-back,
allí es canónico» — `buildTicketSalesreceiptPayload` se apoya en esa promesa), `LOC-` («nació
local, nunca estuvo en Holded») y `CORTE-` («estuvo en Holded, pero este SKU **no** es el que
Holded tiene»). Poner `AUTO-` a un valor que Holded no conoce sería una mentira en el campo donde
esa mentira cuesta dinero, y ya costó una vez: el incidente de Peluquería Sole del 10-06-2026.

El SKU antiguo de cada ficha re-acuñada se guarda en el `metadata` de la fila de auditoría. No
hay columna nueva: el sitio de un dato histórico que nadie consulta en caliente es el registro de
auditoría, no una columna más en la tabla del camino de cobro.

## 5. Lo que este ADR CAMBIA de ADR-017

ADR-017 §4.1 dice, sobre encender el interruptor:

> Encenderlo no tiene guarda: es volver al camino de siempre.

**Deja de ser cierto para el comercio que dejó Holded**, y la razón está en §4: sus fichas son
`LOCAL` y **conservan** `holded_product_id`. El upsert del sync incremental casa por
`(tenant_id, holded_product_id)` y su comentario decía:

> La rama `update` de este upsert NO necesita puerta: la busca `tenantId_holdedProductId`, y un
> producto local tiene ese enlace a NULL, así que jamás puede casar con ella.

Ese supuesto muere aquí. Con el enlace conservado, una pasada del sync entraría por la rama
`update` y pisaría nombre, precio, IVA y tags de las fichas locales: el precio que Ana cambió a
las diez se desharía solo a las diez y cuarto.

**Decisión:** reencender Holded en un comercio con `holded_disconnected_at` poblado es **409**,
por los tres caminos que existen (`PATCH /super-admin/tenants/:id`,
`PATCH …/holded-api-key`, `POST /auth/me/rotate-holded-key`). La vuelta es otro bloque y tiene
que decidir además qué se hace con lo cobrado en el periodo local.

El comercio que **nació** sin Holded no gana ninguna guarda: sus fichas locales tienen el enlace
a NULL y el supuesto de ADR-017 sigue siendo cierto para él. La puerta es la **fecha del corte**,
no el interruptor.

## 6. Decisión: el trigger REESCRIBE, no lanza

```sql
CREATE TRIGGER holded_uploads_no_tras_el_corte BEFORE INSERT ON holded_uploads …
```

Si el tenant tiene la fecha puesta, la fila nace `SKIPPED` en vez de `PENDING`.

La primera puerta es `shouldEnqueueHoldedUpload` (`tickets/holded-upload-gate.ts`), que no crea
la fila. Ésta es la segunda, para el día en que alguien añada un quinto camino de cobro y se
olvide del gate — **ya pasó**: `catalogo-local` encontró que de los cuatro caminos que encolan,
mesa y devolución no pasaban por él.

**Y no lanza, y ésa es la decisión.** `holded_uploads` se escribe DENTRO de la transacción que
cobra. Un `RAISE EXCEPTION` aquí tumbaría una venta con el cliente delante para proteger una
invariante nuestra, y eso no se paga: **cobrar siempre se puede**. Es el mismo criterio con el
que `comprobarGateFiscal` DESCARTA el registro que manda el modo prueba en vez de devolver 409
(verifactu-1 addendum 1b). `SKIPPED` no es un estado inventado para esto: existe desde
v1.5-consistencia-B §3.a y significa exactamente «terminal, esto NUNCA debe subirse».

## 7. Decisión: los contactos se CONSERVAN

`Contact` es el espejo de Holded (ADR-R2) y la tentación es borrarlo con la clave. No se borra, y
la razón es que **de él cuelga el pasado**: `Ticket.contactHoldedId` resuelve el nombre del
deudor en el listado de deudas (`credit-routes.ts`) y en la leyenda «PENDIENTE DE PAGO» del papel
(`tickets/print.ts`). Borrarlos dejaría fiados vivos sin nombre.

Lo que sí desaparece es la forma de crear contactos nuevos: el panel del TPV ya no se monta
(catalogo-local §14), `POST /contacts` y el import CSV crean el contacto **en Holded** antes de
espejarlo y se cierran con 409. La consecuencia visible es una y está medida: el email
**automático** del ticket depende de `contactHoldedId` y deja de salir; el **manual** sigue
igual. En el histórico de Sole, de cuatro envíos, uno era automático.

## 8. Decisión: la previsualización es el plan, no un texto de ayuda

`GET …/dejar-holded` y `POST …/dejar-holded` corren **la misma función** sobre las mismas
consultas, y el POST la vuelve a correr DENTRO de su transacción. Rechaza con los MISMOS bloqueos
que enseñó el GET, no con un 409 genérico: quien pulsa tiene que leer lo mismo que le enseñó la
pantalla. Si entre una cosa y otra alguien ha cobrado, el plan cambia y la acción lo dice.

Lo que impide arrancar, y por qué cada uno:

| Bloqueo | Por qué |
|---|---|
| Venta en `PENDING_SYNC` o `SYNC_FAILED` | Borrar la clave ahora la dejaría muda para siempre |
| Abono en `PENDING_SYNC` o `SYNC_FAILED` | El dinero ya salió del cajón: el abono TIENE que existir en su contabilidad |
| Subida `PENDING` con documento detrás | La cola todavía la puede terminar |
| **Fiado con deuda viva** | No está en la lista del prompt y tiene la MISMA consecuencia: un fiado no sube hasta que se salda (variante B), así que si se salda después del corte su factura no llega nunca |
| SKU repetido del cliente | §4.1 |
| Suelo fiscal incompleto | Desde el corte emite él, y un registro sin NIF no es un registro (ADR-019 §2.6) |

Lo que **no** bloquea y se informa: turnos abiertos (el arqueo se lee mejor con la tienda
cerrada, pero cobrar siempre se puede), tickets en borrador, y la versión de APK de cada
terminal. Esto último **a propósito**: decidir un invariante comparando cadenas de versión es
exactamente lo que verifactu-1b vino a corregir. Se enseña la versión, el último latido y los
registros de su caja, y decide una persona.

## 9. Consecuencias

- Un comercio que deja Holded **no puede volver** hasta que exista el bloque de la vuelta. Es
  deliberado y está escrito en el 409.
- El catálogo de ese comercio queda con `source = LOCAL` y `holded_product_id` poblado: un estado
  que antes de este ADR no existía. Cualquier código que asuma «LOCAL ⇒ enlace NULL» está mal
  desde hoy. El único que lo asumía era el upsert del sync, y §5 lo cierra.
- Las devoluciones posteriores al corte no generan documento de abono en ningún sitio. El dinero
  sale y el arqueo cuadra; el papel lo hace el asesor, con el listado de
  `GET /admin/devoluciones/para-el-asesor`.
- `holded_disconnected_at` es para siempre. Si algún día la vuelta se construye, tendrá que
  decidir qué hace con ella — limpiarla borraría la frontera del abono.
